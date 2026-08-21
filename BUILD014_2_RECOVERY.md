# Build014.2 Recovery

This release repairs the stalled daily publishing path observed in August 2026.

- Replaces the legacy four-region / Japanese automation runner.
- Adds an independent Vercel Cron driver.
- Adds deterministic Analyze and Writer recovery.
- Retries transient DeepSeek failures.
- Publishes one Global EN/ZH result per Japan calendar day.
- Supersedes stale Build013 automation jobs.
- Aligns the health version with the Build014 frontend.
