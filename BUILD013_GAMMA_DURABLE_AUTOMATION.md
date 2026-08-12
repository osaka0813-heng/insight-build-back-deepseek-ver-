# Build013 Gamma — Durable Automation

Main correction: the four-scope auto pipeline no longer lives in the Expo screen.

The client only starts a job and polls status. The Vercel backend continues the work.

Durability:
- Each server invocation executes exactly one stage.
- State is checkpointed to GitHub under `automation-jobs/`.
- The next worker is chained with `@vercel/functions` `waitUntil`.
- Closing Expo, leaving the editor, or locking the phone does not cancel the server job.
- Each failed stage retries up to 3 times.
- After 3 failures, the exact failed stage is retained and the next region continues.
- "Resume failed checkpoint" resumes that stage without repeating prior successful stages.

Checkpoint stages:
Research -> Analyze -> Write EN -> Write ZH -> Write JA -> Finalize -> Publish

No new Vercel environment variable is required.
Existing RESEARCH_API_TOKEN, PUBLISH_API_TOKEN and GitHub settings are reused.
