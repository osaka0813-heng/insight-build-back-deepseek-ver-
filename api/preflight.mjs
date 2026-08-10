import { readRemoteContent } from '../lib/githubContent.mjs';
import {
  createContentBackup,
  requiredEnvironmentChecks,
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

function getHeader(req, name) {
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
    getHeader(req, 'x-publish-token') !== process.env.PUBLISH_API_TOKEN
  ) {
    return json(res, 401, {
      ok: false,
      error: 'Unauthorized.',
    });
  }

  const checks = [];
  let current;

  const envChecks = requiredEnvironmentChecks();
  checks.push({
    id: 'environment',
    label: '环境变量',
    ok: envChecks.every((item) => item.ok),
    detail: envChecks
      .map((item) => `${item.name}:${item.ok ? 'OK' : 'MISSING'}`)
      .join(' · '),
  });

  try {
    current = await readRemoteContent();
    checks.push({
      id: 'github-read',
      label: 'GitHub 内容读取',
      ok: true,
      detail: `${current.config.owner}/${current.config.repo} · ${current.config.path}`,
    });
  } catch (error) {
    checks.push({
      id: 'github-read',
      label: 'GitHub 内容读取',
      ok: false,
      detail: error instanceof Error ? error.message : 'GitHub read failed.',
    });
  }

  if (current?.content) {
    const validation = validateContentBundle(current.content);
    checks.push({
      id: 'content-schema',
      label: '内容结构与引用',
      ok: validation.ok,
      detail: validation.ok
        ? `结构通过；${validation.warnings.length} 条警告。`
        : validation.errors.join(' | '),
    });

    try {
      const probe = {
        schemaVersion: current.content.schemaVersion,
        generatedAt: new Date().toISOString(),
        contentVersion: `preflight-probe-${Date.now()}`,
        insights: [],
        worldProcesses: [],
        dailyStates: [],
        note: 'This file verifies backup write permission only.',
      };
      const backup = await createContentBackup(
        probe,
        new Date().toISOString(),
      );
      checks.push({
        id: 'backup-write',
        label: '备份写入权限',
        ok: true,
        detail: backup.path,
      });
    } catch (error) {
      checks.push({
        id: 'backup-write',
        label: '备份写入权限',
        ok: false,
        detail: error instanceof Error ? error.message : 'Backup test failed.',
      });
    }
  } else {
    checks.push({
      id: 'content-schema',
      label: '内容结构与引用',
      ok: false,
      detail: '无法读取当前内容，因此未执行校验。',
    });
    checks.push({
      id: 'backup-write',
      label: '备份写入权限',
      ok: false,
      detail: '无法读取当前内容，因此未执行备份测试。',
    });
  }

  return json(res, 200, {
    ok: checks.every((check) => check.ok),
    checkedAt: new Date().toISOString(),
    contentVersion: current?.content?.contentVersion,
    repository: current?.config
      ? `${current.config.owner}/${current.config.repo}`
      : undefined,
    checks,
  });
}
