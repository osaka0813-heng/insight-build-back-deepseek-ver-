import { readRemoteContent, writeRemoteContent } from '../lib/githubContent.mjs';
import { mergeApprovedDraft, mergeRejectedDraft } from '../lib/publisher.mjs';
import { applyWorldProcessFoundation } from '../lib/worldProcessFoundation.mjs';
import { repairInsightProcessLinks } from '../lib/insightProcessLinkage.mjs';
import {
  createContentBackup,
  findProcessedDraft,
  validateContentBundle,
} from '../lib/contentSafety.mjs';
import { repairWriterDraft } from '../lib/writerDraftRepair.mjs';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-publish-token');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function json(res, status, payload) {
  setCors(res);
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      const error = new Error('Request body must be valid JSON.');
      error.status = 400;
      throw error;
    }
  }
  return {};
}

function getHeader(req, name) {
  const value = req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function createReviewedDraft(writerDraft, { action, reviewedAt }) {
  const originalThresholdMet =
    writerDraft?.qualityChecks?.publishThresholdMet === true;

  const review = {
    decision: action === 'approve' ? 'approved' : 'rejected',
    reviewedAt,
    originalPublishThresholdMet: originalThresholdMet,
    originalDailyState: writerDraft?.dailyState || null,
  };

  if (action === 'reject') return { ...writerDraft, review };

  return {
    ...writerDraft,
    qualityChecks: {
      ...(writerDraft.qualityChecks || {}),
      // Human approval is the final publication decision.
      publishThresholdMet: true,
      humanApproved: true,
      originalPublishThresholdMet: originalThresholdMet,
    },
    review,
  };
}

function mapKnownError(error) {
  const message =
    error instanceof Error ? error.message : 'Unknown publish error.';

  if (message.includes('publication threshold')) {
    return { status: 422, message };
  }

  if (
    message.includes('required') ||
    message.includes('must be') ||
    message.includes('valid JSON') ||
    message.includes('Content validation failed')
  ) {
    return { status: 400, message };
  }

  return { status: 500, message };
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return json(res, 405, {
      ok: false,
      error: 'Method not allowed. Use POST.',
    });
  }

  try {
    if (!process.env.PUBLISH_API_TOKEN) {
      return json(res, 500, {
        ok: false,
        error: 'PUBLISH_API_TOKEN is not configured.',
      });
    }

    if (getHeader(req, 'x-publish-token') !== process.env.PUBLISH_API_TOKEN) {
      return json(res, 401, {
        ok: false,
        error: 'Unauthorized.',
      });
    }

    const body = parseBody(req);
    const action = body.action;
    const writerDraft = repairWriterDraft(body.writerDraft);

    if (!['approve', 'reject'].includes(action)) {
      return json(res, 400, {
        ok: false,
        error: 'action must be approve or reject.',
      });
    }

    if (!writerDraft?.id) {
      return json(res, 400, {
        ok: false,
        error: 'writerDraft is required.',
      });
    }

    const current = await readRemoteContent();
    const currentValidation = validateContentBundle(current.content);

    if (!currentValidation.ok) {
      return json(res, 409, {
        ok: false,
        error:
          'Current remote-content is invalid. Publishing is blocked until it is repaired.',
        validation: currentValidation,
      });
    }

    const processed = findProcessedDraft(
      current.content,
      writerDraft,
      action,
    );

    if (processed?.alreadyProcessed) {
      return json(res, 200, {
        ok: true,
        action,
        reviewedAt: processed.reviewedAt,
        alreadyProcessed: true,
        previousDecision: processed.decision,
        contentVersion: current.content.contentVersion,
        insightId:
          action === 'approve'
            ? writerDraft.insight?.id
            : undefined,
        content: current.content,
        safety: {
          validatedAt: new Date().toISOString(),
        },
      });
    }

    const thresholdMet =
      writerDraft?.qualityChecks?.publishThresholdMet === true;

    const reviewedAt = new Date().toISOString();

    let backup;
    try {
      backup = await createContentBackup(
        current.content,
        reviewedAt,
        current.config,
      );
    } catch (error) {
      return json(res, 502, {
        ok: false,
        stage: 'backup',
        error:
          error instanceof Error
            ? error.message
            : 'Backup creation failed.',
      });
    }

    const reviewedDraft = createReviewedDraft(writerDraft, {
      action,
      reviewedAt,
    });

    const merged =
      action === 'approve'
        ? mergeApprovedDraft(
            current.content,
            reviewedDraft,
            reviewedAt,
          )
        : mergeRejectedDraft(
            current.content,
            reviewedDraft,
            reviewedAt,
          );

    const foundedContent =
      action === 'approve'
        ? applyWorldProcessFoundation(
            merged,
            reviewedDraft,
            reviewedAt,
          )
        : merged;

    const nextContent = repairInsightProcessLinks(foundedContent);
    const nextValidation = validateContentBundle(nextContent);

    if (!nextValidation.ok) {
      return json(res, 409, {
        ok: false,
        error:
          'Content validation failed after merge. No main content was written.',
        validation: nextValidation,
        backup,
      });
    }

    const message =
      action === 'approve'
        ? `Publish Insight ${writerDraft.insight?.id || writerDraft.id}`
        : `Reject Writer Draft ${writerDraft.id}`;

    let commit;
    let committedContent = nextContent;
    let writeBase = current;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        commit = await writeRemoteContent({ config: writeBase.config, sha: writeBase.sha, content: committedContent, message });
        break;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Main content write failed.';
        const isConflict = errorMessage.includes('status=409') || /is at .* but expected/i.test(errorMessage);
        if (!isConflict || attempt === 3) {
          return json(res, 502, { ok: false, stage: 'main-write', error: errorMessage, backup, conflictAttempts: attempt });
        }
        writeBase = await readRemoteContent();
        const concurrent = findProcessedDraft(writeBase.content, writerDraft, action);
        if (concurrent?.alreadyProcessed) {
          return json(res, 200, { ok: true, action, reviewedAt: concurrent.reviewedAt, alreadyProcessed: true, conflictRecovered: true, contentVersion: writeBase.content.contentVersion, insightId: action === 'approve' ? writerDraft.insight?.id : undefined, content: writeBase.content, safety: { backupPath: backup.path, backupCommitSha: backup.commitSha, validatedAt: new Date().toISOString() } });
        }
        const remerged = action === 'approve'
          ? mergeApprovedDraft(writeBase.content, reviewedDraft, reviewedAt)
          : mergeRejectedDraft(writeBase.content, reviewedDraft, reviewedAt);
        const refounded = action === 'approve' ? applyWorldProcessFoundation(remerged, reviewedDraft, reviewedAt) : remerged;
        committedContent = repairInsightProcessLinks(refounded);
        const retryValidation = validateContentBundle(committedContent);
        if (!retryValidation.ok) return json(res, 409, { ok: false, error: 'Content validation failed after conflict recovery merge.', validation: retryValidation, backup });
      }
    }

    return json(res, 200, {
      ok: true,
      action,
      reviewedAt,
      alreadyProcessed: false,
      originalPublishThresholdMet: thresholdMet,
      contentVersion: committedContent.contentVersion,
      insightId:
        action === 'approve'
          ? writerDraft.insight?.id
          : undefined,
      processId:
        action === 'approve'
          ? writerDraft.processUpdate?.processId ||
            writerDraft.matchedProcessId ||
            writerDraft.insight?.processId
          : undefined,
      commit,
      content: committedContent,
      conflictRecovered: writeBase.sha !== current.sha,
      safety: {
        backupPath: backup.path,
        backupCommitSha: backup.commitSha,
        validatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Publish API failed:', error);
    const mapped = mapKnownError(error);

    return json(res, mapped.status, {
      ok: false,
      error: mapped.message,
    });
  }
}
