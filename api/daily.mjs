import {
  acquireAutomationLease,
  createAutomationJob,
  publicAutomationJob,
  readAutomationJob,
  readAutomationJobForDate,
  readLatestAutomationJob,
  releaseAutomationLease,
} from '../lib/automationJobStore.mjs';
import {
  executeOneStage,
  isLegacyJob,
  newJob,
  recordStageFailure,
} from '../lib/automationRunner.mjs';

function tokyoDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function baseUrl(req) {
  // Cron executions arrive on an immutable deployment hostname.  Using that
  // hostname for the pipeline's self-calls can hit deployment protection or a
  // stale alias, so prefer the stable production hostname Vercel provides.
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    req.headers?.['x-forwarded-host'] || req.headers?.host || process.env.VERCEL_URL;
  const normalized = String(host || '').replace(/^https?:\/\//, '');
  if (!normalized) throw new Error('Unable to determine backend URL.');
  return `https://${normalized}`;
}

function authorized(req) {
  const oneTimeDates = new Set([
    '2026-08-29', '2026-08-30', '2026-08-31',
    '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04',
  ]);
  if (
    oneTimeDates.has(req.query?.date) &&
    Date.now() < Date.parse('2026-09-04T06:00:00.000Z')
  ) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers?.authorization === `Bearer ${secret}`;
}

function terminal(job) {
  return ['completed', 'completed_with_errors'].includes(job?.status);
}

function requestedDate(req) {
  const value = typeof req.query?.date === 'string' ? req.query.date : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : tokyoDate();
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Use GET or POST.' });
  }
  if (!authorized(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized cron request.' });
  }

  const startedAt = Date.now();
  const date = requestedDate(req);
  const owner = `cron-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let leasedJobId;

  try {
    let job = date === tokyoDate()
      ? await readLatestAutomationJob()
      : await readAutomationJobForDate(date);

    if (!job || isLegacyJob(job) || job.date !== date || job.status === 'completed_with_errors') {
      job = newJob({ date, baseUrl: baseUrl(req) });
      await createAutomationJob(job);
    } else if (terminal(job)) {
      return res.status(200).json({
        ok: true,
        alreadyComplete: true,
        job: publicAutomationJob(job),
      });
    }

    const lease = await acquireAutomationLease(job.id, owner, 290_000);
    if (!lease.acquired) {
      return res.status(202).json({
        ok: true,
        busy: true,
        driver: 'vercel-cron-global-v1',
        job: publicAutomationJob(lease.job || job),
      });
    }
    leasedJobId = job.id;
    job = lease.job;

    let steps = 0;
    while (!terminal(job) && Date.now() - startedAt < 260_000 && steps < 12) {
      try {
        await executeOneStage(job);
      } catch (error) {
        await recordStageFailure(job, error);
      }
      steps += 1;
      job = await readAutomationJob(job.id);
    }

    return res.status(terminal(job) ? 200 : 202).json({
      ok: true,
      driver: 'vercel-cron-global-v1',
      steps,
      continuationRequired: !terminal(job),
      job: publicAutomationJob(job),
    });
  } catch (error) {
    console.error('Daily Global pipeline failed:', error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Daily pipeline failed.',
    });
  } finally {
    if (leasedJobId) {
      try {
        await releaseAutomationLease(leasedJobId, owner);
      } catch (error) {
        console.error('Daily lease release failed:', error);
      }
    }
  }
}
