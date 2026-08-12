# Build012.6 Kappa — Single GitHub Credential Path

The publish flow no longer re-reads GitHub credentials through a second client.

- `readRemoteContent()` authenticates once and returns the verified repository config.
- The exact same token/config is reused for the pre-publish backup.
- The same config is reused for the main `remote-content.json` write.
- Publish errors now identify the exact stage:
  - `backup`
  - `main-write`
- Error output includes HTTP status, repository, path and GitHub request ID,
  but never exposes the token.

Frontend changes are not required.
