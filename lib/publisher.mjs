import japanCatalog from '../data/japan-process-catalog.json' with { type: 'json' };
import chinaCatalog from '../data/china-process-catalog.json' with { type: 'json' };
import usCatalog from '../data/us-process-catalog.json' with { type: 'json' };

function toRemoteProcess(catalogProcess, publishedAt, scope) {
  const now = publishedAt || new Date().toISOString();
  return {
    id: catalogProcess.id,
    scope,
    slug: catalogProcess.slug,
    status: catalogProcess.status || 'emerging',
    confidence: catalogProcess.confidence || 'developing',
    startedAt: now,
    updatedAt: now,
    insightIds: [],
    tags: catalogProcess.tags || [],
    connections: [],
    evolution: [],
    currentStage: catalogProcess.currentStage,
    domains: catalogProcess.domains || [],
    supportingInsightIds: [],
    contradictingInsightIds: [],
    nextSignals: catalogProcess.content?.en?.observeNext || [],
    content: catalogProcess.content,
  };
}

function ensureScopedProcess(processes, writerDraft, publishedAt) {
  const processId = writerDraft?.processUpdate?.processId;
  if (!processId) return processes || [];
  if ((processes || []).some((process) => process.id === processId)) {
    return processes || [];
  }

  const catalogs = {
    japan: japanCatalog,
    china: chinaCatalog,
    us: usCatalog,
  };

  const scope = writerDraft.scope;
  const catalog = catalogs[scope];
  if (!catalog) return processes || [];

  const seed = catalog.find((process) => process.id === processId);
  return seed
    ? [toRemoteProcess(seed, publishedAt, scope), ...(processes || [])]
    : (processes || []);
}

function assertDraft(writerDraft) {
  if (!writerDraft?.id) throw new Error('writerDraft.id is required.');
  if (!writerDraft?.insight?.id) throw new Error('writerDraft.insight is required.');
  if (!writerDraft?.dailyStateDraft?.id) throw new Error('writerDraft.dailyStateDraft is required.');
}

function updateProcess(process, update) {
  if (!update || process.id !== update.processId) return process;

  return {
    ...process,
    updatedAt: update.updatedAt,
    insightIds: Array.from(new Set([
      update.appendInsightId,
      ...(process.insightIds || []),
    ])),
    evolution: [
      update.evolutionEvent,
      ...(process.evolution || []).filter(
        (event) => event.id !== update.evolutionEvent.id,
      ),
    ],
    content: Object.fromEntries(
      Object.entries(process.content || {}).map(([language, copy]) => [
        language,
        {
          ...copy,
          nextQuestion:
            update.nextQuestion?.[language] || copy.nextQuestion,
          observeNext:
            update.observeNext?.[language] || copy.observeNext,
        },
      ]),
    ),
  };
}

export function mergeApprovedDraft(content, rawDraft, publishedAt = new Date().toISOString()) {
  assertDraft(rawDraft);

  const writerDraft = {
    ...rawDraft,
    status: 'approved',
    approvedAt: publishedAt,
  };

  const next = {
    ...content,
    generatedAt: publishedAt,
    contentVersion: `publish-${writerDraft.insight.id}-${Date.now()}`,
    insights: [
      writerDraft.insight,
      ...(content.insights || []).filter(
        (item) => item.id !== writerDraft.insight.id,
      ),
    ],
    dailyStates: [
      writerDraft.dailyStateDraft,
      ...(content.dailyStates || []).filter(
        (item) => item.id !== writerDraft.dailyStateDraft.id,
      ),
    ],
    writerDrafts: [
      writerDraft,
      ...(content.writerDrafts || []).filter(
        (item) => item.id !== writerDraft.id,
      ),
    ],
  };

  if (writerDraft.processUpdate) {
    const seededProcesses = ensureScopedProcess(content.worldProcesses || [], writerDraft, publishedAt);
    next.worldProcesses = seededProcesses.map((process) => updateProcess(process, writerDraft.processUpdate));
  }

  return next;
}

export function mergeRejectedDraft(content, rawDraft, rejectedAt = new Date().toISOString()) {
  if (!rawDraft?.id) throw new Error('writerDraft.id is required.');

  const writerDraft = {
    ...rawDraft,
    status: 'rejected',
    rejectedAt,
  };

  return {
    ...content,
    generatedAt: rejectedAt,
    contentVersion: `review-${writerDraft.id}-${Date.now()}`,
    writerDrafts: [
      writerDraft,
      ...(content.writerDrafts || []).filter(
        (item) => item.id !== writerDraft.id,
      ),
    ],
  };
}
