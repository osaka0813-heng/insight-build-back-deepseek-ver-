# Build011.3 AI Analyst Backend

Environment variables:
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (recommended: `gpt-5`)
- `RESEARCH_API_TOKEN`

Endpoints:
- `GET /api/health`
- `POST /api/research` — web research plus deterministic analyst normalization
- `POST /api/analyze` — analyze an existing draft without an OpenAI call

Send `x-research-token` with protected requests.
