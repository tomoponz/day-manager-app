# Cloudflare Worker setup

## このフォルダでやること

作業フォルダは次です。

`day-manager-app-main/cloudflare-worker`

`npm install`、`wrangler dev`、`wrangler deploy` は **必ずこのフォルダで実行** します。

---

## 必要な secret

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `COOKIE_SIGNING_SECRET`

設定コマンド:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put COOKIE_SIGNING_SECRET
```

---

## ローカル開発

1. 使うフォルダが `day-manager-app-main/cloudflare-worker` であることを確認
2. `npm install`
3. `npm run dev`

---

## デプロイ前に必要なこと

1. Cloudflare KV namespace を作る
2. `wrangler.toml` の `id` / `preview_id` を埋める
3. Google Cloud の OAuth Web Client を作る
4. Google Cloud 側で次を登録する

### Authorized JavaScript origins
`https://YOUR_WORKER_DOMAIN`

### Authorized redirect URIs
`https://YOUR_WORKER_DOMAIN/auth/google/callback`

---

## この Worker が担当していること

- Google OAuth 開始
- OAuth callback の処理
- 接続状態の返却
- Google Calendar の予定取得
- 単発予定の Google 追加 / 更新 / 削除
- cron による Google 予定キャッシュの定期更新
- `../public` の静的フロント配信

---

## まだやっていないこと

- `localStorage` にしかないローカル予定を、未起動時に自動で Google へ送ること
- 固定予定の Google 同期
- タスクの Google 同期

---

## 注意

この Worker は Google Calendar を定期取得しますが、  
ブラウザ `localStorage` にしか存在しないローカル予定まで  
未起動時に自動反映する構成ではありません。


---

## assets の向き先

`wrangler.toml` の `assets.directory` は `../public` を向けます。

そのため、Worker 経由で配信したい `index.html` / `style.css` / `app.js` / `js/` / `icons/` / `sw.js` は **`public/` 配下**に置いてください。
