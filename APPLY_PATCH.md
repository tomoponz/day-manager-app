# 科目危険度 + 締切マップ パッチ

今使うべき作業フォルダはこれです。  
`day-manager-app-git`

## 上書きするファイル
- `index.html`
- `sw.js`
- `js/state.js`
- `js/actions.js`
- `js/prompt.js`
- `js/study-manager.js`

## 追加される機能
- 科目危険度ランキング
- 科目ごとの締切マップ（試験 / レポート / 発表 / 小テスト / 宿題）
- 締切の状態管理（未着手 / 進行中 / 完了）
- AI 生成文への「科目危険度ランキング」「学業の締切マップ」追加

## 適用後
```bash
cd cloudflare-worker
npm install
npm run deploy
```
