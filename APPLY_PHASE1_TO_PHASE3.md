この bundle は Phase1〜Phase3 をまとめて一回で上書きするための一式です。

含まれる変更:
- Phase1: 初回セットアップ / ルール設定 UI
- Phase2: 昼休み / 休憩 / 集中時間のロジック反映
- Phase3: カレンダーへの淡色候補ブロック表示

上書き対象:
- public/index.html
- public/style.css
- public/sw.js
- public/app.js
- public/js/state.js
- public/js/onboarding.js
- public/js/planner.js
- public/js/render.js
- public/js/scheduling-rules.js
- public/js/calendar-ui.js

適用後:
1. ファイル上書き
2. Cloudflare Worker で npm run deploy
3. ブラウザでハードリロード
