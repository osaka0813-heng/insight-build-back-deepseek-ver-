# Build012.6 Theta — Publish Credential Fix

Root cause:
- `lib/githubContent.mjs` normalized `GITHUB_TOKEN`.
- `lib/contentSafety.mjs` used the raw Vercel environment value.
- Preflight/read operations could succeed through the normalized client.
- Publish then failed while creating the pre-publish backup through the raw-token client.

Fix:
- GitHub token normalization is now identical in both clients.
- Quotes, whitespace, `Bearer ` and accidental `GITHUB_TOKEN=` prefixes are removed.
- GitHub backup/rollback errors now include status and request ID without exposing the token.

No frontend update is required.
