# Proposed updates for Day Manager

このブランチでは、コネクタ制約により既存ファイルの直接上書きは完了できませんでした。
その代わり、以下の改善をそのまま適用できる**置換用ファイル案**をまとめます。

## 含めた改善

- `alert` / `confirm` の UI 統一（`showToast` / `confirmDialog`）
- 起動失敗時のエラーバナー表示
- クイック追加の表現拡張（`今夜`, `今日中`, `1h`, `30m`, `午前`, `午後`）
- タスク / 予定一覧のバッジ化
- Google 設定入力の扱い改善
- Service Worker のプリキャッシュ強化
- product UI のスタイル強化

## 置換候補ファイル

- `app.js`
- `js/actions.js`
- `js/render.js`
- `js/quick-add.js`
- `js/google-calendar.js`
- `js/product-ui-tune.js`
- `sw.js`

## 適用方針

1. このブランチの `proposed-updates` を参照する
2. 各ファイルを対応する既存ファイルへ置換する
3. ローカルで動作確認後に main へマージする

## 補足

`index.html` の大規模静的化まで一気に入れると差分が大きくなりすぎるため、今回は既存構造を温存したまま改善効果の大きい部分を優先しています。
