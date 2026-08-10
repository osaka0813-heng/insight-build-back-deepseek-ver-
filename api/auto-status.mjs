
import {
  publicAutomationJob,
  readAutomationJob,
  readLatestAutomationJob,
} from '../lib/automationJobStore.mjs';
import {
  executeOneStage,
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

export default async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return send(res, 405, { ok: false, error: 'Use POST.' });
  }

  if (
    req.headers?.['x-research-token'] !==
    process.env.RESEARCH_API_TOKEN
  ) {
    return send(res, 401, { ok: false, error: 'Unauthorized.' });
  }

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
        driver: 'checkpoint-heartbeat-v1',
      });
    }

    const terminal =
      job.status === 'completed' ||
      job.status === 'completed_with_errors';

    if (!terminal && body.advance !== false) {
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
      driver: 'checkpoint-heartbeat-v1',
    });
  } catch (error) {
    return send(res, 500, {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'Status failed.',
    });
  }
}
