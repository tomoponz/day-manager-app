この zip は、前回の内部固定版で起きた起動エラーを直した修正版です。

原因:
- index.html から固定予定/単発予定/タスクのフォーム群を落としてしまい、
  actions.js が存在しない要素へ addEventListener して落ちていました。

この修正版で直したこと:
- 元のフォーム群は残す
- Google資格情報の入力欄だけを消す
- 見た目上は「Googleで接続」だけにする
- js/google-config.js に Client ID / API Key を固定する方式を維持

やること:
1. 同名ファイルを置き換える
2. js/google-config.js に実際の Client ID / API Key を入れる
3. ブラウザで再起動する
