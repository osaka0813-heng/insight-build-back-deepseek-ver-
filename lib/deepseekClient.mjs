const DEFAULT_BASE_URL = 'https://api.deepseek.com';

function env(name, fallback) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function deepseekConfig() {
  return {
    apiKey: env('DEEPSEEK_API_KEY'),
    baseUrl: env('DEEPSEEK_BASE_URL', DEFAULT_BASE_URL).replace(/\/$/, ''),
    researchModel: env('DEEPSEEK_RESEARCH_MODEL', 'deepseek-v4-flash'),
    analyzeModel: env('DEEPSEEK_ANALYZE_MODEL', 'deepseek-v4-pro'),
    writeModel: env('DEEPSEEK_WRITE_MODEL', 'deepseek-v4-pro'),
  };
}

function requireKey() {
  const config = deepseekConfig();
  if (!config.apiKey) {
    const error = new Error('DEEPSEEK_API_KEY is not configured.');
    error.status = 500;
    throw error;
  }
  return config;
}

async function requestOnce(url, body, timeoutMs) {
  const { apiKey } = requireKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload;
    try { payload = raw ? JSON.parse(raw) : {}; }
    catch {
      const error = new Error(`DeepSeek returned non-JSON (${response.status}): ${raw.slice(0, 400)}`);
      error.status = response.status;
      throw error;
    }
    if (!response.ok) {
      const message = payload?.error?.message || payload?.error || `DeepSeek request failed (${response.status}).`;
      const error = new Error(String(message));
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeout = new Error('DeepSeek request timed out. Please retry.');
      timeout.status = 504;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function retryable(error) {
  return error instanceof TypeError ||
    [408, 429, 500, 502, 503, 504].includes(Number(error?.status));
}

async function request(url, body, timeoutMs = 240_000, maxAttempts = 2) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await requestOnce(url, body, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !retryable(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 + attempt * 350));
    }
  }
  throw lastError;
}

export function extractResponsesText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text;
  for (const item of payload?.output || []) {
    if (item?.type !== 'message') continue;
    for (const part of item.content || []) {
      if (part?.type === 'output_text' && typeof part.text === 'string' && part.text.trim()) return part.text;
    }
  }
  throw new Error('DeepSeek Responses API returned no output_text.');
}

function extractToolArguments(payload, toolName) {
  for (const choice of payload?.choices || []) {
    for (const call of choice?.message?.tool_calls || []) {
      if (call?.function?.name === toolName && typeof call.function.arguments === 'string') {
        return call.function.arguments;
      }
    }
  }
  throw new Error(`DeepSeek did not call required tool: ${toolName}.`);
}

export async function deepseekResponsesText({
  model,
  instructions,
  input,
  webSearch = false,
  maxOutputTokens = 12_000,
  timeoutMs = 240_000,
  maxAttempts = 2,
}) {
  const config = requireKey();
  const tools = webSearch ? [{ type: 'web_search' }] : undefined;
  const body = {
    model,
    instructions,
    input,
    tools,
    tool_choice: webSearch ? 'auto' : undefined,
    max_output_tokens: maxOutputTokens,
  };

  Object.keys(body).forEach(
    (key) => body[key] === undefined && delete body[key],
  );

  const payload = await request(`${config.baseUrl}/responses`, body, timeoutMs, maxAttempts);

  if (payload?.status === 'incomplete') {
    const reason =
      payload?.incomplete_details?.reason || 'unknown';
    const error = new Error(
      `DeepSeek Responses API was incomplete (${reason}).`,
    );
    error.status = 502;
    throw error;
  }

  return {
    text: extractResponsesText(payload),
    model: payload.model || model,
    usage: payload.usage || null,
  };
}

function parseJSONObject(raw, label) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error(`${label} returned empty content.`);
  }

  const trimmed = raw.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    throw new Error(
      `${label} was not valid JSON: ${withoutFence.slice(0, 400)}`,
    );
  }
}

