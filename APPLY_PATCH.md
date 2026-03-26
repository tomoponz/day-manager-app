# Day Manager 大学生向けMVPパッチ

今使うべき作業フォルダはこれです。  
`day-manager-app-git`

## 追加 / 上書きするファイル
- 上書き
  - `index.html`
  - `app.js`
  - `js/state.js`
  - `js/actions.js`
  - `js/prompt.js`
- 新規追加
  - `js/study-manager.js`

## 機能
- 科目管理
- 教材管理
- 教材ごとの進度記録
- 理解度 / 復習必要 / 次にやる場所の記録
- AI用プロンプトへの科目・教材進度の自動差し込み

## 適用後
Cloudflare Worker 側のコードは今回は触っていません。  
フロント変更だけなので、通常はそのまま再 deploy で反映できます。

```bash
cd cloudflare-worker
npm install
npm run deploy
```
