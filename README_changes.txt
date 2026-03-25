この zip は、Cloudflare Workers 構成に移すための差し替え用ファイルです。

構成:
- 既存の静的フロントはそのまま使う
- Google OAuth / Google Calendar API / 自動同期を Cloudflare Worker に持たせる
- Worker が静的アセットも同じ origin で配信する

入っているファイル:
- app.js
- js/google-calendar.js
- cloudflare-worker/wrangler.toml
- cloudflare-worker/package.json
- cloudflare-worker/.dev.vars.example
- cloudflare-worker/.assetsignore
- cloudflare-worker/src/index.js

やること:
1. 同名ファイルを置き換える
2. Cloudflare で KV を作る
3. wrangler.toml の KV id を埋める
4. .dev.vars.example を .dev.vars にコピーして secret を埋める
5. Google Cloud の OAuth redirect URI に
   https://YOUR_WORKER_DOMAIN/auth/google/callback
   を入れる
6. cloudflare-worker ディレクトリで
   npm install
   npm run deploy

注意:
- この版は Cloudflare Worker が 15 分ごとに全ユーザーを同期します
- 無料枠の KV は 1日 100,000 read / 1,000 write です。個人利用なら現実的ですが、多人数運用には向きません
- 本当に「ローカルだけにある新規予定を、アプリ未起動でも Google に勝手に反映」までやるなら、予定データ自体をローカル保存から Worker/KV 保存へ寄せる必要があります
