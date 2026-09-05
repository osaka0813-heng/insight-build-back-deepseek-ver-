
import { saveAutomationJob } from './automationJobStore.mjs';
import { analyzeDraft } from './analyst.mjs';
import worldProcesses from '../data/world-process-catalog.json' with { type: 'json' };
import { buildFallbackWriterDraft } from './fallbackWriter.mjs';

export const AUTO_SCOPES = ['global'];
export const SCOPE_LABELS = {
  global: 'WORLD',
};

const STAGES = [
  'research',
  'analyze',
  'write_base',
  'write_zh',
  'write_finalize',
  'publish',
];

export function defaultFocus(scope) {
  return '过去24小时内，先均衡扫描宏观金融、产业贸易、能源资源、健康科学、气候环境、人口社会、制度文化、技术AI与地缘安全，再选择有两条独立可点击证据、确实改变结构判断的信号。AI和战争不得因题材刺激而获得优先权。';
}

export function newScopeState() {
  return {
    status: 'queued',
    stage: 'research',
    attempts: {},
    message: '等待执行',
    updatedAt: new Date().toISOString(),
  };
}

export function newJob({ date, baseUrl }) {
  const now = new Date().toISOString();
  const id = `auto-${date}-${Date.now()}`;
  return {
    id,
    pipelineVersion: '014.2-global-en-zh',
    mode: 'global_en_zh',
    status: 'queued',
    date,
    baseUrl,
    currentScope: 'global',
    currentStage: 'preflight',
    createdAt: now,
    updatedAt: now,
    scopes: Object.fromEntries(
      AUTO_SCOPES.map((scope) => [scope, newScopeState()]),
    ),
  };
}

export function isLegacyJob(job) {
  return !job ||
    job.mode !== 'global_en_zh' ||
    Object.keys(job.scopes || {}).some((scope) => scope !== 'global') ||
    job.currentStage === 'write_ja';
}

export function resumeFailedCheckpoint(job) {
  const failed = Object.entries(job?.scopes || {}).find(([, state]) =>
    state?.status === 'error' || Boolean(state?.failedStage),
  );
  if (!failed) return undefined;

  const [scope, state] = failed;
  const stage = state.failedStage || state.stage;
  if (!STAGES.includes(stage)) return undefined;

  state.status = 'queued';
  state.stage = stage;
  state.message = `从 ${stage} 断点继续`;
  state.attempts = { ...(state.attempts || {}), [stage]: 0 };
  job.status = 'running';
  job.currentScope = scope;
  job.currentStage = stage;
  job.failedStage = undefined;
  job.completedAt = undefined;
  job.message = `${SCOPE_LABELS[scope] || scope.toUpperCase()} 从 ${stage} 断点继续`;
  return { scope, stage };
}

export function nextStage(stage) {
  const index = STAGES.indexOf(stage);
  if (index < 0 || index === STAGES.length - 1) return undefined;
  return STAGES[index + 1];
}

export function nextScope(scope) {
  const index = AUTO_SCOPES.indexOf(scope);
  if (index < 0 || index === AUTO_SCOPES.length - 1) return undefined;
  return AUTO_SCOPES[index + 1];
}

async function callJson(url, tokenHeader, token, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [tokenHeader]: token,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw Object.assign(
      new Error(`Service returned invalid JSON (${response.status}).`),
      { status: response.status },
    );
  }
  if (!response.ok || !payload?.ok) {
    throw Object.assign(
      new Error(payload?.error || `Request failed (${response.status}).`),
      { status: response.status, payload },
    );
  }
  return payload;
}

