# Build013 Automation Lease Hotfix

Apply these files ON TOP OF the latest Build013 backend (including Research Reset).

Files:
- lib/automationJobStore.mjs
- api/auto-status.mjs
- api/auto-resume.mjs

Root cause fixed:
The Expo frontend polls auto-status every 5 seconds. Research/Analyze/Write/Publish
can take much longer than 5 seconds, so multiple auto-status requests were executing
the same stage concurrently. They then wrote the same automation-jobs/<job>.json
using different GitHub SHAs, producing:

Automation state write failed ... does not match <sha>

Fix:
- GitHub job-state writes retry optimistic 409 conflicts.
- A per-job lease allows only one request to advance a stage at a time.
- Overlapping status polls become read-only and return busy=true.
- Resume also respects the same lease.
- Lease expires automatically after 150 seconds if a function crashes.
- No Research/Analyze/Write/Signal-First logic is changed.
- No frontend update is required.

This is intentionally an overlay so it does not overwrite the latest Codex
Research Reset changes.
