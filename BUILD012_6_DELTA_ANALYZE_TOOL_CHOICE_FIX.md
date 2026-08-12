# Build012.6 Delta — Analyze / Write Tool Choice Fix

Observed error:
`Thinking mode does not support this tool_choice`

Root cause:
- Analyze and Write used thinking mode together with a forced function
  `tool_choice`.
- The deployed DeepSeek endpoint rejected that combination.

Fix:
- Structured tool calls now run in non-thinking mode.
- The required function call remains forced for deterministic JSON.
- `strict: true` was removed because DeepSeek strict mode requires the beta
  endpoint and supports a narrower JSON Schema subset.
- If function calling fails, the client falls back to Chat Completions JSON
  mode and validates/parses the result.
- This generic client fix applies to both Analyze and Write.
