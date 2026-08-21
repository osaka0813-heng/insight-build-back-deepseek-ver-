import crypto from 'node:crypto';

const GITHUB_API = 'https://api.github.com';

function normalize(name, value) {
  if (typeof value !== 'string') return '';
  let normalized = value.trim();

  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }

  if (name === 'GITHUB_TOKEN') {
    normalized = normalized
      .replace(/^GITHUB_TOKEN\s*=\s*/i, '')
      .replace(/^Bearer\s+/i, '')
      .trim();
  }

  return normalized;
}

function fingerprint(value) {
  if (!value) return null;
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex')
    .slice(0, 12);
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, x-admin-token',
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

  if (req.method !== 'GET') {
    return json(res, 405, {
      ok: false,
      error: 'Method not allowed. Use GET.',
    });
  }

  const adminToken = normalize(
    'ADMIN_CONSOLE_TOKEN',
    process.env.ADMIN_CONSOLE_TOKEN,
  );

  if (!adminToken || header(req, 'x-admin-token') !== adminToken) {
    return json(res, 401, {
      ok: false,
      error: 'Unauthorized.',
    });
  }

  const token = normalize('GITHUB_TOKEN', process.env.GITHUB_TOKEN);
  const owner = normalize('GITHUB_OWNER', process.env.GITHUB_OWNER);
  const repo = normalize('GITHUB_REPO', process.env.GITHUB_REPO);
  const branch = normalize(
    'GITHUB_BRANCH',
    process.env.GITHUB_BRANCH || 'main',
  );
  const path = normalize(
    'REMOTE_CONTENT_PATH',
    process.env.REMOTE_CONTENT_PATH || 'remote-content.json',
  );

  const result = {
    ok: false,
    deployment: {
      vercelEnv: process.env.VERCEL_ENV || null,
      vercelUrl: process.env.VERCEL_URL || null,
      commitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    },
    configuration: {
      owner,
      repo,
      branch,
      path,
      tokenPresent: Boolean(token),
      tokenLength: token.length,
      tokenPrefix: token ? token.slice(0, 11) : null,
      tokenFingerprint: fingerprint(token),
      tokenHadOuterWhitespace:
        typeof process.env.GITHUB_TOKEN === 'string' &&
        process.env.GITHUB_TOKEN !== process.env.GITHUB_TOKEN.trim(),
    },
  };

  if (!token || !owner || !repo) {
    return json(res, 200, {
      ...result,
      error: 'Required GitHub configuration is missing.',
    });
  }

  const url =
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/` +
    `${encodeURIComponent(repo)}/contents/` +
    `${path.split('/').map(encodeURIComponent).join('/')}?ref=` +
    encodeURIComponent(branch);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'insight-github-diagnostic',
      },
    });

    const payload = await response.json().catch(() => ({}));

    return json(res, 200, {
      ...result,
      ok: response.ok,
      github: {
        status: response.status,
        message: payload?.message || null,
        requestId:
          response.headers.get('x-github-request-id') || null,
        fileName: payload?.name || null,
        filePath: payload?.path || null,
        sha: payload?.sha || null,
      },
    });
  } catch (error) {
    return json(res, 200, {
      ...result,
      error:
        error instanceof Error
          ? error.message
          : 'GitHub diagnostic request failed.',
    });
  }
}
