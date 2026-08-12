
export const nonEmptyString = { type: 'string', minLength: 1 };

const evidence = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'description', 'confidence', 'sourceIds'],
  properties: {
    title: nonEmptyString,
    description: nonEmptyString,
    confidence: {
      type: 'string',
      enum: ['verified', 'developing', 'hypothesis'],
    },
    sourceIds: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: nonEmptyString,
    },
  },
};

export const localizedPageSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['cover', 'question', 'signals', 'pattern', 'insight', 'observe'],
  properties: {
    cover: {
      type: 'object',
      additionalProperties: false,
      required: ['eyebrow', 'secondaryEyebrow', 'title', 'summary'],
      properties: {
        eyebrow: nonEmptyString,
        secondaryEyebrow: nonEmptyString,
        title: nonEmptyString,
        summary: nonEmptyString,
      },
    },
    question: {
      type: 'object',
      additionalProperties: false,
      required: ['lead', 'title', 'footnote'],
      properties: {
        lead: nonEmptyString,
        title: nonEmptyString,
        footnote: nonEmptyString,
      },
    },
    signals: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'sourceNote', 'items'],
      properties: {
        title: nonEmptyString,
        sourceNote: nonEmptyString,
        items: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'label', 'title', 'body', 'whyImportant', 'evidence',
            ],
            properties: {
              label: nonEmptyString,
              title: nonEmptyString,
              body: nonEmptyString,
              whyImportant: nonEmptyString,
              evidence,
            },
          },
        },
      },
    },
    pattern: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'before', 'shift', 'now', 'conclusion'],
      properties: {
        title: nonEmptyString,
        before: nonEmptyString,
        shift: nonEmptyString,
        now: nonEmptyString,
        conclusion: nonEmptyString,
      },
    },
    insight: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'formula', 'explanation'],
      properties: {
        title: nonEmptyString,
        formula: nonEmptyString,
        explanation: nonEmptyString,
      },
    },
    observe: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'items', 'ending'],
      properties: {
        title: nonEmptyString,
        items: {
          type: 'array',
          minItems: 3,
          maxItems: 4,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['label', 'prompt', 'meta'],
            properties: {
              label: nonEmptyString,
              prompt: nonEmptyString,
              meta: nonEmptyString,
            },
          },
        },
        ending: nonEmptyString,
      },
    },
  },
};

export const dailyCopySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'label', 'decisionTitle', 'decisionSummary',
    'thresholdReason', 'observeNext',
  ],
  properties: {
    label: nonEmptyString,
    decisionTitle: nonEmptyString,
    decisionSummary: nonEmptyString,
    thresholdReason: nonEmptyString,
    observeNext: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      items: nonEmptyString,
    },
  },
};

export const evolutionCopySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'description', 'implication'],
  properties: {
    title: nonEmptyString,
    description: nonEmptyString,
    implication: nonEmptyString,
  },
};

export const baseStageSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'insightId', 'slug', 'parentInsightId', 'previousInsightId',
    'en', 'dailyStateEn', 'processStage',
    'processContentEn', 'nextQuestionEn', 'observeNextEn',
  ],
  properties: {
    insightId: { type: ['string', 'null'] },
    slug: nonEmptyString,
    parentInsightId: { type: ['string', 'null'] },
    previousInsightId: { type: ['string', 'null'] },
    en: localizedPageSchema,
    dailyStateEn: dailyCopySchema,
    processStage: {
      type: 'string',
      enum: [
        'signal', 'emerging', 'accelerating', 'structural',
        'maturing', 'uncertain', 'declining',
      ],
    },
    processContentEn: evolutionCopySchema,
    nextQuestionEn: nonEmptyString,
    observeNextEn: {
      type: 'array',
      minItems: 3,
      maxItems: 4,
      items: nonEmptyString,
    },
  },
};

export const translationStageSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'page', 'dailyState', 'processContent',
    'nextQuestion', 'observeNext',
  ],
  properties: {
    page: localizedPageSchema,
    dailyState: dailyCopySchema,
    processContent: evolutionCopySchema,
    nextQuestion: nonEmptyString,
    observeNext: {
      type: 'array',
      minItems: 3,
      maxItems: 4,
      items: nonEmptyString,
    },
  },
};

const placeholders = new Set([
  '无字段', '没有字段', '待补充', '暂无内容',
  'no field', 'missing field', 'n/a',
]);

function meaningful(value) {
  return (
    typeof value === 'string' &&
    value.trim() &&
    !placeholders.has(value.trim().toLowerCase())
  );
}

export function validatePage(page, language) {
  const missing = [];
  const fields = [
    ['cover.title', page?.cover?.title],
    ['cover.summary', page?.cover?.summary],
    ['question.title', page?.question?.title],
    ['question.lead', page?.question?.lead],
    ['signals.title', page?.signals?.title],
    ['pattern.title', page?.pattern?.title],
    ['pattern.before', page?.pattern?.before],
    ['pattern.shift', page?.pattern?.shift],
    ['pattern.now', page?.pattern?.now],
    ['pattern.conclusion', page?.pattern?.conclusion],
    ['insight.title', page?.insight?.title],
    ['insight.explanation', page?.insight?.explanation],
    ['observe.title', page?.observe?.title],
    ['observe.ending', page?.observe?.ending],
  ];

  for (const [field, value] of fields) {
    if (!meaningful(value)) missing.push(`${language}.${field}`);
  }

  if (!Array.isArray(page?.signals?.items) || page.signals.items.length < 2) {
    missing.push(`${language}.signals.items`);
  }
  if (!Array.isArray(page?.observe?.items) || page.observe.items.length < 3) {
    missing.push(`${language}.observe.items`);
  }

  if (missing.length) {
    const error = new Error(
      `Writer produced incomplete ${language} content: ${missing.join(', ')}`,
    );
    error.status = 422;
    error.missingFields = missing;
    throw error;
  }
}

export function compactCandidate(candidate) {
  return {
    id: candidate.id,
    date: candidate.date,
    suggestedProcessId: candidate.suggestedProcessId,
    importance: candidate.importance,
    novelty: candidate.novelty,
    thesisImpact: candidate.thesisImpact,
    evidenceStrength: candidate.evidenceStrength,
    scores: candidate.scores,
    content: candidate.content,
    analysis: candidate.analysis,
    sources: (candidate.sources || []).map((source) => ({
      id: source.id,
      title: source.title,
      publisher: source.publisher,
      publishedAt: source.publishedAt,
      url: source.url,
      excerpt: source.excerpt,
      kind: source.kind,
      role: source.role,
    })),
  };
}

export function compactProcess(process) {
  if (!process) return null;
  return {
    id: process.id,
    title: process.title,
    thesis: process.thesis,
    currentStage: process.currentStage,
    domains: process.domains,
    tags: process.tags,
  };
}

export function mergeUsage(...items) {
  return items.reduce(
    (total, usage) => ({
      input_tokens:
        total.input_tokens +
        Number(usage?.inputTokens || usage?.input_tokens || 0),
      output_tokens:
        total.output_tokens +
        Number(usage?.outputTokens || usage?.output_tokens || 0),
      input_tokens_details: {
        cached_tokens:
          Number(total.input_tokens_details.cached_tokens || 0) +
          Number(
            usage?.cachedInputTokens ||
            usage?.input_tokens_details?.cached_tokens ||
            0,
          ),
      },
    }),
    {
      input_tokens: 0,
      output_tokens: 0,
      input_tokens_details: { cached_tokens: 0 },
    },
  );
}
