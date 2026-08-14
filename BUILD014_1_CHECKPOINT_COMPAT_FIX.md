# Build014.1 — Checkpoint Compatibility Fix

Root cause:
Build014 reused the old Build013 AsyncStorage pipeline key:
`@insight/editorial/pipeline/v1`.

That allowed old Build013 multi-scope / three-language Writer checkpoints to be
restored inside Build014's two-language Writer. A legacy Chinese checkpoint can
exist but not contain the Build014 `localizedDraft.page` shape, which caused:

`Cannot read properties of undefined (reading 'page')`

Fixes:
- Build014 now uses a dedicated storage namespace:
  `@insight/build014/editorial/pipeline/v1`
- Old Build013 checkpoints are no longer automatically restored.
- Writer checkpoint shapes are validated before reuse.
- Invalid EN/ZH checkpoints are discarded stage-by-stage and regenerated.
- Backend Finalize now reports clear 400/502 errors instead of throwing
  `undefined.page`.

Recommended after installing:
Use "清除断点并开启新周期" once, then generate a fresh Build014 Insight.
