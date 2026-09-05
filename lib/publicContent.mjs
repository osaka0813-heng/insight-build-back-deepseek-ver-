function stripRetiredJapanese(value) {
  if (Array.isArray(value)) return value.map(stripRetiredJapanese);
  if (!value || typeof value !== 'object') return value;

  const localized = Object.hasOwn(value, 'en') || Object.hasOwn(value, 'zh');
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !(localized && key === 'ja'))
      .map(([key, child]) => [key, stripRetiredJapanese(child)]),
  );
}

export function buildPublicContent(content) {
  const referencedCandidateIds = new Set(
    (content?.dailyStates || []).flatMap((state) => state?.candidateSignalIds || []),
  );

  return stripRetiredJapanese({
    schemaVersion: content.schemaVersion,
    generatedAt: content.generatedAt,
    contentVersion: content.contentVersion,
    insights: content.insights || [],
    worldProcesses: content.worldProcesses || [],
    dailyStates: content.dailyStates || [],
    dailyCandidates: (content.dailyCandidates || []).filter((candidate) =>
      referencedCandidateIds.has(candidate?.id),
    ),
    ...(content.linkageIntegrity ? { linkageIntegrity: content.linkageIntegrity } : {}),
  });
}
