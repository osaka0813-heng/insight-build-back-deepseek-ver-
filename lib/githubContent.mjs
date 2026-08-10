const GITHUB_API = 'https://api.github.com';

function normalizeEnvironmentValue(name, value) {
  if (typeof value !== 'string') return '';

  let normalized = value.trim();

  // Vercel values are sometimes pasted with wrappers or labels.
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

function required(name) {
  const value = normalizeEnvironmentValue(name, process.env[name]);
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function repoConfig() {
  return {
    token: required('GITHUB_TOKEN'),
    owner: required('GITHUB_OWNER'),
    repo: required('GITHUB_REPO'),
    branch: process.env.GITHUB_BRANCH || 'main',
    path: process.env.REMOTE_CONTENT_PATH || 'remote-content.json',
  };
}

function headers(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'insight-publisher',
  };
}

function decodeBase64(value) {
  return Buffer.from(String(value).replace(/\n/g, ''), 'base64').toString('utf8');
}

export async function readRemoteContent() {
  const config = repoConfig();
  const url = `${GITHUB_API}/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(config.path)}?ref=${encodeURIComponent(config.branch)}`;
  const response = await fetch(url, { headers: headers(config.token) });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const requestId =
      response.headers.get('x-github-request-id') || 'unknown';
    throw new Error(
      `${payload?.message || `GitHub read failed (${response.status}).`} ` +
        `[status=${response.status}; repo=${config.owner}/${config.repo}; ` +
        `path=${config.path}; requestId=${requestId}]`,
    );
  }
  if (!payload?.content || !payload?.sha) {
    throw new Error('GitHub response did not contain content and sha.');
  }

  return {
    config,
    sha: payload.sha,
    content: JSON.parse(decodeBase64(payload.content)),
  };
}

export async function writeRemoteContent({ config, sha, content, message }) {
  const url = `${GITHUB_API}/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(config.path)}`;
  const encoded = Buffer.from(`${JSON.stringify(content, null, 2)}\n`, 'utf8').toString('base64');
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      ...headers(config.token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      content: encoded,
      sha,
      branch: config.branch,
    }),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const requestId =
      response.headers.get('x-github-request-id') || 'unknown';
    throw new Error(
      `${payload?.message || `GitHub write failed (${response.status}).`} ` +
        `[status=${response.status}; repo=${config.owner}/${config.repo}; ` +
        `path=${config.path}; requestId=${requestId}]`,
    );
  }

  return {
    commitSha: payload?.commit?.sha,
    contentSha: payload?.content?.sha,
    htmlUrl: payload?.commit?.html_url,
  };
}
