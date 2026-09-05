
import worldProcesses from '../data/world-process-catalog.json' with { type: 'json' };
import {
  compactUsage,
  deepseekConfig,
  deepseekResponsesJSON,
} from '../lib/deepseekClient.mjs';
import { selectDiverseQualifiedCandidates } from '../lib/researchQuality.mjs';
import { collectGdeltDossier } from '../lib/gdeltResearch.mjs';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, x-research-token',
  );
}

function send(res, status, payload) {
  cors(res);
  return res.status(status).json(payload);
}

function bodyOf(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.status = 400;
    throw error;
  }
}

const copySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'coreFact', 'whyItMatters', 'processMatchReason'],
  properties: {
    title: { type: 'string' },
    coreFact: { type: 'string' },
    whyItMatters: { type: 'string' },
    processMatchReason: { type: 'string' },
  },
};

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['querySummary', 'candidates'],
  properties: {
    querySummary: { type: 'string' },
    candidates: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id', 'date', 'domain', 'tags',
          'suggestedProcessId', 'processMatchConfidence',
          'importance', 'novelty', 'evidenceStrength',
          'independentSourceCount', 'thesisImpact',
          'relationshipChange', 'stageChange',
          'contradiction', 'content', 'sources',
        ],
        properties: {
          id: { type: 'string' },
          date: { type: 'string' },
          domain: { type: 'string' },
          tags: {
            type: 'array',
            minItems: 2,
            maxItems: 10,
            items: { type: 'string' },
          },
          suggestedProcessId: { type: ['string', 'null'] },
          processMatchConfidence: {
            type: 'integer', minimum: 0, maximum: 100,
          },
          importance: { type: 'integer', minimum: 0, maximum: 100 },
          novelty: { type: 'integer', minimum: 0, maximum: 100 },
          evidenceStrength: { type: 'integer', minimum: 0, maximum: 100 },
          independentSourceCount: {
            type: 'integer', minimum: 1, maximum: 10,
          },
          thesisImpact: { type: 'integer', minimum: 0, maximum: 100 },
          relationshipChange: {
            type: 'integer', minimum: 0, maximum: 100,
          },
          stageChange: { type: 'integer', minimum: 0, maximum: 100 },
          contradiction: { type: 'integer', minimum: 0, maximum: 100 },
          content: {
            type: 'object',
            additionalProperties: false,
            required: ['en', 'zh'],
            properties: {
              en: copySchema,
              zh: copySchema,
            },
          },
          sources: {
            type: 'array',
            minItems: 2,
            maxItems: 6,
            items: {
              type: 'object',
              additionalProperties: false,
              required: [
                'title', 'url', 'publisher',
                'publishedAt', 'kind', 'evidenceOrigin',
              ],
              properties: {
                title: { type: 'string' },
                url: { type: 'string' },
                publisher: { type: 'string' },
                evidenceOrigin: { type: 'string' },
                publishedAt: { type: ['string', 'null'] },
                kind: {
                  type: 'string',
                  enum: ['primary', 'reliable_media', 'context'],
                },
              },
            },
          },
        },
      },
    },
  },
};

