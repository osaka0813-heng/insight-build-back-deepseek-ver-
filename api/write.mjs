
import worldProcesses from '../data/world-process-catalog.json' with { type: 'json' };
import { buildWriterDraft } from '../lib/writer.mjs';
import {
  compactUsage,
  deepseekConfig,
  deepseekToolJSON,
} from '../lib/deepseekClient.mjs';
import {
  baseStageSchema,
  compactCandidate,
  compactProcess,
  mergeUsage,
  translationStageSchema,
  validatePage,
} from '../lib/stagedWriter.mjs';

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

function authorize(req) {
  if (
    req.headers?.['x-research-token'] !==
    process.env.RESEARCH_API_TOKEN
  ) {
    const error = new Error('Unauthorized.');
    error.status = 401;
    throw error;
  }
}

function context(raw) {
  const researchDraft = raw.researchDraft || raw.draft;
  if (!researchDraft?.id || !Array.isArray(researchDraft.candidates)) {
    const error = new Error('researchDraft with candidates is required.');
    error.status = 400;
    throw error;
  }

  // Analyze puts the single selected candidate first.
  const candidate =
    researchDraft.candidates.find(
      (item) => item.id === raw.candidateId,
    ) || researchDraft.candidates[0];

  if (!candidate?.analysis) {
    const error = new Error(
      'Selected candidate must be analyzed before writing.',
    );
    error.status = 422;
    throw error;
  }

  const processId =
    candidate.analysis.matchedProcessId ||
    candidate.suggestedProcessId;

  const matchedProcess =
    worldProcesses.find((process) => process.id === processId);

  return {
    researchDraft: { ...researchDraft, scope: 'global' },
    candidate,
    matchedProcess,
  };
}

async function englishStage(ctx) {
  const config = deepseekConfig();
  const sourceIds = (ctx.candidate.sources || [])
    .map((source) => source.id)
    .filter(Boolean);

  const result = await deepseekToolJSON({
    model: config.writeModel,
    system: [
      'You are the English lead writer for Insight.',
      'Write one concise six-page Global Insight from the selected Signal.',
      'The classification may be an existing process update, new process candidate, or standalone important Insight.',
      'Do not force a World Process link if the Analyst did not provide one.',
      'Use only supplied evidence.',
      'Never invent facts, dates, numbers, quotes, URLs or source IDs.',
      'Page 4 must contain meaningful before, shift, now and conclusion.',
      'Return the complete structured result through the required function.',
    ].join(' '),
    user: JSON.stringify({
      researchDate: ctx.researchDraft.researchDate,
      candidate: compactCandidate(ctx.candidate),
      matchedProcess: compactProcess(ctx.matchedProcess),
      allowedSourceIds: sourceIds,
    }),
    toolName: 'submit_global_english_master',
    schema: baseStageSchema,
    reasoningEffort: 'high',
    maxTokens: 7_500,
    timeoutMs: 95_000,
  });

  validatePage(result.data.en, 'en');

  return {
    ok: true,
    stage: 'base',
    baseDraft: result.data,
    model: result.model,
    usage: compactUsage(result.usage),
  };
}

