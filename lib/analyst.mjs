const clamp = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

export function normalizeScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return { value: 0, normalized: false };
  if (numeric >= 0 && numeric <= 10) return { value: clamp(numeric * 10), normalized: true };
  return { value: clamp(numeric), normalized: false };
}

function tokenize(values) {
  return new Set(
    values
      .flatMap((value) => String(value || '').toLowerCase().split(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/u))
      .map((value) => value.trim())
      .filter((value) => value.length >= 2),
  );
}

function processTokens(process) {
  return tokenize([
    process.id,
    process.title,
    process.thesis,
    process.currentStage,
    ...(process.domains || []),
    ...(process.tags || []),
  ]);
}

function bestProcessMatch(candidate, processes) {
  const candidateTokens = tokenize([
    candidate.domain,
    ...(candidate.tags || []),
    candidate.content?.en?.title,
    candidate.content?.en?.coreFact,
    candidate.content?.en?.whyItMatters,
  ]);

  let best = { id: undefined, score: 0 };
  for (const process of processes) {
    const tokens = processTokens(process);
    let shared = 0;
    candidateTokens.forEach((token) => { if (tokens.has(token)) shared += 1; });
    const denominator = Math.max(5, Math.min(candidateTokens.size, tokens.size));
    const semanticScore = clamp((shared / denominator) * 100);
    const editorialBonus = candidate.suggestedProcessId === process.id ? 25 : 0;
    const score = clamp(semanticScore * 0.75 + editorialBonus);
    if (score > best.score) best = { id: process.id, score };
  }

  const supplied = normalizeScore(candidate.processMatchConfidence).value;
  if (candidate.suggestedProcessId && supplied > best.score) {
    return { id: candidate.suggestedProcessId, score: supplied };
  }
  return best;
}

function inferRole(source, researchDate) {
  if (source.role) return source.role;
  if (!source.publishedAt) return source.kind === 'context' ? 'context' : 'corroborating';
  const sourceTime = Date.parse(source.publishedAt);
  const researchTime = Date.parse(researchDate);
  if (Number.isNaN(sourceTime) || Number.isNaN(researchTime)) return 'corroborating';
  const days = Math.abs(researchTime - sourceTime) / 86_400_000;
  if (days <= 2 && source.kind !== 'context') return 'trigger';
  if (days <= 45 && source.kind !== 'context') return 'corroborating';
  return 'context';
}

function impactFrom(scores) {
  if (scores.contradiction >= 65) return 'challenges';
  if (scores.thesisImpact >= 60 || scores.stageChange >= 65 || scores.relationshipChange >= 70) return 'updates';
  if (scores.evidenceStrength >= 65) return 'supports';
  return 'no_material_change';
}

function classificationFrom({ matchedProcessId, matchConfidence, scores, triggerCount, corroboratingCount }) {
  const evidenceReady = scores.evidenceStrength >= 68 && triggerCount >= 1 && triggerCount + corroboratingCount >= 2;
  const materialChange = Math.max(scores.thesisImpact, scores.relationshipChange, scores.stageChange, scores.contradiction);
  if (!evidenceReady || scores.importance < 55 || materialChange < 42) return 'noise';
  if (matchedProcessId && matchConfidence >= 50) return 'existing_process_update';
  if (scores.novelty >= 70 && scores.importance >= 70 && scores.relationshipChange >= 55) return 'new_process_candidate';
  if (scores.importance >= 68 && scores.evidenceStrength >= 70) return 'standalone_important_insight';
  return 'noise';
}

function publicationScore(classification, scores, materialChangeScore) {
  const classBonus = classification === 'existing_process_update' ? 8
    : classification === 'new_process_candidate' ? 10
      : classification === 'standalone_important_insight' ? 6 : -40;
  return clamp(scores.importance * 0.30 + scores.evidenceStrength * 0.25 + scores.novelty * 0.20 + materialChangeScore * 0.25 + classBonus);
}

