
import {
  acquireAutomationLease,
  publicAutomationJob,
  readAutomationJob,
  releaseAutomationLease,
  saveAutomationJob,
} from '../lib/automationJobStore.mjs';
import {
  executeOneStage,
  isLegacyJob,
  recordStageFailure,
} from '../lib/automationRunner.mjs';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, x-research-token, x-publish-token',
  );
}

function send(res, status, payload) {
  cors(res);
  return res.status(status).json(payload);
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return send(res, 405, {
      ok: false,
      error: 'Use POST.',
    });
  }

  if (
    req.headers?.['x-research-token'] !==
      process.env.RESEARCH_API_TOKEN ||
    req.headers?.['x-publish-token'] !==
      process.env.PUBLISH_API_TOKEN
  ) {
    return send(res, 401, {
      ok: false,
      error: 'Unauthorized.',
    });
  }

  const body =
    typeof req.body === 'object'
      ? req.body
      : JSON.parse(req.body || '{}');

  const jobId = body.jobId;

  if (!jobId) {
    return send(res, 400, {
      ok: false,
      error: 'jobId is required.',
    });
  }

  const owner =
    `resume-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;

  let leaseAcquired = false;

  try {
    const lease = await acquireAutomationLease(
      jobId,
      owner,
    );

    if (!lease.acquired) {
      const current = await readAutomationJob(jobId);

      return send(res, 202, {
        ok: true,
        job: publicAutomationJob(current),
        busy: true,
        message:
          '当前断点仍在执行，不需要重复启动。',
        driver: 'checkpoint-lease-v2',
      });
    }

    leaseAcquired = true;
    const job = lease.job;

    if (!job) {
      return send(res, 404, {
        ok: false,
        error: 'Job not found.',
      });
    }

    if (isLegacyJob(job)) {
      return send(res, 409, {
        ok: false,
        code: 'LEGACY_JOB_SUPERSEDED',
        error: '旧四区域/日文任务不能继续，请启动新的 Global EN→ZH 任务。',
      });
    }

    if (
      job.status === 'completed' &&
      job.currentStage === 'complete'
    ) {
      return send(res, 409, {
        ok: false,
        error:
          'This automation job is already complete.',
      });
    }

    const failed = Object.entries(
      job.scopes || {},
    ).find(([, state]) => state.status === 'error');

    let scope = job.currentScope || 'global';
    let stage = job.currentStage || 'research';

    if (failed) {
      scope = failed[0];
      const state = failed[1];

      stage =
        state.failedStage ||
        state.stage ||
        'research';

      state.status = 'queued';
      state.stage = stage;
      state.message = `从 ${stage} 断点继续`;
      state.attempts = {
        ...(state.attempts || {}),
        [stage]: 0,
      };
    } else {
      const state = job.scopes?.[scope];

      if (state) {
        state.status = 'queued';
        state.stage = stage;
        state.message = `重新唤醒 ${stage} 断点`;
      }
    }

    job.status = 'running';
    job.currentScope = scope;
    job.currentStage = stage;
    job.completedAt = undefined;
    job.message =
      `${scope.toUpperCase()} 从 ${stage} 断点继续`;

    await saveAutomationJob(job);

    try {
      await executeOneStage(job);
    } catch (stageError) {
      await recordStageFailure(job, stageError);
    }

    const refreshed =
      await readAutomationJob(job.id);

    return send(res, 202, {
      ok: true,
      job: publicAutomationJob(
        refreshed || job,
      ),
      busy: false,
      driver: 'checkpoint-lease-v2',
    });
  } catch (error) {
    return send(res, 500, {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'Resume failed.',
    });
  } finally {
    if (leaseAcquired) {
      try {
        await releaseAutomationLease(
          jobId,
          owner,
        );
      } catch (releaseError) {
        console.error(
          'Automation lease release failed:',
          releaseError,
        );
      }
    }
  }
}
