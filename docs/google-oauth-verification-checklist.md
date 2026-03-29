# Google OAuth 認証化チェックリスト

## 1. 公開ページ
- `https://<your-domain>/privacy.html`
- `https://<your-domain>/terms.html`

## 2. Google Cloud Console
- OAuth 同意画面のアプリ名を設定
- サポートメールを設定
- 開発者連絡先メールを設定
- ホームページ URL を設定
- プライバシーポリシー URL を設定
- 利用規約 URL を設定
- 承認済みドメインを設定

## 3. OAuth クライアント
- Authorized redirect URI に以下を登録
  - `https://<your-domain>/auth/google/callback`
- Cloudflare Worker の本番 URL と完全一致していることを確認

## 4. テスト段階
- OAuth 同意画面で自分の Google アカウントを Test users に追加
- 動作確認後に verification を申請

## 5. スコープ説明
- Google Calendar の予定を読み込み・追加・更新・削除するために `calendar.events` を使うと説明する
- デモ動画を用意する

## 6. デプロイ
- `public/` と `cloudflare-worker/src/index.js` を更新
- `cloudflare-worker` で `npm run deploy`
