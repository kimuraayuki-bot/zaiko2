# Zaiko Web Embed (Next.js + Vercel)

Google ログインで取得した `id_token` を Next.js サーバー経由で GAS に `POST` し、
GAS から短期セッショントークン (`st`) を受け取って iframe 表示する構成です。

## Setup

```bash
npm install
cp .env.example .env.local
```

`.env.local`:

```env
NEXT_PUBLIC_GAS_WEBAPP_URL=https://script.google.com/macros/s/REPLACE_WITH_DEPLOYMENT_ID/exec
NEXT_PUBLIC_GOOGLE_CLIENT_ID=REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com
NEXT_PUBLIC_APP_TITLE=Zaiko Embed
```

## Google Cloud Console

OAuth クライアント ID (Web) を作成し、`Authorized JavaScript origins` に以下を追加:

- `http://localhost:3000`
- `https://<your-vercel-domain>`

## GAS side (Script Properties)

`zaiko/gas/src/WebApp.gs` の認証機能を有効にするため、Script Properties に設定:

- `GOOGLE_OAUTH_CLIENT_ID` = `NEXT_PUBLIC_GOOGLE_CLIENT_ID` と同じ値
- `ALLOWED_EMAILS` = 許可メール（カンマ区切り）
  - 例: `ayukiofumiria@gmail.com,admin@example.com`

## Run

```bash
npm run dev
```

## Deploy (Vercel)

1. `zaiko/web` を Vercel Project として Import
2. 上記3つの環境変数を設定
3. Deploy

## Security

- `id_token` は URL や localStorage に保存しない
- 認可判定は GAS 側で実施
- iframe 表示は GAS の `st` セッション必須