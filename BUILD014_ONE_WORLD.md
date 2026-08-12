# Build014 — One World Backend

Core principle:
- One global scan
- One selected Insight
- English + Simplified Chinese only

Pipeline:
Research (5-8 signals) → Analyze (select one) → English → Chinese → Finalize → human approve Publish

Signal First:
World Process Catalog is reference context, never a search gate.

Analyze classifications:
- existing_process_update
- new_process_candidate
- standalone_important_insight
- noise_follow_through

Removed:
- China / US / Japan scopes
- multi-scope automation
- Japanese generation / translation
- auto-worker / auto-status / auto-resume

Preserved:
- DeepSeek Research / Analyze / Write
- resumable Writer checkpoints
- production preflight
- direct approval publish
- GitHub backup / rollback
- GitHub 409 publish conflict recovery
- Node 24.x
