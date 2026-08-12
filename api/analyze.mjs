
import worldProcesses from '../data/world-process-catalog.json' with { type: 'json' };
import { analyzeDraft } from '../lib/analyst.mjs';
import {
  compactUsage,
  deepseekConfig,
  deepseekToolJSON,
} from '../lib/deepseekClient.mjs';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['analyses', 'selectedCandidateId'],
  properties: {
    selectedCandidateId: { type: 'string' },
    analyses: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'candidateId',
          'decisionType',
          'priorityScore',
          'matchedProcessId',
          'processMatchConfidence',
          'impact',
          'dailyState',
          'materialChangeScore',
          'publishThresholdMet',
          'rationale',
          'warnings',
        ],
        properties: {
          candidateId: { type: 'string' },
          decisionType: {
            type: 'string',
            enum: [
              'existing_process_update',
              'new_process_candidate',
              'standalone_important_insight',
              'noise_follow_through',
            ],
          },
          priorityScore: {
            type: 'integer', minimum: 0, maximum: 100,
          },
          matchedProcessId: { type: ['string', 'null'] },
          processMatchConfidence: {
            type: 'integer', minimum: 0, maximum: 100,
          },
          impact: {
            type: 'string',
            enum: [
              'supports',
              'updates',
              'challenges',
              'no_material_change',
            ],
          },
          dailyState: {
            type: 'string',
            enum: [
              'publish_new',
              'update_living',
              'no_new_global_insight',
            ],
          },
          materialChangeScore: {
            type: 'integer', minimum: 0, maximum: 100,
          },
          publishThresholdMet: { type: 'boolean' },
          rationale: { type: 'string' },
          warnings: {
            type: 'array',
            maxItems: 8,
            items: { type: 'string' },
          },
        },
      },
    },
  },
};

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

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return send(res, 405, { ok: false, error: 'Use POST.' });
  }

  try {
    if (
      req.headers?.['x-research-token'] !==
      process.env.RESEARCH_API_TOKEN
    ) {
      return send(res, 401, { ok: false, error: 'Unauthorized.' });
    }

    const raw = typeof req.body === 'object'
      ? req.body
      : JSON.parse(req.body || '{}');
    const draft = raw.draft || raw;

    if (!draft?.researchDate || !Array.isArray(draft.candidates)) {
      return send(res, 400, {
        ok: false,
        error: 'A research draft with candidates is required.',
      });
    }

    const normalized = analyzeDraft(draft, worldProcesses);
    const config = deepseekConfig();

    const system = [
      'You are the final Analyst for Insight.',
      'The product publishes at most ONE Global Insight per cycle.',
      'SIGNAL FIRST: decide what most changes the user’s understanding of the world. Existing World Processes are reference maps, not admission gates.',
      'Classify every candidate into exactly one of four types:',
      '1 existing_process_update: materially changes or challenges an existing process;',
      '2 new_process_candidate: important structural change that deserves a new process hypothesis;',
      '3 standalone_important_insight: important now, but premature or unnecessary to turn into a long-running process;',
      '4 noise_follow_through: interesting/supportive but not worth today’s single Insight.',
      'A candidate does NOT need an existing process match to be publishable.',
      'Use evidence quality and global significance, not category fit, as the primary filter.',
      'Choose selectedCandidateId as the single best candidate.',
      'If every candidate is genuinely weak, selectedCandidateId may still identify the best candidate but mark it noise_follow_through and publishThresholdMet=false.',
      'Do not invent facts.',
    ].join(' ');

    const result = await deepseekToolJSON({
      model: config.analyzeModel,
      system,
      user: JSON.stringify({
        researchDate: draft.researchDate,
        candidates: normalized.candidates,
        worldProcesses: worldProcesses.map((process) => ({
          id: process.id,
          title: process.title,
          thesis: process.thesis,
          currentStage: process.currentStage,
          domains: process.domains,
          tags: process.tags,
        })),
      }),
      toolName: 'submit_global_insight_analysis',
      schema,
      reasoningEffort: 'high',
      maxTokens: 14_000,
    });

    const aiById = new Map(
      (result.data.analyses || []).map((item) => [
        item.candidateId,
        item,
      ]),
    );

    const candidates = normalized.candidates.map((candidate) => {
      const ai = aiById.get(candidate.id);
      if (!ai) return candidate;

      const matched =
        ai.matchedProcessId &&
        worldProcesses.some((process) => process.id === ai.matchedProcessId)
          ? ai.matchedProcessId
          : undefined;

      const decisionType = ai.decisionType;
      const dailyState =
        decisionType === 'existing_process_update' && matched
          ? 'update_living'
          : decisionType === 'noise_follow_through'
            ? 'no_new_global_insight'
            : 'publish_new';

      return {
        ...candidate,
        suggestedProcessId: matched,
        processMatchConfidence: ai.processMatchConfidence,
        analysis: {
          ...candidate.analysis,
          ...ai,
          dailyState,
          matchedProcessId: matched,
          publishThresholdMet:
            decisionType !== 'noise_follow_through' &&
            Boolean(ai.publishThresholdMet),
          warnings: [
            ...(candidate.analysis?.warnings || []),
            ...(ai.warnings || []),
          ],
        },
      };
    });

    const selectedId = result.data.selectedCandidateId;
    const ordered = [...candidates].sort((a, b) => {
      if (a.id === selectedId) return -1;
      if (b.id === selectedId) return 1;
      return Number(b.analysis?.priorityScore || 0) -
        Number(a.analysis?.priorityScore || 0);
    });

    return send(res, 200, {
      ok: true,
      analyzedAt: new Date().toISOString(),
      provider: 'deepseek',
      model: result.model,
      usage: compactUsage(result.usage),
      selectedCandidateId: ordered[0]?.id,
      draft: {
        ...normalized,
        scope: 'global',
        model: result.model,
        analysisProvider: 'deepseek',
        candidates: ordered,
      },
    });
  } catch (error) {
    console.error('Build014 Analyze failed:', error);
    return send(
      res,
      Number.isInteger(error?.status) ? error.status : 500,
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown analyze error.',
      },
    );
  }
}
