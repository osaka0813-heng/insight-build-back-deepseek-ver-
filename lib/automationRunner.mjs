
import { saveAutomationJob } from './automationJobStore.mjs';

export const AUTO_SCOPES = ['global', 'china', 'us', 'japan'];
export const SCOPE_LABELS = {
  global: 'WORLD',
  china: 'CHINA',
  us: 'US',
  japan: 'JAPAN',
};

const STAGES = [
  'research',
  'analyze',
  'write_base',
  'write_zh',
  'write_ja',
  'write_finalize',
  'publish',
];

export function defaultFocus(scope) {
  if (scope === 'japan') {
    return '过去24小时内，寻找最可能改变日本进程判断的重要信号，重点关注货币与日元、工资与通胀、人口与劳动力、产业重建、能源、安全与资本流动。';
  }
  if (scope === 'china') {
    return '过去24小时内，寻找最可能改变中国进程判断的重要信号，重点关注房地产与地方财政、产业升级、科技自主化、内需、宏观政策与资本。';
  }
  if (scope === 'us') {
    return '过去24小时内，寻找最可能改变美国进程判断的重要信号，重点关注财政与利率、美元、AI资本开支、电力、再工业化、劳动力与移民。';
  }
  return '过去24小时内，寻找最可能改变现有世界进程判断的重要跨领域信号，重点关注AI、能源、地缘政治、宏观经济与资本。';
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
    job.message = '发布环境检查通过，开始四区域任务。';
    await saveAutomationJob(job);
    return { done: false };
  }

  const scope = job.currentScope;
  const state = job.scopes[scope];
  const stage = job.currentStage;
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
  } else if (stage === 'write_ja') {
    const result = await callJson(
      `${baseUrl}/api/write`,
      'x-research-token',
      researchToken,
      {
        stage: 'ja',
        researchDraft: state.analyzedDraft,
        baseDraft: state.writeBase.baseDraft,
        force: false,
      },
    );
    state.writeJa = result;
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
        jaDraft: state.writeJa.localizedDraft,
        stageUsage: {
          base: state.writeBase.usage,
          zh: state.writeZh.usage,
          ja: state.writeJa.usage,
        },
        stageModels: {
          base: state.writeBase.model,
          zh: state.writeZh.model,
          ja: state.writeJa.model,
        },
        force: false,
      },
    );
    state.writerDraft = result.writerDraft;
  } else if (stage === 'publish') {
    const result = await callJson(
      `${baseUrl}/api/publish`,
      'x-publish-token',
      publishToken,
      {
        action: 'approve',
        writerDraft: state.writerDraft,
      },
    );
    state.insightId = result.insightId || state.writerDraft?.insight?.id;
    state.contentVersion = result.contentVersion;
    state.status = 'done';
    state.message = '已发布';
    state.completedAt = new Date().toISOString();
    state.updatedAt = state.completedAt;

    const followingScope = nextScope(scope);
    if (followingScope) {
      job.currentScope = followingScope;
      job.currentStage = 'research';
      job.scopes[followingScope].status = 'queued';
      job.scopes[followingScope].message = '等待执行';
    } else {
      job.status = Object.values(job.scopes).some(
        (item) => item.status === 'error',
      )
        ? 'completed_with_errors'
        : 'completed';
      job.currentStage = 'complete';
      job.completedAt = new Date().toISOString();
      job.message =
        job.status === 'completed'
          ? '四区域自动更新完成。'
          : '自动更新完成，但有区域需要继续重试。';
      await saveAutomationJob(job);
      return { done: true };
    }
    await saveAutomationJob(job);
    return { done: false };
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

  state.status = 'error';
  job.message = `${SCOPE_LABELS[scope]} 在 ${stage} 连续失败 3 次，保留断点并跳到下一区域。`;

  const followingScope = nextScope(scope);
  if (followingScope) {
    job.currentScope = followingScope;
    job.currentStage = 'research';
    job.scopes[followingScope].status = 'queued';
    await saveAutomationJob(job);
    return { shouldContinue: true };
  }

  job.status = 'completed_with_errors';
  job.currentStage = 'complete';
  job.completedAt = new Date().toISOString();
  await saveAutomationJob(job);
  return { shouldContinue: false };
}
