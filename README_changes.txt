この zip は「放っておいても毎日自動同期」に近づけるための**サーバー付き版**です。

重要:
- GitHub Pages のような静的公開だけでは、アプリを閉じている間の毎日自動同期はできません
- この版は Node サーバーを常時起動して、そこで Google OAuth と定期同期を持ちます

入っているファイル:
- index.html
- app.js
- js/actions.js
- js/google-calendar.js
- server/package.json
- server/.env.example
- server/server.js

できること:
- Google で接続
- 接続ユーザーごとにセッション保持
- サーバー側で定期的に Google Calendar を自動取得
- アプリを開いたときに最新状態へ寄せる
- ローカル単発予定を Google へ追加 / 更新 / 削除

制約:
- 「アプリを閉じている間にローカル localStorage 内の予定が勝手に Google に反映」まではしません
- それを本当にやるには、ローカル予定自体もサーバー保存に寄せる必要があります

導入手順:
1. 同名ファイルを置き換える
2. server/.env.example を .env にコピーして値を入れる
3. Google Cloud で Web OAuth Client を作り、Authorized redirect URI に
   http://localhost:3000/auth/google/callback
   を入れる
4. 端末で:
   cd server
   npm install
   npm run start
5. http://localhost:3000 を開く
6. Googleで接続を押す
