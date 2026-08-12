
const GITHUB_API = 'https://api.github.com';
const JOB_DIR = process.env.AUTOMATION_JOB_DIR || 'automation-jobs';

function normalize(name, value) {
  if (typeof value !== 'string') return '';
  let result = value.trim();
  if (
    (result.startsWith('"') && result.endsWith('"')) ||
    (result.startsWith("'") && result.endsWith("'"))
  ) {
    result = result.slice(1, -1).trim();
  }
  if (name === 'GITHUB_TOKEN') {
    result = result
      .replace(/^GITHUB_TOKEN\s*=\s*/i, '')
      .replace(/^Bearer\s+/i, '')
      .trim();
  }
  return result;
}

function required(name) {
  const value = normalize(name, process.env[name]);
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function config() {
  return {
    token: required('GITHUB_TOKEN'),
    owner: required('GITHUB_OWNER'),
    repo: required('GITHUB_REPO'),
    branch: normalize('GITHUB_BRANCH', process.env.GITHUB_BRANCH) || 'main',
  };
}

function headers(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'insight-auto-runner',
  };
}

function pathFor(jobId) {
  return `${JOB_DIR}/${jobId}.json`;
}

function latestPath() {
  return `${JOB_DIR}/latest.json`;
}

async function readPath(path) {
  const cfg = config();
  const url = `${GITHUB_API}/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(cfg.branch)}`;
  const response = await fetch(url, { headers: headers(cfg.token) });
  if (response.status === 404) {
    return { config: cfg, sha: undefined, value: undefined };
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Automation state read failed: ${payload?.message || response.status}`,
    );
  }
  const raw = Buffer.from(
    String(payload.content || '').replace(/\n/g, ''),
    'base64',
  ).toString('utf8');
  return {
    config: cfg,
    sha: payload.sha,
    value: JSON.parse(raw),
  };
}

async function writePath(path, value, message) {
  const current = await readPath(path);
  const cfg = current.config;
  const url = `${GITHUB_API}/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(path)}`;
  const payload = {
    message,
    content: Buffer.from(
      `${JSON.stringify(value, null, 2)}\n`,
      'utf8',
    ).toString('base64'),
    branch: cfg.branch,
  };
  if (current.sha) payload.sha = current.sha;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      ...headers(cfg.token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Automation state write failed: ${body?.message || response.status}`,
    );
  }
  return body;
}

export async function createAutomationJob(job) {
  await writePath(
    pathFor(job.id),
    job,
    `Start Insight automation ${job.id}`,
  );
  await writePath(
    latestPath(),
    { jobId: job.id, updatedAt: job.updatedAt },
    `Point to latest Insight automation ${job.id}`,
  );
  return job;
}

export async function readAutomationJob(jobId) {
  const result = await readPath(pathFor(jobId));
  return result.value;
}

export async function readLatestAutomationJob() {
  const latest = await readPath(latestPath());
  const jobId = latest.value?.jobId;
  if (!jobId) return undefined;
  return readAutomationJob(jobId);
}

export async function saveAutomationJob(job) {
  job.updatedAt = new Date().toISOString();
  await writePath(
    pathFor(job.id),
    job,
    `Checkpoint Insight automation ${job.id}: ${job.currentScope || 'job'} ${job.currentStage || job.status}`,
  );
  return job;
}

export function publicAutomationJob(job) {
  if (!job) return undefined;
  const scopes = {};
  for (const [scope, item] of Object.entries(job.scopes || {})) {
    scopes[scope] = {
      status: item.status,
      stage: item.stage,
      failedStage: item.failedStage,
      attempts: item.attempts || {},
      message: item.message,
      insightId: item.insightId,
      contentVersion: item.contentVersion,
      candidateCount: item.candidateCount ?? item.researchDraft?.candidates?.length ?? 0,
      selectedCandidateId: item.selectedCandidateId ?? item.analyzedDraft?.selectedCandidateId,
      analyzeType: item.analyzeType ?? item.analyzedDraft?.selectedAnalyzeType,
      updatedAt: item.updatedAt,
      completedAt: item.completedAt,
      // Checkpoint availability only; large draft bodies stay server-side.
      checkpoints: {
        research: Boolean(item.researchDraft),
        analyze: Boolean(item.analyzedDraft),
        writeBase: Boolean(item.writeBase),
        writeZh: Boolean(item.writeZh),
        writeJa: Boolean(item.writeJa),
        writer: Boolean(item.writerDraft),
      },
    };
  }
  return {
    id: job.id,
    status: job.status,
    date: job.date,
    currentScope: job.currentScope,
    currentStage: job.currentStage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    message: job.message,
    scopes,
  };
}
