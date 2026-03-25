この zip には、Gemini案ベースで主画面UXまで反映した差し替え用ファイルを入れています。

含まれるファイル:
- index.html
- style.css
- app.js
- sw.js
- js/main-screen-layout.js
- js/product-ui-tune.js
- js/quick-add.js
- js/render.js
- js/actions.js
- js/google-calendar.js

主な反映内容:
- 主画面を「今日の判断 / 追加 / 実行」に再編
- 要約セクション統合
- 一覧をバッジ・色ベースの視覚UIへ変更
- クイック追加の例文チップ追加
- 空状態CTA追加
- ローカル削除を Undo トースト化
- Google削除は確認ダイアログ維持
- 状態更新メニュー化
- AI / Google連携を設定内に寄せる
- 起動失敗バナー
- PWAプリキャッシュ強化

反映方法:
既存リポジトリの同名ファイルを、この zip のファイルで置き換えてください。