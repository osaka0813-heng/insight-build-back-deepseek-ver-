# Build012.6 Epsilon — Write Timeout Fix

Observed error:
`write 请求超时`

Root cause:
- Write requested a very large three-language six-page object.
- The configured Pro model had a 42,000-token output budget.
- The full Research candidate and World Process object were sent to the model.
- One slow request could consume almost the entire Vercel/frontend window.

Fix:
- compacts the Writer input
- lowers the normal output budget to 14,000 tokens
- gives the Pro model a 105-second limit
- automatically retries a Pro timeout once with the fast DeepSeek model
- gives the fast retry a separate 105-second limit
- keeps all Page 04, multilingual, placeholder and publish validations
- applies a bounded timeout to JSON fallback calls

No frontend update is required.
