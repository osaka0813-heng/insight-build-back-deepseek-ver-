# Build012.6 Beta — GitHub Credential Normalization

This hotfix addresses a case where a GitHub token works in PowerShell but
Vercel receives `Bad credentials`.

Changes:
- trims whitespace/newlines from all GitHub environment variables
- removes accidental quotes
- removes accidental `Bearer ` or `GITHUB_TOKEN=` prefixes
- adds safe endpoint `/api/github-diagnostic`
- never returns the complete GitHub token
- returns a short SHA-256 fingerprint, token length, repository target,
  deployment URL and GitHub response status

Diagnostic request:

```powershell
$admin = Read-Host "ADMIN_CONSOLE_TOKEN"
Invoke-RestMethod `
  -Uri "https://YOUR-BACKEND.vercel.app/api/github-diagnostic" `
  -Headers @{ "x-admin-token" = $admin }
```
