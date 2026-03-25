# Cloudflare Worker setup

## 必要な secret

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `COOKIE_SIGNING_SECRET`

## ローカル開発

1. `.dev.vars.example` を `.dev.vars` にコピー
2. 値を埋める
3. `npm install`
4. `npm run dev`

## デプロイ前に必要なこと

- Cloudflare KV namespace を作る
- `wrangler.toml` の `id` / `preview_id` を埋める
- Google Cloud の OAuth Web Client の Redirect URI に  
  `https://YOUR_WORKER_DOMAIN/auth/google/callback`  
  を追加する

## 注意

この Worker は Google Calendar を定期取得しますが、
ブラウザ localStorage にしか存在しないローカル予定まで
未起動時に自動反映する構成ではありません。