async function chineseStage(ctx, baseDraft) {
  if (!baseDraft?.en) {
    const error = new Error('English baseDraft is required.');
    error.status = 400;
    throw error;
  }

  const config = deepseekConfig();

  const result = await deepseekToolJSON({
    model: config.researchModel,
    system: [
      'You are the Simplified Chinese editor for Insight.',
      'Translate and locally edit the supplied English master into natural concise Simplified Chinese.',
      'Preserve structure, evidence confidence, source IDs and item counts.',
      'Do not add facts, dates, numbers, URLs or citations.',
      'Do not translate IDs.',
      'Page 4 must remain complete.',
      'Return only the required structured result.',
    ].join(' '),
    user: JSON.stringify({
      englishMaster: {
        page: baseDraft.en,
        dailyState: baseDraft.dailyStateEn,
        processContent: baseDraft.processContentEn,
        nextQuestion: baseDraft.nextQuestionEn,
        observeNext: baseDraft.observeNextEn,
      },
      sourceIds: (ctx.candidate.sources || [])
        .map((source) => source.id)
        .filter(Boolean),
    }),
    toolName: 'submit_global_chinese_draft',
    schema: translationStageSchema,
    reasoningEffort: 'medium',
    maxTokens: 6_500,
    timeoutMs: 95_000,
  });

  validatePage(result.data.page, 'zh');

  return {
    ok: true,
    stage: 'zh',
    language: 'zh',
    localizedDraft: result.data,
    model: result.model,
    usage: compactUsage(result.usage),
  };
}

function finalize(ctx, baseDraft, zhDraft, stageUsage, stageModels) {
  validatePage(baseDraft.en, 'en');
  validatePage(zhDraft.page, 'zh');

  const processUpdate = ctx.matchedProcess
    ? {
        stage: baseDraft.processStage,
        content: {
          en: baseDraft.processContentEn,
          zh: zhDraft.processContent,
        },
        nextQuestion: {
          en: baseDraft.nextQuestionEn,
          zh: zhDraft.nextQuestion,
        },
        observeNext: {
          en: baseDraft.observeNextEn,
          zh: zhDraft.observeNext,
        },
      }
    : undefined;

  const generated = {
    insightId: baseDraft.insightId,
    slug: baseDraft.slug,
    parentInsightId: baseDraft.parentInsightId,
    previousInsightId: baseDraft.previousInsightId,
    en: baseDraft.en,
    zh: zhDraft.page,
    dailyState: {
      en: baseDraft.dailyStateEn,
      zh: zhDraft.dailyState,
    },
    processUpdate,
  };

  const usage = mergeUsage(
    stageUsage?.base,
    stageUsage?.zh,
  );

  const writerDraft = {
    ...buildWriterDraft({
      researchDraft: ctx.researchDraft,
      candidate: ctx.candidate,
      model:
        [stageModels?.base, stageModels?.zh]
          .filter(Boolean)
          .join(' + ') || 'deepseek-build014',
      generated,
      process: ctx.matchedProcess,
    }),
    provider: 'deepseek',
    pipeline: 'build014-one-world-v1',
    usage: compactUsage(usage),
  };

  return {
    ok: true,
    stage: 'finalize',
    writerDraft,
    editorialGate: {
      publishThresholdMet: Boolean(
        ctx.candidate.analysis.publishThresholdMet,
      ),
      dailyState: ctx.candidate.analysis.dailyState,
      decisionType: ctx.candidate.analysis.decisionType,
      warnings: ctx.candidate.analysis.warnings || [],
    },
  };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return send(res, 405, { ok: false, error: 'Use POST.' });
  }

  try {
    authorize(req);
    const raw =
      typeof req.body === 'object'
        ? req.body
        : JSON.parse(req.body || '{}');

    const stage = raw.stage || 'base';
    const ctx = context(raw);

    if (stage === 'base') {
      return send(res, 200, await englishStage(ctx));
    }
    if (stage === 'zh') {
      return send(
        res,
        200,
        await chineseStage(ctx, raw.baseDraft),
      );
    }
    if (stage === 'finalize') {
      return send(
        res,
        200,
        finalize(
          ctx,
          raw.baseDraft,
          raw.zhDraft,
          raw.stageUsage,
          raw.stageModels,
        ),
      );
    }

    return send(res, 400, {
      ok: false,
      error: `Unknown write stage: ${stage}`,
    });
  } catch (error) {
    console.error('Build014 Write failed:', error);
    return send(
      res,
      Number.isInteger(error?.status) ? error.status : 500,
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown write error.',
        missingFields: error?.missingFields,
      },
    );
  }
}
