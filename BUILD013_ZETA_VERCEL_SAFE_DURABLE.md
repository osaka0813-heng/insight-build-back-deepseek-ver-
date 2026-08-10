# Build013 Zeta — Vercel Safe Durable Backend

## Goal

Restore reliable Vercel deployment first, while keeping durable checkpoints.

## What changed

### Removed
- `@vercel/functions`
- `waitUntil()`
- recursive `/api/auto-worker` self-calls
- `/api/auto-worker`

### Runtime
- Node.js pinned to `20.x`
- no `>=20` auto-upgrade to Node 24

### Durable execution model

Zeta uses **checkpoint-heartbeat-v1**.

Every request performs at most one pipeline stage:

Research
→ Analyze
→ Write EN
→ Write ZH
→ Write JA
→ Finalize
→ Publish

After every successful stage, the job is persisted to GitHub under
`automation-jobs/`.

`/api/auto-status` is both a status endpoint and a safe heartbeat:
while an unfinished job exists, each poll advances exactly one saved stage.

If Expo closes or the phone sleeps:
- progress already completed is NOT lost
- the job remains persisted
- when Expo reconnects and polls `/api/auto-status`, execution resumes from the
  exact saved scope/stage

This is intentionally more conservative than the Gamma recursive background
chain. It prioritizes deployment stability and resumability.

## Existing frontend compatibility

The Delta / Epsilon Expo frontend already polls `/api/auto-status` every
5 seconds, so no frontend change is required for the heartbeat driver.

## Vercel environment variables

No new environment variables are required.

Existing variables are reused:
- RESEARCH_API_TOKEN
- PUBLISH_API_TOKEN
- GITHUB_TOKEN
- GITHUB_OWNER
- GITHUB_REPO
- GITHUB_BRANCH
- GITHUB_BACKUP_DIR
- DEEPSEEK_API_KEY
- DEEPSEEK_BASE_URL
- DEEPSEEK_RESEARCH_MODEL
- DEEPSEEK_ANALYZE_MODEL
- DEEPSEEK_WRITE_MODEL

## Important tradeoff

Zeta does NOT claim to keep computing while the phone is completely offline.
It guarantees that completed work survives and resumes automatically when the
client heartbeat returns.

For true offline/background execution, the next production step should use
Vercel Workflows or Queues rather than recursive Function self-calls.
