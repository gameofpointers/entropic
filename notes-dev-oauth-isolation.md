# Dev OAuth Isolation (entropic-dev)

## Summary
We isolated the development OAuth flow so it doesn't conflict with production builds or an installed Entropic app.

## What changed
- Added `src-tauri/tauri.conf.dev.json` with:
  - `identifier: ai.openclaw.entropic.dev`
  - deep link scheme: `entropic-dev://`
  - product name: `Entropic (Dev)`
- `pnpm tauri:dev` now runs with the dev config:
  - `TAURI_CONFIG=tauri.conf.dev.json tauri dev --config src-tauri/tauri.conf.dev.json`
- Auth redirect URL and auth store name are env-driven:
  - `VITE_AUTH_REDIRECT_URL` (defaults to `entropic://auth/callback`)
  - `VITE_AUTH_STORE_NAME` (defaults to `entropic-auth.json`)
- Added `.env.development`:
  - `VITE_AUTH_REDIRECT_URL="entropic-dev://auth/callback"`
  - `VITE_AUTH_STORE_NAME="entropic-auth-dev.json"`
- Updated `scripts/register-dev-protocol.sh` to register `entropic-dev://`
- Updated single-instance URL filter to accept both `entropic://` and `entropic-dev://`

## Required setup
- Supabase Auth → Additional Redirect URLs:
  - `entropic://auth/callback` (prod)
  - `entropic-dev://auth/callback` (dev)

## Linux dev deep link registration
```bash
pnpm dev:protocol
```

## Smoke test deep link
```bash
xdg-open "entropic-dev://auth/callback#access_token=TEST&refresh_token=TEST"
```

## Files touched
- `src-tauri/tauri.conf.dev.json` (new)
- `src/lib/auth.ts`
- `.env.development` (new)
- `.env.example`
- `package.json`
- `scripts/register-dev-protocol.sh`
- `src-tauri/src/lib.rs`