export function analyzeCandidate(candidate, researchDate, processes = []) {
  const scoreFields = ['importance', 'novelty', 'evidenceStrength', 'thesisImpact', 'relationshipChange', 'stageChange', 'contradiction'];
  const scores = {};
  let scoreWasNormalized = false;
  for (const field of scoreFields) {
    const normalized = normalizeScore(candidate[field]);
    scores[field] = normalized.value;
    scoreWasNormalized ||= normalized.normalized;
  }

  const sources = (candidate.sources || []).map((source, index) => ({
    ...source,
    id: source.id || `${candidate.id}-source-${index + 1}`,
    role: inferRole(source, researchDate),
  }));
  const triggerCount = sources.filter((source) => source.role === 'trigger').length;
  const corroboratingCount = sources.filter((source) => source.role === 'corroborating').length;
  const contextCount = sources.filter((source) => source.role === 'context').length;
  const processMatch = bestProcessMatch(candidate, processes);
  const impact = impactFrom(scores);
  const classification = classificationFrom({
    matchedProcessId: processMatch.id,
    matchConfidence: processMatch.score,
    scores,
    triggerCount,
    corroboratingCount,
  });
  const materialChangeScore = clamp(
    scores.thesisImpact * 0.35 + scores.relationshipChange * 0.25 + scores.stageChange * 0.2 + scores.contradiction * 0.2,
  );
  const publishScore = publicationScore(classification, scores, materialChangeScore);
  const dailyState = classification === 'existing_process_update'
    ? 'update_living'
    : classification === 'noise' ? 'no_new_global_insight' : 'publish_new';
  const warnings = [];
  if (scoreWasNormalized) warnings.push('Legacy 0–10 scores were normalized to 0–100.');
  if (triggerCount === 0) warnings.push('No trigger source falls inside the research window.');
  if (triggerCount + corroboratingCount < 2) warnings.push('Fewer than two current or corroborating sources.');
  if (!processMatch.id) warnings.push('No existing Process match was found; this does not disqualify the signal.');

  return {
    ...candidate,
    ...scores,
    suggestedProcessId: processMatch.id || candidate.suggestedProcessId,
    processMatchConfidence: processMatch.score,
    independentSourceCount: triggerCount + corroboratingCount,
    currentEventSourceCount: triggerCount,
    corroboratingSourceCount: corroboratingCount,
    contextSourceCount: contextCount,
    claimSourceIds: candidate.claimSourceIds?.length
      ? candidate.claimSourceIds
      : sources.filter((source) => source.role !== 'context').map((source) => source.id),
    sources,
    analysis: {
      matchedProcessId: processMatch.id,
      processMatchConfidence: processMatch.score,
      impact,
      dailyState,
      classification,
      analyzeType: classification,
      publicationScore: publishScore,
      materialChangeScore,
      publishThresholdMet: dailyState !== 'no_new_global_insight',
      scoreWasNormalized,
      triggerSourceCount: triggerCount,
      corroboratingSourceCount: corroboratingCount,
      contextSourceCount: contextCount,
      rationale:
        classification === 'existing_process_update'
          ? `Matches ${processMatch.id} and materially ${impact === 'challenges' ? 'challenges' : 'updates'} the living thesis.`
          : classification === 'new_process_candidate'
            ? 'The signal is important and novel enough to become a new Process candidate.'
            : classification === 'standalone_important_insight'
              ? 'The signal changes understanding of the active scope even without a stable Process match.'
              : 'Evidence or consequence is not strong enough for publication.',
      warnings,
    },
  };
}

export function analyzeDraft(draft, processes = []) {
  const candidates = (draft.candidates || []).map((candidate) => analyzeCandidate(candidate, draft.researchDate, processes));
  const publishable = candidates
    .filter((candidate) => candidate.analysis?.classification !== 'noise')
    .sort((a, b) => (b.analysis?.publicationScore || 0) - (a.analysis?.publicationScore || 0));
  const selectedCandidateId = publishable[0]?.id;
  return {
    ...draft,
    status: 'draft',
    candidateCount: candidates.length,
    selectedCandidateId,
    selectionReason: selectedCandidateId
      ? 'Highest publication score among Existing Process Update, New Process Candidate, and Standalone Important Insight.'
      : 'All candidates were classified as Noise.',
    candidates: candidates.map((candidate) => ({ ...candidate, selectedForPublication: candidate.id === selectedCandidateId })),
  };
}
