# GAS source placement

Place existing Google Apps Script files in `gas/src/`.

- `.gs` files
- `.html` files

## Vercel embed deploy

This repository now includes a Vercel embed page at the project root (`index.html`).

### 1) Deploy GAS Web App

1. In Apps Script, deploy as Web App (`/exec` URL).
2. Execute as: `Me`.
3. Access: `Anyone with the link` (or your intended audience).
4. `doGet()` already includes `ALLOWALL`, so iframe embedding is enabled.

### 2) Deploy to Vercel

1. Import this repository into Vercel.
2. Framework preset: `Vite`.
3. Deploy.

### 3) Open embedded app

- Set env var `GAS_API_URL` to your GAS Web App `/exec` URL.
- Optional: set `GAS_API_TOKEN` if you configure `API_TOKEN` in GAS Script Properties.
- Open your Vercel URL.

## Auth properties (id_token + session)

`src/WebApp.gs` now supports Google `id_token` verification on `doPost` and iframe session token on `doGet`.

Set these Script Properties in Apps Script:

- `GOOGLE_OAUTH_CLIENT_ID`: Web OAuth client ID (`xxxxx.apps.googleusercontent.com`)
- `ALLOWED_EMAILS`: comma-separated allow list
  - example: `ayukiofumiria@gmail.com,admin@example.com`
