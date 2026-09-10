
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

function newestFirst(states) {
  return states.sort((a, b) =>
    String(b?.date || '').localeCompare(String(a?.date || '')),
  );
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
    dailyStates: newestFirst([
      writerDraft.dailyStateDraft,
      ...(content.dailyStates || []).filter(
        (item) => item.id !== writerDraft.dailyStateDraft.id,
      ),
    ]),
    writerDrafts: [
      writerDraft,
      ...(content.writerDrafts || []).filter(
        (item) => item.id !== writerDraft.id,
      ),
    ],
  };

  if (writerDraft.processUpdate) {
    next.worldProcesses = (content.worldProcesses || []).map(
      (process) => updateProcess(process, writerDraft.processUpdate),
    );
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

  // A rejected candidate is still a valid daily editorial result. Publishing
  // that observation keeps the calendar continuous without publishing the
  // under-threshold Insight itself.
  const publishDailyObservation = Boolean(writerDraft.dailyStateDraft?.id);

  const publishedInsightIds = new Set(
    (content.insights || []).map((item) => item?.id).filter(Boolean),
  );
  const publishedProcessIds = new Set(
    (content.worldProcesses || []).map((item) => item?.id).filter(Boolean),
  );
  const rejectedDailyState = publishDailyObservation
    ? (() => {
        const {
          insightId: _unpublishedInsightId,
          processId: draftProcessId,
          previousInsightId: draftPreviousInsightId,
          ...dailyState
        } = writerDraft.dailyStateDraft;
        const previousInsightId = publishedInsightIds.has(draftPreviousInsightId)
          ? draftPreviousInsightId
          : content.insights?.[0]?.id;
        const originalContent = dailyState.content || {};
        const rejectedContent = Object.fromEntries(
          ['en', 'zh'].map((language) => {
            const copy = originalContent[language] || {};
            return [
            language,
            {
              ...copy,
              label: language === 'zh' ? '无新增全球洞察' : 'No new global insight',
              decisionTitle: language === 'zh' ? '证据尚未达到发布标准' : 'Evidence has not crossed the publication threshold',
              decisionSummary: copy?.thresholdReason || copy?.decisionSummary ||
                (language === 'zh'
                  ? '当日证据不足以支持新的结构性判断，继续保留最近一篇已验证洞察。'
                  : 'The evidence did not support a new structural claim; the latest verified Insight remains in place.'),
              thresholdReason: copy?.thresholdReason ||
                (language === 'zh'
                  ? '证据未达到发布标准。'
                  : 'The evidence did not meet the publication threshold.'),
              observeNext: Array.isArray(copy?.observeNext) ? copy.observeNext : [],
            },
          ];}),
        );
        return {
          ...dailyState,
          state: 'no_new_global_insight',
          content: rejectedContent,
          decidedAt: rejectedAt,
          ...(publishedProcessIds.has(draftProcessId)
            ? { processId: draftProcessId }
            : {}),
          ...(previousInsightId ? { previousInsightId } : {}),
        };
      })()
    : undefined;

  return {
    ...content,
    generatedAt: rejectedAt,
    contentVersion: `review-${writerDraft.id}-${Date.now()}`,
    ...(publishDailyObservation ? {
      dailyStates: newestFirst([
        rejectedDailyState,
        ...(content.dailyStates || []).filter(
          (item) => item.id !== rejectedDailyState.id,
        ),
      ]),
    } : {}),
    writerDrafts: [
      writerDraft,
      ...(content.writerDrafts || []).filter(
        (item) => item.id !== writerDraft.id,
      ),
    ],
  };
}
