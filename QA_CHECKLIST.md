# QA CHECKLIST

## 差し替え後の確認順
1. `public/` の更新ファイルを上書き
2. ブラウザで `Ctrl + Shift + R`
3. それでも古い場合は DevTools → Application → Service Workers / Cache Storage を削除
4. Worker 配信中なら `cloudflare-worker` で `npm run deploy`

## 今回の確認項目
### A. カレンダー
- 予定クリックで **詳細だけ** 開く
- その時点で編集フォームが勝手に開かない
- 詳細内の「編集パネルで開く」からだけ編集に入る

### B. 右ドロワー
- 管理・設定の「追加と編集」から固定予定 / 単発予定 / タスクを開ける
- 一覧の編集ボタンから同じ右ドロワーが開く
- `Esc` と「閉じる」で閉じる
- 閉じたあと背景スクロールが戻る

### C. 補助ショートカット
- 左の「学習 / 管理 / 連携」で該当パネルまで移動する
- 開いたパネルが一瞬強調表示される
- Utility ボタンの active 状態が切り替わる

### D. バックアップ
- `バックアップ書き出し` が動く
- `直前状態を復元` の文言が出る
- 削除前に自動退避が更新される

## 運用ルール
- `public/sw.js` の `CACHE_NAME` は、静的アセットを変えたら上げる
- GitHub push と Workers 公開反映は別作業
- `public/` を直しただけでは Cloudflare Workers には出ない
