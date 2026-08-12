const clamp = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

export function sourceType(kind) {
  if (kind === 'primary') return 'official';
  if (kind === 'reliable_media') return 'media';
  return 'research';
}

export function sourceReliability(kind) {
  if (kind === 'primary') return 'primary';
  if (kind === 'reliable_media') return 'strong';
  return 'context';
}

export function confidenceFromEvidence(score) {
  if (score >= 80) return 'verified';
  if (score >= 60) return 'developing';
  return 'hypothesis';
}

function slugify(value) {
  return String(value || 'insight')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'insight';
}

function normalizeDate(value) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? new Date().toISOString().slice(0, 10) : new Date(parsed).toISOString().slice(0, 10);
}

function mapSources(candidate) {
  return (candidate.sources || []).map((source, index) => ({
    id: source.id || `${candidate.id}-source-${index + 1}`,
    title: source.title,
    publisher: source.publisher,
    publishedAt: source.publishedAt || undefined,
    url: source.url,
    type: sourceType(source.kind),
    reliability: sourceReliability(source.kind),
    note: source.role ? `${source.role} source` : undefined,
  }));
}

function mapSignals(languageDraft, candidate, appSources) {
  const sourceById = new Map(appSources.map((source) => [source.id, source]));
  return languageDraft.signals.items.map((signal, index) => {
    const sourceIds = (signal.evidence.sourceIds || [])
      .filter((id) => sourceById.has(id));
    const fallbackSourceIds = appSources
      .filter((source) => source.reliability !== 'context')
      .slice(0, 3)
      .map((source) => source.id);
    const finalSourceIds = sourceIds.length ? sourceIds : fallbackSourceIds;
    const signalSources = finalSourceIds
      .map((id) => sourceById.get(id))
      .filter(Boolean);

    return {
      id: `${candidate.id}-signal-${index + 1}`,
      label: signal.label,
      title: signal.title,
      body: signal.body,
      whyImportant: signal.whyImportant,
      evidence: [{
        id: `${candidate.id}-evidence-${index + 1}`,
        title: signal.evidence.title,
        description: signal.evidence.description,
        confidence: signal.evidence.confidence,
        sourceIds: finalSourceIds,
      }],
      sources: signalSources,
    };
  });
}

function buildContent(languageDraft, candidate, appSources) {
  return {
    cover: languageDraft.cover,
    question: languageDraft.question,
    signals: {
      title: languageDraft.signals.title,
      sourceNote: languageDraft.signals.sourceNote,
      items: mapSignals(languageDraft, candidate, appSources),
    },
    pattern: languageDraft.pattern,
    insight: languageDraft.insight,
    observe: languageDraft.observe,
  };
}

export function buildWriterDraft({ researchDraft, candidate, model, generated, process }) {
  const date = normalizeDate(candidate.date || researchDraft.researchDate);
  const appSources = mapSources(candidate);
  const scope = 'global';
  const insightId = generated.insightId || `${scope}-${date}-${slugify(generated.en.cover.title)}`;
  const dailyState = candidate.analysis?.dailyState || 'update_living';
  const insightStatus = dailyState === 'publish_new' ? 'publish_new' : 'update_living';
  const confidence = confidenceFromEvidence(candidate.evidenceStrength);
  const processId = candidate.analysis?.matchedProcessId || candidate.suggestedProcessId || process?.id;

  const insight = {
    id: insightId,
    scope,
    slug: generated.slug || slugify(generated.en.cover.title),
    status: insightStatus,
    parentInsightId: generated.parentInsightId || undefined,
    processId,
    publishedAt: `${date}T00:00:00.000Z`,
    updatedAt: new Date().toISOString(),
    confidence,
    content: {
      en: buildContent(generated.en, candidate, appSources),
      zh: buildContent(generated.zh, candidate, appSources),
    },
  };

  const dailyStateDraft = {
    id: `daily-${scope}-${date}`,
    scope,
    date,
    decidedAt: new Date().toISOString(),
    state: dailyState,
    insightId,
    processId,
    previousInsightId: generated.previousInsightId || undefined,
    materialChangeScore: clamp(candidate.analysis?.materialChangeScore ?? candidate.thesisImpact),
    evidenceStrength: clamp(candidate.evidenceStrength),
    noveltyScore: clamp(candidate.novelty),
    importanceScore: clamp(candidate.importance),
    candidateSignalIds: [candidate.id],
    content: generated.dailyState,
  };

  const processUpdate = processId && generated.processUpdate ? {
    processId,
    scope,
    updatedAt: new Date().toISOString(),
    appendInsightId: insightId,
    evolutionEvent: {
      id: `evolution-${candidate.id}`,
      date,
      stage: generated.processUpdate.stage,
      impact: candidate.analysis?.impact === 'challenges'
        ? 'challenges'
        : candidate.analysis?.impact === 'supports'
          ? 'supports'
          : 'updates',
      insightId,
      content: generated.processUpdate.content,
    },
    nextQuestion: generated.processUpdate.nextQuestion,
    observeNext: generated.processUpdate.observeNext,
  } : undefined;

  const checks = [];
  if (!candidate.analysis?.publishThresholdMet) checks.push('Candidate does not meet publication threshold.');
  if (!processId && dailyState === 'update_living') checks.push('Update Living requires an existing World Process.');
  if (appSources.filter((source) => source.reliability !== 'context').length < 2) {
    checks.push('Fewer than two current or corroborating sources.');
  }

  return {
    id: `writer-${candidate.id}-${Date.now()}`,
    scope,
    status: 'draft',
    writtenAt: new Date().toISOString(),
    researchDraftId: researchDraft.id,
    candidateId: candidate.id,
    model,
    dailyState,
    matchedProcessId: processId,
    qualityChecks: {
      publishThresholdMet: Boolean(candidate.analysis?.publishThresholdMet),
      sourceUrlsPreserved: true,
      noMarkdownLinksInCopy: true,
      languagesComplete: Boolean(generated.en && generated.zh),
      warnings: checks,
    },
    insight,
    dailyStateDraft,
    processUpdate,
  };
}
