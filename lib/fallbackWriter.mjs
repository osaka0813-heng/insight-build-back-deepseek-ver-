import worldProcesses from '../data/world-process-catalog.json' with { type: 'json' };
import { buildWriterDraft } from './writer.mjs';

function text(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function sourceIds(candidate) {
  const ids = (candidate.sources || []).map((source) => source.id).filter(Boolean);
  return ids.length ? ids.slice(0, 6) : [`${candidate.id}-source-1`];
}

function confidence(candidate) {
  if (Number(candidate.evidenceStrength || 0) >= 80) return 'verified';
  if (Number(candidate.evidenceStrength || 0) >= 60) return 'developing';
  return 'hypothesis';
}

function englishPage(candidate) {
  const copy = candidate.content?.en || {};
  const ids = sourceIds(candidate);
  const title = text(copy.title, 'A signal worth watching');
  const fact = text(copy.coreFact, 'Current evidence points to an emerging change.');
  const why = text(copy.whyItMatters, 'The change may alter an important system relationship.');
  const match = text(copy.processMatchReason, 'Its structural importance depends on what happens next.');
  const level = confidence(candidate);

  return {
    cover: {
      eyebrow: candidate.analysis?.dailyState === 'no_new_global_insight' ? 'NO NEW GLOBAL INSIGHT' : 'GLOBAL INSIGHT',
      secondaryEyebrow: 'RULE-BASED RECOVERY EDITION',
      title,
      summary: why,
    },
    question: {
      lead: fact,
      title: 'Does this change the structure, or only the headlines?',
      footnote: match,
    },
    signals: {
      title: 'Signals and evidence',
      sourceNote: 'Built only from the verified research dossier after the AI writer failed.',
      items: [
        {
          label: 'SIGNAL 01', title, body: fact, whyImportant: why,
          evidence: { title: 'Current evidence', description: fact, confidence: level, sourceIds: ids },
        },
        {
          label: 'SIGNAL 02', title: 'Structural relevance', body: match, whyImportant: why,
          evidence: { title: 'Cross-check', description: match, confidence: level, sourceIds: ids },
        },
      ],
    },
    pattern: {
      title: 'What may be changing',
      before: 'The prior baseline remained intact.',
      shift: fact,
      now: why,
      conclusion: match,
    },
    insight: {
      title: 'The working insight',
      formula: 'New evidence × structural relevance = possible change',
      explanation: why,
    },
    observe: {
      title: 'Observe next',
      items: [
        { label: 'EVIDENCE', prompt: 'Look for independent confirmation.', meta: 'Next 24–72 hours' },
        { label: 'SCALE', prompt: 'Check whether the change expands beyond one event.', meta: 'Follow-through' },
        { label: 'STRUCTURE', prompt: 'Watch for a changed relationship or process stage.', meta: 'Decision trigger' },
      ],
      ending: 'The next independent evidence decides whether this becomes structural.',
    },
  };
}

function chinesePage(candidate) {
  const copy = candidate.content?.zh || {};
  const ids = sourceIds(candidate);
  const title = text(copy.title, '一个值得继续观察的信号');
  const fact = text(copy.coreFact, '现有证据显示，一个变化正在形成。');
  const why = text(copy.whyItMatters, '这一变化可能改变重要的系统关系。');
  const match = text(copy.processMatchReason, '它是否具有结构性意义，取决于后续发展。');
  const level = confidence(candidate);

  return {
    cover: {
      eyebrow: candidate.analysis?.dailyState === 'no_new_global_insight' ? '今日无新全球洞察' : '全球洞察',
      secondaryEyebrow: '规则恢复版本',
      title,
      summary: why,
    },
    question: {
      lead: fact,
      title: '它改变了结构，还是只改变了新闻标题？',
      footnote: match,
    },
    signals: {
      title: '信号与证据',
      sourceNote: 'AI 写作失败后，仅依据已验证的研究材料生成。',
      items: [
        {
          label: '信号 01', title, body: fact, whyImportant: why,
          evidence: { title: '当前证据', description: fact, confidence: level, sourceIds: ids },
        },
        {
          label: '信号 02', title: '结构关联', body: match, whyImportant: why,
          evidence: { title: '交叉确认', description: match, confidence: level, sourceIds: ids },
        },
      ],
    },
    pattern: {
      title: '可能正在发生的变化',
      before: '此前的基准判断仍然成立。',
      shift: fact,
      now: why,
      conclusion: match,
    },
    insight: {
      title: '当前判断',
      formula: '新证据 × 结构关联 = 潜在变化',
      explanation: why,
    },
    observe: {
      title: '下一步观察',
      items: [
        { label: '证据', prompt: '等待彼此独立的来源确认。', meta: '未来24–72小时' },
        { label: '规模', prompt: '确认变化是否超出单一事件。', meta: '后续发展' },
        { label: '结构', prompt: '观察系统关系或进程阶段是否改变。', meta: '判断触发点' },
      ],
      ending: '下一份独立证据，将决定它是否构成结构性变化。',
    },
  };
}

function dailyCopy(candidate, language) {
  const noNew = candidate.analysis?.dailyState === 'no_new_global_insight';
  if (language === 'zh') {
    return {
      label: noNew ? '今日无新洞察' : '今日全球洞察',
      decisionTitle: noNew ? '证据尚未跨过发布门槛' : '今天的最佳结构性信号',
      decisionSummary: text(candidate.content?.zh?.whyItMatters, '继续观察这个变化。'),
      thresholdReason: text(candidate.analysis?.rationale, '依据现有证据作出的规则判断。'),
      observeNext: ['等待独立来源确认', '观察影响范围是否扩大', '检查系统关系是否改变'],
    };
  }
  return {
    label: noNew ? 'NO NEW GLOBAL INSIGHT' : 'GLOBAL INSIGHT',
    decisionTitle: noNew ? 'Evidence remains below the publication threshold' : 'Today’s strongest structural signal',
    decisionSummary: text(candidate.content?.en?.whyItMatters, 'Continue observing this change.'),
    thresholdReason: text(candidate.analysis?.rationale, 'A rule-based decision from the available evidence.'),
    observeNext: ['Independent confirmation', 'Expansion beyond one event', 'A changed system relationship'],
  };
}

export function buildFallbackWriterDraft(researchDraft) {
  const candidate = researchDraft?.candidates?.[0];
  if (!candidate) throw new Error('Fallback writer requires an analyzed candidate.');

  const processId = candidate.analysis?.matchedProcessId || candidate.suggestedProcessId;
  const process = worldProcesses.find((item) => item.id === processId);
  const generated = {
    en: englishPage(candidate),
    zh: chinesePage(candidate),
    dailyState: { en: dailyCopy(candidate, 'en'), zh: dailyCopy(candidate, 'zh') },
    processUpdate: process ? {
      stage: process.currentStage || 'uncertain',
      content: {
        en: { title: text(candidate.content?.en?.title, 'Process update'), description: text(candidate.content?.en?.coreFact, 'New evidence arrived.'), implication: text(candidate.content?.en?.whyItMatters, 'Continue observing.') },
        zh: { title: text(candidate.content?.zh?.title, '进程更新'), description: text(candidate.content?.zh?.coreFact, '出现了新的证据。'), implication: text(candidate.content?.zh?.whyItMatters, '继续观察。') },
      },
      nextQuestion: { en: 'Will independent evidence confirm a structural change?', zh: '独立证据会确认结构性变化吗？' },
      observeNext: {
        en: ['Independent confirmation', 'Scale', 'Structural impact'],
        zh: ['独立确认', '影响规模', '结构影响'],
      },
    } : undefined,
  };

  return {
    ...buildWriterDraft({
      researchDraft,
      candidate,
      model: 'deterministic-fallback-v1',
      generated,
      process,
    }),
    provider: 'deterministic-fallback',
    pipeline: 'build014.2-recovery',
  };
}