async function chatJSONFallback({
  model,
  instructions,
  input,
  schema,
  maxTokens,
  timeoutMs = 120_000,
}) {
  const config = requireKey();
  const schemaText = JSON.stringify(schema);

  let lastError;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const payload = await request(
        `${config.baseUrl}/chat/completions`,
        {
          model,
          messages: [
            {
              role: 'system',
              content: [
                instructions,
                'Return JSON only.',
                'Do not add Markdown fences or explanatory prose.',
                `The JSON must match this schema: ${schemaText}`,
              ].join('\n'),
            },
            {
              role: 'user',
              content: input,
            },
          ],
          response_format: { type: 'json_object' },
          max_tokens: maxTokens,
          stream: false,
        },
        timeoutMs,
      );

      const content =
        payload?.choices?.[0]?.message?.content || '';

      return {
        data: parseJSONObject(
          content,
          `DeepSeek JSON fallback attempt ${attempt}`,
        ),
        model: payload.model || model,
        usage: payload.usage || null,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

export async function deepseekResponsesJSON({
  model,
  instructions,
  input,
  schema,
  schemaName,
  maxOutputTokens = 18_000,
  timeoutMs = 240_000,
  maxAttempts = 2,
  webSearch = false,
}) {
  const config = requireKey();
  const endpoint = `${config.baseUrl}/responses`;
  const body = {
    model,
    instructions: [
      instructions,
      'Return JSON only and follow the supplied JSON Schema.',
    ].join('\n'),
    input,
    max_output_tokens: maxOutputTokens,
    tools: webSearch ? [{ type: 'web_search' }] : undefined,
    tool_choice: webSearch ? 'auto' : undefined,
    text: {
      format: {
        type: 'json_schema',
        name: schemaName,
        strict: true,
        schema,
      },
    },
  };

  Object.keys(body).forEach(
    (key) => body[key] === undefined && delete body[key],
  );

  try {
    const payload = await request(endpoint, body, timeoutMs, maxAttempts);

    if (payload?.status === 'incomplete') {
      const reason =
        payload?.incomplete_details?.reason || 'unknown';
      throw Object.assign(
        new Error(
          `DeepSeek structured response was incomplete (${reason}).`,
        ),
        { status: 502 },
      );
    }

    return {
      data: parseJSONObject(
        extractResponsesText(payload),
        'DeepSeek structured output',
      ),
      model: payload.model || model,
      usage: payload.usage || null,
    };
  } catch (error) {
    // Never fall back to unconstrained prose. Use Chat Completions JSON mode.
    if (
      ![400, 422, 502].includes(error?.status) &&
      !String(error?.message || '').includes('valid JSON') &&
      !String(error?.message || '').includes('empty content')
    ) {
      throw error;
    }

    return chatJSONFallback({
      model,
      instructions,
      input,
      schema,
      maxTokens: Math.min(maxOutputTokens, 16_000),
    });
  }
}

export async function deepseekToolJSON({
  model,
  system,
  user,
  toolName,
  schema,
  reasoningEffort = 'high',
  maxTokens = 16_000,
  timeoutMs = 120_000,
}) {
  const config = requireKey();

  // DeepSeek thinking mode currently rejects forced `tool_choice`.
  // For deterministic structured output, use non-thinking mode with a
  // required function call. If that still fails, fall back to JSON mode.
  try {
    const payload = await request(
      `${config.baseUrl}/chat/completions`,
      {
        model,
        messages: [
          {
            role: 'system',
            content: [
              system,
              'Return the complete result through the supplied function.',
              'Do not answer with ordinary prose.',
            ].join('\n'),
          },
          { role: 'user', content: user },
        ],
        thinking: { type: 'disabled' },
        max_tokens: maxTokens,
        stream: false,
        tools: [
          {
            type: 'function',
            function: {
              name: toolName,
              description:
                'Submit the complete validated JSON result.',
              parameters: schema,
            },
          },
        ],
        tool_choice: {
          type: 'function',
          function: { name: toolName },
        },
      },
      timeoutMs,
    );

    const args = extractToolArguments(payload, toolName);

    return {
      data: parseJSONObject(
        args,
        `DeepSeek tool ${toolName}`,
      ),
      model: payload.model || model,
      usage: payload.usage || null,
    };
  } catch (error) {
    const message = String(error?.message || '');

    const canFallback =
      [400, 422, 502].includes(error?.status) ||
      message.includes('tool_choice') ||
      message.includes('required tool') ||
      message.includes('valid JSON') ||
      message.includes('empty content');

    if (!canFallback) throw error;

    return chatJSONFallback({
      model,
      instructions: [
        system,
        `Return the complete result as one JSON object matching the schema for ${toolName}.`,
        `Reasoning priority requested: ${reasoningEffort}.`,
      ].join('\n'),
      input: user,
      schema,
      maxTokens: Math.min(maxTokens, 12_000),
      timeoutMs,
    });
  }
}

export function compactUsage(usage) {
  if (!usage) return undefined;
  return {
    inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? 0,
    outputTokens: usage.output_tokens ?? usage.completion_tokens ?? 0,
    cachedInputTokens:
      usage.input_tokens_details?.cached_tokens ??
      usage.prompt_cache_hit_tokens ??
      usage.prompt_tokens_details?.cached_tokens ?? 0,
  };
}
