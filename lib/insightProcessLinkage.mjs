function unique(values = []) {
  return [...new Set(values.filter(
    (value) => typeof value === 'string' && value.trim(),
  ))];
}

export function repairInsightProcessLinks(content) {
  const insights = Array.isArray(content?.insights)
    ? content.insights.map((item) => ({ ...item }))
    : [];
  const processes = Array.isArray(content?.worldProcesses)
    ? content.worldProcesses.map((item) => ({
        ...item,
        insightIds: unique(item.insightIds || []),
        supportingInsightIds: unique(
          item.supportingInsightIds || item.insightIds || [],
        ),
        contradictingInsightIds: unique(
          item.contradictingInsightIds || [],
        ),
      }))
    : [];

  const processById = new Map(processes.map((item) => [item.id, item]));

  for (const insight of insights) {
    let processId = insight.processId;

    if (!processId) {
      const matched = processes.find((process) => {
        const evolutionIds = Array.isArray(process.evolution)
          ? process.evolution.map((event) => event?.insightId)
          : [];
        return [
          ...process.insightIds,
          ...process.supportingInsightIds,
          ...process.contradictingInsightIds,
          ...evolutionIds,
        ].includes(insight.id);
      });
      processId = matched?.id;
    }

    if (!processId || !processById.has(processId)) continue;

    insight.processId = processId;
    const process = processById.get(processId);
    process.insightIds = unique([...process.insightIds, insight.id]);

    if (!process.contradictingInsightIds.includes(insight.id)) {
      process.supportingInsightIds = unique([
        ...process.supportingInsightIds,
        insight.id,
      ]);
    }
  }

  for (const process of processes) {
    const evolutionIds = Array.isArray(process.evolution)
      ? process.evolution.map((event) => event?.insightId).filter(Boolean)
      : [];

    process.insightIds = unique([
      ...process.insightIds,
      ...process.supportingInsightIds,
      ...process.contradictingInsightIds,
      ...evolutionIds,
    ]);

    for (const insightId of process.insightIds) {
      const insight = insights.find((item) => item.id === insightId);
      if (insight && !insight.processId) insight.processId = process.id;
    }
  }

  return {
    ...content,
    insights,
    worldProcesses: processes,
    linkageIntegrity: {
      version: 1,
      repairedAt: new Date().toISOString(),
    },
  };
}
