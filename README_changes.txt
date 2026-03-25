この zip は「Googleの Client ID / API Key をユーザー入力させず、見た目上は Google で接続するだけ」にするための差し替え用ファイルです。

入っているファイル:
- index.html
- js/actions.js
- js/google-calendar.js
- js/google-config.js
- sw.js

使い方:
1. 既存リポジトリの同名ファイルをこの zip のファイルで置き換える
2. js/google-config.js を開く
3. YOUR_GOOGLE_OAUTH_CLIENT_ID と YOUR_GOOGLE_API_KEY を実値に置き換える
4. アプリをブラウザ経由で開く
5. 「Googleで接続」を押して認可する

重要:
- これは「入力欄をなくす」だけで、資格情報そのものが不要になるわけではありません
- どのカレンダーに接続されるかは、ログインした Google アカウントで決まります
- あなたのアクセストークンを埋め込むわけではありません
