
import {
  createAutomationJob,
  publicAutomationJob,
  readAutomationJob,
} from '../lib/automationJobStore.mjs';
import {
  executeOneStage,
  newJob,
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

function header(req, name) {
  const value = req.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function baseUrl(req) {
  const host =
    header(req, 'x-forwarded-host') ||
    header(req, 'host') ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL;
  const normalized = String(host || '').replace(/^https?:\/\//, '');
  if (!normalized) throw new Error('Unable to determine backend URL.');
  return `https://${normalized}`;
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
    header(req, 'x-research-token') !== process.env.RESEARCH_API_TOKEN ||
    header(req, 'x-publish-token') !== process.env.PUBLISH_API_TOKEN
  ) {
    return send(res, 401, { ok: false, error: 'Unauthorized.' });
  }

  try {
    const body =
      typeof req.body === 'object'
        ? req.body
        : JSON.parse(req.body || '{}');

    const date =
      typeof body.date === 'string' && body.date
        ? body.date
        : new Date().toISOString().slice(0, 10);

    const job = newJob({
      date,
      baseUrl: baseUrl(req),
    });

    await createAutomationJob(job);

    // Zeta deliberately performs exactly one checkpointed stage per request.
    // This avoids recursive/self-invoked Vercel Functions and makes deployment
    // behavior predictable. The Expo status heartbeat advances later stages.
    try {
      await executeOneStage(job);
    } catch (stageError) {
      await recordStageFailure(job, stageError);
    }

    const saved = await readAutomationJob(job.id);

    return send(res, 202, {
      ok: true,
      job: publicAutomationJob(saved || job),
      driver: 'checkpoint-heartbeat-v1',
    });
  } catch (error) {
    return send(res, 500, {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'Auto start failed.',
    });
  }
}
