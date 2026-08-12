# Build011.5 Review & Publish deployment

## Environment variables

Add these variables to the Vercel back-end project and redeploy:

```text
PUBLISH_API_TOKEN=<a new long random token>
GITHUB_TOKEN=<fine-grained GitHub token>
GITHUB_OWNER=osaka0813-heng
GITHUB_REPO=insight-build-front
GITHUB_BRANCH=main
REMOTE_CONTENT_PATH=remote-content.json
```

## GitHub token permissions

Create a fine-grained personal access token limited to `insight-build-front`.
Grant repository permission:

```text
Contents: Read and write
```

Do not place the GitHub token or publish token in the Expo repository.

## Test OPTIONS

```bat
curl.exe -i -X OPTIONS "https://insight-build-back.vercel.app/api/publish" -H "Origin: https://snack.expo.dev" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type,x-publish-token"
```

Expected: `204 No Content`.

## Test rejection without changing published Insight

Use a real Writer Draft JSON:

```bat
curl.exe -X POST "https://insight-build-back.vercel.app/api/publish" -H "Content-Type: application/json" -H "x-publish-token: YOUR_TOKEN" --data-binary "@publish-request.json"
```