export async function executeOneStage(job) {
  const baseUrl = job.baseUrl;
  const researchToken = process.env.RESEARCH_API_TOKEN;
  const publishToken = process.env.PUBLISH_API_TOKEN;
  if (!researchToken || !publishToken) {
    throw new Error('RESEARCH_API_TOKEN / PUBLISH_API_TOKEN not configured.');
  }

  if (job.currentStage === 'preflight') {
    const result = await callJson(
      `${baseUrl}/api/preflight`,
      'x-publish-token',
      publishToken,
      {},
    );
    job.preflight = result;
    job.status = 'running';
    job.currentStage = 'research';
    job.message = '发布环境检查通过，开始 Global EN→ZH 任务。';
    await saveAutomationJob(job);
    return { done: false };
  }

  const scope = job.currentScope;
  const state = job.scopes[scope];
  const stage = job.currentStage;
  if (!STAGES.includes(stage)) {
    throw new Error(`Invalid automation stage: ${String(stage)}.`);
  }
  state.status = 'running';
  state.stage = stage;
  state.message = stage;
  state.updatedAt = new Date().toISOString();
  await saveAutomationJob(job);

  if (stage === 'research') {
    const result = await callJson(
      `${baseUrl}/api/research`,
      'x-research-token',
      researchToken,
      {
        scope,
        date: job.date,
        focus: defaultFocus(scope),
        maxSignals: 6,
      },
    );
    state.researchDraft = result;
  } else if (stage === 'analyze') {
    const result = await callJson(
      `${baseUrl}/api/analyze`,
      'x-research-token',
      researchToken,
      state.researchDraft,
    );
    state.analyzedDraft = result.draft;
    state.candidateCount = result.candidateCount ?? result.draft?.candidateCount ?? state.researchDraft?.candidates?.length ?? 0;
    state.selectedCandidateId = result.selectedCandidateId ?? result.draft?.selectedCandidateId;
    state.analyzeType = result.selectedAnalyzeType ?? result.draft?.selectedAnalyzeType;
  } else if (stage === 'write_base') {
    const result = await callJson(
      `${baseUrl}/api/write`,
      'x-research-token',
      researchToken,
      {
        stage: 'base',
        researchDraft: state.analyzedDraft,
        force: false,
      },
    );
    state.writeBase = result;
  } else if (stage === 'write_zh') {
    const result = await callJson(
      `${baseUrl}/api/write`,
      'x-research-token',
      researchToken,
      {
        stage: 'zh',
        researchDraft: state.analyzedDraft,
        baseDraft: state.writeBase.baseDraft,
        force: false,
      },
    );
    state.writeZh = result;
  } else if (stage === 'write_finalize') {
    const result = await callJson(
      `${baseUrl}/api/write`,
      'x-research-token',
      researchToken,
      {
        stage: 'finalize',
        researchDraft: state.analyzedDraft,
        baseDraft: state.writeBase.baseDraft,
        zhDraft: state.writeZh.localizedDraft,
        stageUsage: {
          base: state.writeBase.usage,
          zh: state.writeZh.usage,
        },
        stageModels: {
          base: state.writeBase.model,
          zh: state.writeZh.model,
        },
        force: false,
      },
    );
    state.writerDraft = result.writerDraft;
  } else if (stage === 'publish') {
    if (!state.writerDraft?.qualityChecks?.publishThresholdMet) {
      const result = await callJson(
        `${baseUrl}/api/publish`,
        'x-publish-token',
        publishToken,
        {
          action: 'reject',
          automatic: true,
          writerDraft: state.writerDraft,
        },
      );
      state.contentVersion = result.contentVersion;
      state.status = 'done';
      state.message = '今日无新增洞察判断已发布，保留最近一篇有效 Insight。';
      state.completedAt = new Date().toISOString();
      job.status = 'completed';
      job.currentStage = 'complete';
      job.completedAt = state.completedAt;
      job.message = state.message;
      await saveAutomationJob(job);
      return { done: true, published: true, insightPublished: false };
    }
    const result = await callJson(
      `${baseUrl}/api/publish`,
      'x-publish-token',
      publishToken,
      {
        action: 'approve',
        automatic: true,
        writerDraft: state.writerDraft,
      },
    );
    state.insightId = result.insightId || state.writerDraft?.insight?.id;
    state.contentVersion = result.contentVersion;
    state.status = 'done';
    state.message = '已发布';
    state.completedAt = new Date().toISOString();
    state.updatedAt = state.completedAt;

    job.status = 'completed';
    job.currentStage = 'complete';
    job.completedAt = new Date().toISOString();
    job.message = 'Global Insight 已自动发布。';
    await saveAutomationJob(job);
    return { done: true };
  }

  const followingStage = nextStage(stage);
  state.stage = followingStage || stage;
  state.status = 'checkpointed';
  state.message = `已保存 ${stage} 断点`;
  state.updatedAt = new Date().toISOString();
  job.currentStage = followingStage || stage;
  await saveAutomationJob(job);
  return { done: false };
}

function fallbackAnalyze(state) {
  const draft = analyzeDraft(state.researchDraft, worldProcesses);
  const candidates = [...(draft.candidates || [])].sort((a, b) => {
    const score = (item) =>
      Number(item.importance || 0) * 0.15 +
      Number(item.novelty || 0) * 0.1 +
      Number(item.evidenceStrength || 0) * 0.45 +
      Number(item.analysis?.materialChangeScore || 0) * 0.3;
    return score(b) - score(a);
  });
  state.analyzedDraft = {
    ...draft,
    candidates,
    analysisProvider: 'deterministic-fallback',
  };
}

export async function recoverStage(job, error) {
  const state = job.scopes.global;
  const stage = job.currentStage;

  if (stage === 'analyze' && state.researchDraft) {
    fallbackAnalyze(state);
    state.recoveredStage = stage;
    state.recoveryReason = error instanceof Error ? error.message : String(error);
    state.status = 'checkpointed';
    state.stage = 'write_base';
    job.currentStage = 'write_base';
    job.message = 'DeepSeek Analyze 失败，已用规则分析接管。';
    await saveAutomationJob(job);
    return true;
  }

  if (
    ['write_base', 'write_zh', 'write_finalize'].includes(stage) &&
    state.analyzedDraft
  ) {
    state.writerDraft = buildFallbackWriterDraft(state.analyzedDraft);
    state.recoveredStage = stage;
    state.recoveryReason = error instanceof Error ? error.message : String(error);
    state.status = 'checkpointed';
    state.stage = 'publish';
    job.currentStage = 'publish';
    job.message = 'DeepSeek Writer 失败，已用双语证据模板接管。';
    await saveAutomationJob(job);
    return true;
  }

  return false;
}

export async function recordStageFailure(job, error) {
  const scope = job.currentScope;
  const stage = job.currentStage;
  const state = job.scopes[scope];
  state.attempts = state.attempts || {};
  const attempts = Number(state.attempts[stage] || 0) + 1;
  state.attempts[stage] = attempts;
  state.failedStage = stage;
  state.message =
    error instanceof Error ? error.message : '未知自动流程错误';
  state.updatedAt = new Date().toISOString();

  if (attempts < 3) {
    state.status = 'retrying';
    job.status = 'running';
    job.message = `${SCOPE_LABELS[scope]} ${stage} 自动重试 ${attempts}/3`;
    await saveAutomationJob(job);
    return { shouldContinue: true };
  }

  if (await recoverStage(job, error)) {
    return { shouldContinue: true, recovered: true };
  }

  state.status = 'error';
  job.message = `${SCOPE_LABELS[scope]} 在 ${stage} 连续失败 3 次，已保留断点。`;
  job.status = 'failed';
  job.currentStage = stage;
  job.failedStage = stage;
  job.completedAt = new Date().toISOString();
  await saveAutomationJob(job);
  return { shouldContinue: false };
}
