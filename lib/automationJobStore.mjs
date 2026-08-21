
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
    branch:
      normalize('GITHUB_BRANCH', process.env.GITHUB_BRANCH) || 'main',
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

function isConflictStatus(status, message = '') {
  return (
    status === 409 ||
    String(message).includes('does not match') ||
    String(message).includes('but expected') ||
    String(message).includes('sha')
  );
}

async function readPath(path) {
  const cfg = config();
  const url =
    `${GITHUB_API}/repos/${cfg.owner}/${cfg.repo}/contents/` +
    `${encodeURIComponent(path)}?ref=${encodeURIComponent(cfg.branch)}`;

  const response = await fetch(url, {
    headers: headers(cfg.token),
  });

  if (response.status === 404) {
    return {
      config: cfg,
      sha: undefined,
      value: undefined,
    };
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `Automation state read failed: ${
        payload?.message || response.status
      }`,
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

async function putPath({
  path,
  value,
  message,
  expectedSha,
}) {
  const cfg = config();
  const url =
    `${GITHUB_API}/repos/${cfg.owner}/${cfg.repo}/contents/` +
    encodeURIComponent(path);

  const payload = {
    message,
    content: Buffer.from(
      `${JSON.stringify(value, null, 2)}\n`,
      'utf8',
    ).toString('base64'),
    branch: cfg.branch,
  };

  if (expectedSha) payload.sha = expectedSha;

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
    const error = new Error(
      `Automation state write failed: ${
        body?.message || response.status
      } [status=${response.status}; path=${path}]`,
    );
    error.status = response.status;
    error.githubMessage = body?.message;
    throw error;
  }

  return body;
}

async function writePath(path, value, message, maxAttempts = 5) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const current = await readPath(path);

    try {
      return await putPath({
        path,
        value,
        message,
        expectedSha: current.sha,
      });
    } catch (error) {
      lastError = error;

      if (
        !isConflictStatus(
          error?.status,
          error?.githubMessage || error?.message,
        ) ||
        attempt >= maxAttempts
      ) {
        throw error;
      }

      // Tiny jitter so two simultaneous Expo polls do not collide forever.
      await new Promise((resolve) =>
        setTimeout(resolve, 80 + attempt * 120),
      );
    }
  }

  throw lastError || new Error('Automation state write failed.');
}

async function mutatePath(
  path,
  mutate,
  message,
  maxAttempts = 6,
) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const current = await readPath(path);
    const next = await mutate(current.value, current);

    if (next === undefined) {
      return {
        changed: false,
        value: current.value,
      };
    }

    try {
      await putPath({
        path,
        value: next,
        message,
        expectedSha: current.sha,
      });

      return {
        changed: true,
        value: next,
      };
    } catch (error) {
      lastError = error;

      if (
        !isConflictStatus(
          error?.status,
          error?.githubMessage || error?.message,
        ) ||
        attempt >= maxAttempts
      ) {
        throw error;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, 80 + attempt * 120),
      );
    }
  }

  throw lastError || new Error('Automation state mutation failed.');
}

export async function createAutomationJob(job) {
  await writePath(
    pathFor(job.id),
    job,
    `Start Insight automation ${job.id}`,
  );

  await writePath(
    latestPath(),
    {
      jobId: job.id,
      updatedAt: job.updatedAt,
    },
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
    `Checkpoint Insight automation ${job.id}: ${
      job.currentScope || 'job'
    } ${job.currentStage || job.status}`,
  );

  return job;
}

export async function acquireAutomationLease(
  jobId,
  owner,
  ttlMs = 150_000,
) {
  const now = Date.now();
  const path = pathFor(jobId);

  const result = await mutatePath(
    path,
    (job) => {
      if (!job) return undefined;

      const expiresAt = Date.parse(job.lease?.expiresAt || '');
      const leaseActive =
        job.lease?.owner &&
        Number.isFinite(expiresAt) &&
        expiresAt > now;

      if (leaseActive && job.lease.owner !== owner) {
        return undefined;
      }

      return {
        ...job,
        lease: {
          owner,
          acquiredAt: new Date(now).toISOString(),
          expiresAt: new Date(now + ttlMs).toISOString(),
        },
        updatedAt: new Date(now).toISOString(),
      };
    },
    `Acquire Insight automation lease ${jobId}`,
  );

  const job = result.value;
  const acquired = job?.lease?.owner === owner;

  return {
    acquired,
    job,
  };
}

export async function releaseAutomationLease(jobId, owner) {
  return mutatePath(
    pathFor(jobId),
    (job) => {
      if (!job) return undefined;

      if (job.lease?.owner !== owner) {
        return undefined;
      }

      const next = { ...job };
      delete next.lease;
      next.updatedAt = new Date().toISOString();
      return next;
    },
    `Release Insight automation lease ${jobId}`,
  );
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
      updatedAt: item.updatedAt,
      completedAt: item.completedAt,
      checkpoints: {
        research: Boolean(item.researchDraft),
        analyze: Boolean(item.analyzedDraft),
        writeBase: Boolean(item.writeBase),
        writeZh: Boolean(item.writeZh),
        writer: Boolean(item.writerDraft),
      },
      recoveredStage: item.recoveredStage,
      recoveryReason: item.recoveryReason,
    };
  }

  return {
    id: job.id,
    pipelineVersion: job.pipelineVersion,
    mode: job.mode,
    status: job.status,
    date: job.date,
    currentScope: job.currentScope,
    currentStage: job.currentStage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    message: job.message,
    busy: Boolean(job.lease?.owner),
    scopes,
  };
}
