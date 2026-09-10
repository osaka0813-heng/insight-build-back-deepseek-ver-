import {
  acquireAutomationLease,
  createAutomationJob,
  publicAutomationJob,
  readAutomationJob,
  readAutomationJobForDate,
  readLatestAutomationJob,
  releaseAutomationLease,
  saveAutomationJob,
} from '../lib/automationJobStore.mjs';
import {
  executeOneStage,
  isLegacyJob,
  newJob,
  recordStageFailure,
  resumeFailedCheckpoint,
} from '../lib/automationRunner.mjs';
import { readRemoteContent } from '../lib/githubContent.mjs';

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
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers?.authorization === `Bearer ${secret}`;
}

function terminal(job) {
  return job?.status === 'completed';
}

function explicitDate(req) {
  const value = typeof req.query?.date === 'string' ? req.query.date : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

async function observationExists(date) {
  const remote = await readRemoteContent();
  return (remote.content?.dailyStates || []).some(
    (state) => state?.date === date,
  );
}

async function reopenMissingPublication(job) {
  if (job?.status !== 'completed' || await observationExists(job.date)) {
    return false;
  }
  const state = job.scopes?.global;
  if (!state?.writerDraft) return false;
  state.status = 'checkpointed';
  state.stage = 'publish';
  state.message = '修复缺失的每日公开记录';
  job.status = 'running';
  job.currentScope = 'global';
  job.currentStage = 'publish';
  job.completedAt = undefined;
  job.message = '重新发布缺失的每日观察';
  await saveAutomationJob(job);
  return true;
}

export function shiftDate(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

async function scheduledDate(req) {
  const requested = explicitDate(req);
  if (requested) return requested;

  const today = tokyoDate();
  const todayJob = await readAutomationJobForDate(today);
  if (!todayJob || isLegacyJob(todayJob) || todayJob.status !== 'completed') {
    return today;
  }

  // Once today's observation is safely published, use later wake-ups to heal
  // either of the two immediately preceding dates, oldest first.
  for (const offset of [-2, -1]) {
    const date = shiftDate(today, offset);
    const job = await readAutomationJobForDate(date);
    if (job && !isLegacyJob(job) && job.status !== 'completed') return date;
  }
  return today;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Use GET or POST.' });
  }
  if (!authorized(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized cron request.' });
  }

  const startedAt = Date.now();
  const date = await scheduledDate(req);
  const owner = `cron-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let leasedJobId;

  try {
    let job = date === tokyoDate()
      ? await readLatestAutomationJob()
      : await readAutomationJobForDate(date);

    if (!job || isLegacyJob(job) || job.date !== date) {
      job = newJob({ date, baseUrl: baseUrl(req) });
      await createAutomationJob(job);
    } else if (['completed_with_errors', 'failed'].includes(job.status)) {
      const resumed = resumeFailedCheckpoint(job);
      if (!resumed) {
        job.status = 'failed';
        job.message = '旧失败任务没有可恢复的有效阶段。';
        return res.status(200).json({
          ok: false,
          unrecoverable: true,
          job: publicAutomationJob(job),
        });
      }
      await saveAutomationJob(job);
    } else if (job.status === 'completed' && !(await reopenMissingPublication(job))) {
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
