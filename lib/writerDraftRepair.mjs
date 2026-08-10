const PATTERN_TITLES = {
  en: 'Structural change',
  zh: '结构变化',
  ja: '構造変化',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function repairWriterDraft(writerDraft) {
  const repaired = clone(writerDraft);
  const content = repaired?.insight?.content;

  if (!content || typeof content !== 'object') {
    return repaired;
  }

  for (const language of ['en', 'zh', 'ja']) {
    const copy = content[language];
    if (!copy || typeof copy !== 'object') continue;

    copy.pattern = copy.pattern || {};

    // This is only a fixed UI section label, not factual content.
    if (
      typeof copy.pattern.title !== 'string' ||
      !copy.pattern.title.trim()
    ) {
      copy.pattern.title = PATTERN_TITLES[language];
    }
  }

  return repaired;
}
