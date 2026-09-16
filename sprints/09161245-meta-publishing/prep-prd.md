# Meta self-publishing bridge — Prep PRD

## Goal

Add a fail-closed Cloudflare Pages Functions bridge for the existing Zenithjoy
Facebook Page and Instagram Business Account. The bridge must validate assets
without leaking tokens, preview every request by default, and only publish when
all server-side and request-side gates are satisfied.

## Scope

- `GET /api/meta/status`: authenticated, read-only Graph API asset check.
- `POST /api/meta/publish`: Facebook Page text/photo and Instagram single-image
  publishing.
- Long-lived Page Access Token supplied as a Cloudflare secret.
- Durable idempotency through a Cloudflare KV binding named `META_IDEMPOTENCY`.
- No browser OAuth flow in this slice. App ID/Secret remain optional registry
  metadata for later token lifecycle automation.

## Required environment

- `META_GRAPH_API_VERSION`
- `META_PAGE_ID`
- `META_INSTAGRAM_BUSINESS_ACCOUNT_ID`
- `META_PAGE_ACCESS_TOKEN` (secret)
- `META_PUBLISH_API_KEY` (secret)
- `META_PUBLISH_ENABLED=true` for live publishing
- `META_IDEMPOTENCY` KV binding for live publishing

Optional: `META_APP_ID`, `META_APP_SECRET` for later token lifecycle work.

## Acceptance

- Missing/wrong bearer API key returns 401.
- Missing configuration is reported without exposing secret values.
- Status verifies the Page and linked Instagram account through Graph API.
- Publish defaults to preview and performs zero Graph API writes.
- Live publish requires the environment switch, `confirm: "PUBLISH"`, and an
  idempotency key.
- Tokens are sent only in the Authorization header, never in URLs or results.
- Facebook text/photo publishing and Instagram image create/publish are tested.
- Ambiguous failures stay locked to prevent blind duplicate retries.
- TypeScript check and focused unit suite pass.
