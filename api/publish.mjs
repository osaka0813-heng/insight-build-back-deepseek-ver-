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

function createReviewedDraft(writerDraft, { action, reviewedAt, overrideThreshold }) {
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
      publishThresholdMet: originalThresholdMet || overrideThreshold === true,
      humanApproved: overrideThreshold === true,
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


function isGitHubConflict(error) {
  const message =
    error instanceof Error ? error.message : String(error || '');
  return (
    message.includes('[status=409') ||
    message.includes('status=409') ||
    message.includes('but expected') ||
    message.includes('sha does not match')
  );
}

function buildNextContent({
  content,
  reviewedDraft,
  action,
  reviewedAt,
}) {
  const merged =
    action === 'approve'
      ? mergeApprovedDraft(
          content,
          reviewedDraft,
          reviewedAt,
        )
      : mergeRejectedDraft(
          content,
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

  return repairInsightProcessLinks(foundedContent);
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

    if (action === 'approve' && !thresholdMet && body.overrideThreshold !== true) {
      return json(res, 422, {
        ok: false,
        error: 'Candidate does not meet publication threshold. Two independent, current, clickable sources are required.',
      });
    }

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
      overrideThreshold: body.overrideThreshold,
    });

    let nextContent = buildNextContent({
      content: current.content,
      reviewedDraft,
      action,
      reviewedAt,
    });
    let nextValidation = validateContentBundle(nextContent);

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
    let alreadyProcessedAfterConflict = false;
    let writeAttempts = 0;
    let workingCurrent = current;

    while (writeAttempts < 3) {
      writeAttempts += 1;

      try {
        commit = await writeRemoteContent({
          config: workingCurrent.config,
          sha: workingCurrent.sha,
          content: nextContent,
          message,
        });
        break;
      } catch (error) {
        if (!isGitHubConflict(error) || writeAttempts >= 3) {
          return json(res, 502, {
            ok: false,
            stage: 'main-write',
            error:
              error instanceof Error
                ? error.message
                : 'Main content write failed.',
            writeAttempts,
            backup,
          });
        }

        // Another publish updated remote-content.json after we read it.
        // Re-read the newest SHA/content and merge this Writer Draft again.
        const fresh = await readRemoteContent();
        const freshValidation = validateContentBundle(fresh.content);

        if (!freshValidation.ok) {
          return json(res, 409, {
            ok: false,
            stage: 'conflict-refresh',
            error:
              'Remote content changed during publish and the refreshed content is invalid.',
            validation: freshValidation,
            backup,
          });
        }

        const processedAfterConflict = findProcessedDraft(
          fresh.content,
          writerDraft,
          action,
        );

        // Most duplicate button taps / parallel auto-publish calls land here:
        // the other request already published exactly this draft.
        if (processedAfterConflict?.alreadyProcessed) {
          workingCurrent = fresh;
          nextContent = fresh.content;
          alreadyProcessedAfterConflict = true;
          break;
        }

        workingCurrent = fresh;
        nextContent = buildNextContent({
          content: fresh.content,
          reviewedDraft,
          action,
          reviewedAt,
        });
        nextValidation = validateContentBundle(nextContent);

        if (!nextValidation.ok) {
          return json(res, 409, {
            ok: false,
            stage: 'conflict-remerge',
            error:
              'Content validation failed after re-merging against the newest remote content.',
            validation: nextValidation,
            backup,
          });
        }
      }
    }

    return json(res, 200, {
      ok: true,
      action,
      reviewedAt,
      alreadyProcessed: alreadyProcessedAfterConflict,
      conflictRecovered: writeAttempts > 1,
      writeAttempts,
      originalPublishThresholdMet: thresholdMet,
      contentVersion: nextContent.contentVersion,
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
      content: nextContent,
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
