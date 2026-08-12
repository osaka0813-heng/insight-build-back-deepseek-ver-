# Build011.4 — AI Writer

Build011.4 converts an analyzed Build011.3 candidate into a complete six-page, three-language Insight draft.

## API

`POST /api/write`

Required header: `x-research-token`.

Body:

```json
{
  "researchDraft": { "...": "analyzed Build011.3 draft" },
  "candidateId": "candidate-id"
}
```

The endpoint refuses candidates that do not meet the publication threshold unless `force: true` is supplied. The result always remains `status: draft`.

## Safety

- The writer receives the researched candidate and existing process, not open web access.
- URLs are preserved from the Researcher sources and cannot be invented by the Writer.
- Narrative copy must not contain Markdown links or raw URLs.
- Publishing remains manual.

## Publish workflow

1. Review the writer draft.
2. Change its status from `draft` to `approved`.
3. Run:

```bash
node scripts/merge-writer-draft.mjs writer-draft.json remote-content.json
```