function validate(result, researchDate, limit) {
  if (!result?.querySummary?.trim()) {
    throw new Error('Research is missing querySummary.');
  }
  if (!Array.isArray(result.candidates) || result.candidates.length < 1) {
    throw new Error('Research returned no candidate signals.');
  }
  for (const [index, candidate] of result.candidates.entries()) {
    if (!candidate?.content?.en || !candidate?.content?.zh) {
      throw new Error(`Candidate ${index + 1} is missing EN/ZH copy.`);
    }
    if (!Array.isArray(candidate.sources) || candidate.sources.length < 2) {
      throw new Error(`Candidate ${index + 1} has fewer than two sources.`);
    }
  }
  const candidates = selectDiverseQualifiedCandidates(result.candidates, researchDate, limit);
  if (!candidates.length) {
    throw new Error('Research returned no candidate with two independent, current, clickable sources.');
  }
  return { ...result, candidates };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return send(res, 405, { ok: false, error: 'Use POST.' });
  }

  try {
    if (!process.env.DEEPSEEK_API_KEY) {
      return send(res, 500, {
        ok: false,
        error: 'DEEPSEEK_API_KEY is not configured.',
      });
    }
    if (!process.env.RESEARCH_API_TOKEN) {
      return send(res, 500, {
        ok: false,
        error: 'RESEARCH_API_TOKEN is not configured.',
      });
    }
    if (
      req.headers?.['x-research-token'] !==
      process.env.RESEARCH_API_TOKEN
    ) {
      return send(res, 401, { ok: false, error: 'Unauthorized.' });
    }

    const body = bodyOf(req);
    const date =
      typeof body.date === 'string' && body.date.trim()
        ? body.date.trim()
        : new Date().toISOString().slice(0, 10);

    const focus =
      typeof body.focus === 'string' && body.focus.trim()
        ? body.focus.trim()
        : 'Scan the world broadly for changes that could alter how an informed person understands an important system.';

    const requested = Number(body.maxSignals);
    const maxSignals = Number.isFinite(requested)
      ? Math.min(8, Math.max(5, Math.trunc(requested)))
      : 6;

    const config = deepseekConfig();

    // Important: processes are context only, never the search boundary.
    const processReference = worldProcesses.map((process) => ({
      id: process.id,
      title: process.title,
      thesis: process.thesis,
      currentStage: process.currentStage,
      domains: process.domains,
      tags: process.tags,
    }));

    const dossier = await collectGdeltDossier(date);
    const structured = await deepseekResponsesJSON({
      model: config.researchModel,
      instructions: [
        'You are Insight Research. Convert the supplied independently indexed news records into distinct candidate signals.',
        'SIGNAL FIRST. Scan macro/finance, industry/trade, energy/resources, health/science, climate/environment, demographics/society, institutions/culture, technology/AI, and geopolitics/security before ranking.',
        'Do not treat war or AI as inherently more important. Include at most one AI candidate and at most one conflict/security candidate.',
        'Return 5-8 candidates when evidence supports them.',
        'Candidates should cover genuinely different changes rather than duplicates.',
        'Each candidate needs at least two independent, non-context sources with real clickable HTTP(S) URLs, different publishers, and different evidence origins.',
        'For every source, evidenceOrigin must name the organization, dataset, filing, study, measurement, or firsthand event that independently supplies the fact. If a news article merely reports another organization, use that underlying organization as evidenceOrigin. Two articles repeating the same announcement are one origin and must not be paired.',
        'Omit a candidate when its URLs cannot be verified; never convert a search lead or unsupported headline into a signal.',
        'Process matching is optional. suggestedProcessId may be null.',
        'If no existing process fits, say so rather than forcing a match.',
        'Score importance, novelty, evidence strength and structural impact from 0-100.',
        'Return only English and Simplified Chinese copy.',
        'Never invent facts, dates, titles or URLs.',
        'Use only facts explicitly supported by the supplied titles. Preserve source URLs exactly.',
      ].join(' '),
      input: [
        `Research date: ${date}`,
        `Editorial focus: ${focus}`,
        `Target candidate count: ${maxSignals}`,
        'Existing World Processes are reference only:',
        JSON.stringify(processReference),
        'INDEPENDENT NEWS INDEX DOSSIER:',
        JSON.stringify(dossier),
      ].join('\n'),
      schema,
      schemaName: 'insight_global_signal_pool',
      maxOutputTokens: 12_000,
      timeoutMs: 120_000,
      maxAttempts: 1,
    });

    const data = validate(structured.data, date, maxSignals);
    const candidates = data.candidates;

    return send(res, 200, {
      ok: true,
      id: `research-global-${date}-${Date.now()}`,
      scope: 'global',
      status: 'draft',
      researchedAt: new Date().toISOString(),
      researchDate: date,
      provider: 'deepseek',
      model: structured.model,
      usage: compactUsage({
        input_tokens: Number(structured.usage?.input_tokens || 0),
        output_tokens: Number(structured.usage?.output_tokens || 0),
        input_tokens_details: {
          cached_tokens: Number(structured.usage?.input_tokens_details?.cached_tokens || 0),
        },
      }),
      querySummary: data.querySummary,
      candidates: candidates.map((candidate) => ({
        ...candidate,
        suggestedProcessId: candidate.suggestedProcessId || undefined,
        sources: candidate.sources.map((source, index) => ({
          ...source,
          id: source.id || `${candidate.id}-source-${index + 1}`,
          publishedAt: source.publishedAt || undefined,
        })),
      })),
    });
  } catch (error) {
    console.error('Build014 Research failed:', error);
    return send(
      res,
      Number.isInteger(error?.status) ? error.status : 500,
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown research error.',
      },
    );
  }
}
