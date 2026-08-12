# Build013 Zeta.1 — Node24 + Publish Conflict Recovery

Observed production error:

`is at <new sha> but expected <old sha> [status=409]`

This is a GitHub Contents API optimistic-concurrency conflict. It happens when
two publish requests read the same SHA and one of them writes first.

Fixes:
- Node runtime pinned to `24.x`.
- Keeps the Zeta Vercel-safe architecture: no `@vercel/functions`, no
  `waitUntil`, no recursive `auto-worker`.
- Publish now detects GitHub 409 stale-SHA conflicts.
- On conflict it re-reads the latest `remote-content.json`.
- If the same Writer Draft was already published by the competing request,
  the second request returns success/idempotent instead of an error.
- Otherwise it re-merges the Writer Draft into the newest remote content and
  retries the write, up to 3 total attempts.
- This prevents parallel WORLD / CHINA / US / JAPAN or duplicate button taps
  from losing each other's changes.

No frontend change is required for this backend fix.
