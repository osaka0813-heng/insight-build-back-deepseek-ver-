# Insight Build014.2 Recovery Backend

Production pipeline:

`Global Research → Analyze → English → Chinese → Finalize → Publish`

Reliability rules:

- Global scope only; no China / US / Japan fan-out.
- English and Simplified Chinese only; no Japanese writer stage.
- Vercel Cron starts or resumes the daily job independently of Expo/Snack.
- Every stage is checkpointed in the frontend GitHub repository.
- Transient DeepSeek failures retry automatically.
- Analyze failures fall back to the deterministic analyst.
- Writer failures fall back to a bilingual evidence-based template.
- A valid daily result is automatically published after backup and validation.
- Legacy four-scope jobs are rejected instead of resumed.

Daily cron windows are 21:10, 22:10, 23:10 and 00:10 UTC
(06:10–09:10 Japan time). Repeated windows are idempotent and allow a timed-out
run to continue from its last checkpoint.

Required environment variables:

- `DEEPSEEK_API_KEY`
- `RESEARCH_API_TOKEN`
- `PUBLISH_API_TOKEN`
- `GITHUB_TOKEN`
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_BRANCH` (defaults to `main`)
- `CRON_SECRET` (recommended)

Health endpoint: `GET /api/health`

Expected production version: `014.2-recovery-global`
