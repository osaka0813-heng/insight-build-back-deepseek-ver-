import crypto from 'node:crypto';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, x-admin-token',
  );
  res.setHeader('Access-Control-Max-Age', '86400');
}

function json(res, status, payload) {
  setCors(res);
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function getHeader(req, name) {
  const value = req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function safeEqual(left, right) {
  const leftHash = crypto
    .createHash('sha256')
    .update(String(left || ''), 'utf8')
    .digest();
  const rightHash = crypto
    .createHash('sha256')
    .update(String(right || ''), 'utf8')
    .digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
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

  if (!process.env.ADMIN_CONSOLE_TOKEN) {
    return json(res, 500, {
      ok: false,
      error: 'ADMIN_CONSOLE_TOKEN is not configured.',
    });
  }

  const provided = getHeader(req, 'x-admin-token');

  if (!safeEqual(provided, process.env.ADMIN_CONSOLE_TOKEN)) {
    return json(res, 401, {
      ok: false,
      error: '管理员访问码不正确。',
    });
  }

  return json(res, 200, {
    ok: true,
    verifiedAt: new Date().toISOString(),
    scope: 'editorial-console',
  });
}
