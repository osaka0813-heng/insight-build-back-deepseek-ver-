# AI Writer test

After deploying the backend, send an analyzed Build011.3 research draft to:

`POST https://YOUR-DOMAIN.vercel.app/api/write`

Headers:

- `Content-Type: application/json`
- `x-research-token: YOUR_RESEARCH_API_TOKEN`

Body:

```json
{
  "researchDraft": {
    "id": "research-draft-id",
    "researchDate": "2026-08-01",
    "candidates": [
      {
        "id": "candidate-id",
        "analysis": {
          "publishThresholdMet": true,
          "dailyState": "update_living",
          "matchedProcessId": "process-ai-infrastructure-race"
        }
      }
    ]
  },
  "candidateId": "candidate-id"
}
```

Use the complete analyzed draft returned by `/api/research` or `/api/analyze`; the shortened object above only illustrates the request shape.

Successful response:

```json
{
  "ok": true,
  "writerDraft": {
    "status": "draft",
    "insight": {},
    "dailyStateDraft": {},
    "processUpdate": {}
  }
}
```
