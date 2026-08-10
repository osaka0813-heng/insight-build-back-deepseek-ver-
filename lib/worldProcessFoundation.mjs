const VALID_STAGES = new Set([
  'signal',
  'emerging',
  'accelerating',
  'structural',
  'maturing',
  'uncertain',
  'declining',
]);

const CONFIDENCE_SCORE = {
  verified: 85,
  developing: 68,
  uncertain: 50,
};

function unique(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))];
}

function latestEvolution(process) {
  return Array.isArray(process?.evolution)
    ? process.evolution[process.evolution.length - 1]
    : undefined;
}

function normalizeProcess(process) {
  const latest = latestEvolution(process);
  const english = process?.content?.en || {};

  return {
    ...process,
    currentStage:
      VALID_STAGES.has(process.currentStage)
        ? process.currentStage
        : VALID_STAGES.has(latest?.stage)
          ? latest.stage
          : process.status || 'uncertain',
    stageChangedAt:
      process.stageChangedAt ||
      latest?.date ||
      process.updatedAt,
    confidenceScore:
      Number.isFinite(process.confidenceScore)
        ? Math.max(0, Math.min(100, Math.round(process.confidenceScore)))
        : CONFIDENCE_SCORE[process.confidence] ?? 60,
    supportingInsightIds: unique(
      process.supportingInsightIds || process.insightIds || [],
    ),
    contradictingInsightIds: unique(
      process.contradictingInsightIds || [],
    ),
    keyActors: Array.isArray(process.keyActors) ? process.keyActors : [],
    domains: unique(process.domains || english.domains || []),
    nextSignals: unique(process.nextSignals || english.observeNext || []),
    evolution: Array.isArray(process.evolution) ? process.evolution : [],
  };
}

function inferChangeType(event) {
  if (event?.impact === 'challenges') return 'contradiction';
  if (event?.previousStage && event.previousStage !== event.stage) {
    return 'stage_transition';
  }
  if (event?.stage === 'accelerating') return 'acceleration';
  return 'new_evidence';
}

function enrichEvolutionEvent(event, previousStage) {
  if (!event || typeof event !== 'object') return event;

  return {
    ...event,
    previousStage: event.previousStage || previousStage,
    changeType: event.changeType || inferChangeType({
      ...event,
      previousStage,
    }),
    confidenceDelta:
      Number.isFinite(event.confidenceDelta)
        ? Math.round(event.confidenceDelta)
        : event.impact === 'supports'
          ? 2
          : event.impact === 'challenges'
            ? -4
            : 1,
    evidenceIds: unique(event.evidenceIds || []),
  };
}

function applyUpdate(process, writerDraft, reviewedAt) {
  const normalized = normalizeProcess(process);
  const insightId = writerDraft?.insight?.id;
  const processUpdate = writerDraft?.processUpdate;
  const event = processUpdate?.evolutionEvent;
  const previousStage = normalized.currentStage;

  const evolution = [...normalized.evolution];
  if (event?.id && !evolution.some((item) => item?.id === event.id)) {
    evolution.push(enrichEvolutionEvent(event, previousStage));
  } else if (event?.id) {
    const index = evolution.findIndex((item) => item?.id === event.id);
    evolution[index] = enrichEvolutionEvent(evolution[index], previousStage);
  }

  const latest = evolution[evolution.length - 1];
  const isChallenge = latest?.impact === 'challenges';

  const supportingInsightIds = unique([
    ...normalized.supportingInsightIds,
    ...(!isChallenge && insightId ? [insightId] : []),
  ]);
  const contradictingInsightIds = unique([
    ...normalized.contradictingInsightIds,
    ...(isChallenge && insightId ? [insightId] : []),
  ]);

  const confidenceDelta = Number.isFinite(latest?.confidenceDelta)
    ? latest.confidenceDelta
    : 0;
  const nextConfidenceScore = Math.max(
    0,
    Math.min(100, normalized.confidenceScore + confidenceDelta),
  );
  const nextStage =
    VALID_STAGES.has(latest?.stage)
      ? latest.stage
      : normalized.currentStage;
  const stageChanged = nextStage !== previousStage;

  return {
    ...normalized,
    updatedAt: processUpdate?.updatedAt || reviewedAt,
    insightIds: unique([
      ...(normalized.insightIds || []),
      ...(insightId ? [insightId] : []),
    ]),
    supportingInsightIds,
    contradictingInsightIds,
    confidenceScore: nextConfidenceScore,
    currentStage: nextStage,
    stageChangedAt: stageChanged
      ? latest?.date || reviewedAt
      : normalized.stageChangedAt,
    evolution,
    content: processUpdate
      ? {
          ...normalized.content,
          en: {
            ...normalized.content.en,
            nextQuestion:
              processUpdate.nextQuestion?.en ||
              normalized.content.en.nextQuestion,
            observeNext:
              processUpdate.observeNext?.en ||
              normalized.content.en.observeNext,
          },
          zh: normalized.content.zh
            ? {
                ...normalized.content.zh,
                nextQuestion:
                  processUpdate.nextQuestion?.zh ||
                  normalized.content.zh.nextQuestion,
                observeNext:
                  processUpdate.observeNext?.zh ||
                  normalized.content.zh.observeNext,
              }
            : normalized.content.zh,
          ja: normalized.content.ja
            ? {
                ...normalized.content.ja,
                nextQuestion:
                  processUpdate.nextQuestion?.ja ||
                  normalized.content.ja.nextQuestion,
                observeNext:
                  processUpdate.observeNext?.ja ||
                  normalized.content.ja.observeNext,
              }
            : normalized.content.ja,
        }
      : normalized.content,
    nextSignals: unique(
      processUpdate?.observeNext?.en ||
      normalized.nextSignals,
    ),
  };
}

export function applyWorldProcessFoundation(content, writerDraft, reviewedAt) {
  const processId =
    writerDraft?.processUpdate?.processId ||
    writerDraft?.matchedProcessId ||
    writerDraft?.insight?.processId;

  const processes = Array.isArray(content?.worldProcesses)
    ? content.worldProcesses.map(normalizeProcess)
    : [];

  if (!processId) {
    return {
      ...content,
      worldProcesses: processes,
    };
  }

  let found = false;
  const nextProcesses = processes.map((process) => {
    if (process.id !== processId) return process;
    found = true;
    return applyUpdate(process, writerDraft, reviewedAt);
  });

  // 012.1 deliberately does not invent a new World Process automatically.
  // Creation remains an explicit editorial action for a later build.
  return {
    ...content,
    worldProcesses: nextProcesses,
    processFoundation: {
      version: 2,
      lastUpdatedAt: reviewedAt,
      lastMatchedProcessId: found ? processId : null,
    },
  };
}
