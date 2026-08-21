
import {
  acquireAutomationLease,
  publicAutomationJob,
  readAutomationJob,
  readLatestAutomationJob,
  releaseAutomationLease,
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
    'Content-Type, x-research-token',
  );
}

function send(res, status, payload) {
  cors(res);
  return res.status(status).json(payload);
}

function requestId() {
  return `poll-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
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
    process.env.RESEARCH_API_TOKEN
  ) {
    return send(res, 401, {
      ok: false,
      error: 'Unauthorized.',
    });
  }

  let jobId;
  let owner;
  let leaseAcquired = false;

  try {
    const body =
      typeof req.body === 'object'
        ? req.body
        : JSON.parse(req.body || '{}');

    let job = body.jobId
      ? await readAutomationJob(body.jobId)
      : await readLatestAutomationJob();

    if (!job) {
      return send(res, 200, {
        ok: true,
        job: undefined,
        driver: 'checkpoint-lease-v2',
      });
    }

    if (isLegacyJob(job)) {
      return send(res, 409, {
        ok: false,
        code: 'LEGACY_JOB_SUPERSEDED',
        error: '旧四区域/日文任务已停用，请启动新的 Global EN→ZH 任务。',
        job: publicAutomationJob(job),
      });
    }

    jobId = job.id;

    const terminal =
      job.status === 'completed' ||
      job.status === 'completed_with_errors';

    if (!terminal && body.advance !== false) {
      owner = requestId();

      const lease = await acquireAutomationLease(
        job.id,
        owner,
      );

      if (!lease.acquired) {
        // Another poll is already executing this stage.
        const fresh = await readAutomationJob(job.id);

        return send(res, 200, {
          ok: true,
          job: publicAutomationJob(fresh),
          busy: true,
          driver: 'checkpoint-lease-v2',
        });
      }

      leaseAcquired = true;
      job = lease.job;

      try {
        await executeOneStage(job);
      } catch (stageError) {
        await recordStageFailure(job, stageError);
      }

      job = await readAutomationJob(job.id);
    }

    return send(res, 200, {
      ok: true,
      job: publicAutomationJob(job),
      busy: false,
      driver: 'checkpoint-lease-v2',
    });
  } catch (error) {
    return send(res, 500, {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'Status failed.',
    });
  } finally {
    if (leaseAcquired && jobId && owner) {
      try {
        await releaseAutomationLease(jobId, owner);
      } catch (releaseError) {
        console.error(
          'Automation lease release failed:',
          releaseError,
        );
      }
    }
  }
}
