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

async function githubJson(config, path, init = {}) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      ...headers(config.token),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const requestId = response.headers.get('x-github-request-id') || 'unknown';
    throw new Error(
      `${payload?.message || `GitHub Git Data request failed (${response.status}).`} ` +
      `[status=${response.status}; path=${path}; requestId=${requestId}]`,
    );
  }
  return payload;
}

export async function writeContentPair({
  config,
  sha,
  content,
  publicContent,
  message,
  publicPath = process.env.PUBLIC_CONTENT_PATH || 'published-content.json',
}) {
  const current = await githubJson(
    config,
    `/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(config.path)}?ref=${encodeURIComponent(config.branch)}`,
  );
  if (current.sha !== sha) {
    throw new Error(`Remote content sha does not match current branch [status=409].`);
  }

  const refPath = `/repos/${config.owner}/${config.repo}/git/ref/heads/${encodeURIComponent(config.branch)}`;
  const ref = await githubJson(config, refPath);
  const parentSha = ref.object.sha;
  const parent = await githubJson(
    config,
    `/repos/${config.owner}/${config.repo}/git/commits/${parentSha}`,
  );

  const encode = (value) => `${JSON.stringify(value, null, 2)}\n`;
  const [mainBlob, publicBlob] = await Promise.all([
    githubJson(config, `/repos/${config.owner}/${config.repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: encode(content), encoding: 'utf-8' }),
    }),
    githubJson(config, `/repos/${config.owner}/${config.repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: encode(publicContent), encoding: 'utf-8' }),
    }),
  ]);

  const tree = await githubJson(
    config,
    `/repos/${config.owner}/${config.repo}/git/trees`,
    {
      method: 'POST',
      body: JSON.stringify({
        base_tree: parent.tree.sha,
        tree: [
          { path: config.path, mode: '100644', type: 'blob', sha: mainBlob.sha },
          { path: publicPath, mode: '100644', type: 'blob', sha: publicBlob.sha },
        ],
      }),
    },
  );
  const commit = await githubJson(
    config,
    `/repos/${config.owner}/${config.repo}/git/commits`,
    {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.sha, parents: [parentSha] }),
    },
  );
  await githubJson(
    config,
    `/repos/${config.owner}/${config.repo}/git/refs/heads/${encodeURIComponent(config.branch)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    },
  );

  return {
    commitSha: commit.sha,
    contentSha: mainBlob.sha,
    publicContentSha: publicBlob.sha,
    htmlUrl: `https://github.com/${config.owner}/${config.repo}/commit/${commit.sha}`,
  };
}
