# Build012.6 Gamma — DeepSeek Research JSON Reliability

Root cause:
- Research combined server-side web search and strict structured output in one call.
- When DeepSeek rejected the structured format, the compatibility fallback removed
  the JSON constraint.
- The model then returned normal prose, which the backend correctly could not parse.

Fix:
- Phase 1: DeepSeek web search produces an evidence dossier.
- Phase 2: a separate call converts the dossier into strict JSON.
- Structured-output failure never falls back to unconstrained prose.
- If Responses JSON Schema fails, Chat Completions JSON mode is used.
- Empty, truncated, or malformed JSON retries safely.
- Research validates multilingual content and at least two sources before returning.
