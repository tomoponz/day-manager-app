この修正版で直した点:

- `server/package.json` の起動スクリプト修正
  - もとの手順 `cd server && npm run start` では `server/server.js` を探しに行って起動失敗していました
  - 修正版は `node server.js` です

- OAuth `state` 検証を追加
  - Googleログイン開始時に state を発行し、callback で検証します

- `returnTo` を相対パスに制限
  - 任意URLへのリダイレクトを防ぎます

- `COOKIE_SECURE` を環境変数化
  - ローカルは false、本番 HTTPS は true にできます

- `server/.gitignore` を追加
  - `.env` / `node_modules` / `data/store.json` を誤コミットしにくくします

残る制約:
- これは「Google Calendar をサーバー側で定期再取得する」実装です
- ブラウザ localStorage 内の新規ローカル予定を、アプリを閉じている間に勝手に Google へ反映するところまでは未対応です
- そこまでやるには、ローカル予定自体をサーバー保存に移す必要があります
