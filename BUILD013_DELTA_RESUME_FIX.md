# Build013 Delta — Resume Fix

Fixes:
- `/api/auto-resume` can now re-awaken any unfinished job, not only a terminal error job.
- If a worker chain stalls while status is `running`, `queued`, `retrying`, or `checkpointed`,
  the user can explicitly re-trigger the saved current scope/stage.
- Failed stage retry counters are reset only for the stage being resumed.
- Existing successful checkpoints are kept.
