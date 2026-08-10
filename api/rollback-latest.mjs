import { readRemoteContent, writeRemoteContent } from '../lib/githubContent.mjs';
import {
  readLatestContentBackup,
  validateContentBundle,
} from '../lib/contentSafety.mjs';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, x-publish-token',
  );
}

function json(res, status, payload) {
  setCors(res);
  return res.status(status).json(payload);
}

function header(req, name) {
  const value = req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
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

  if (
    !process.env.PUBLISH_API_TOKEN ||
    header(req, 'x-publish-token') !== process.env.PUBLISH_API_TOKEN
  ) {
    return json(res, 401, {
      ok: false,
      error: 'Unauthorized.',
    });
  }

  try {
    const backup = await readLatestContentBackup();
    const validation = validateContentBundle(backup.content);

    if (!validation.ok) {
      return json(res, 409, {
        ok: false,
        error: 'The latest backup is not valid and was not restored.',
        validation,
      });
    }

    const current = await readRemoteContent();
    const restored = {
      ...backup.content,
      generatedAt: new Date().toISOString(),
      contentVersion: `rollback-${Date.now()}-${backup.content.contentVersion}`,
    };

    const commit = await writeRemoteContent({
      config: current.config,
      sha: current.sha,
      content: restored,
      message: `Rollback remote content from ${backup.path}`,
    });

    return json(res, 200, {
      ok: true,
      backupPath: backup.path,
      contentVersion: restored.contentVersion,
      content: restored,
      commit,
    });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'Rollback failed.',
    });
  }
}
