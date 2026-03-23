# Day Manager

予定・タスク・体調メモを1か所にまとめ、今日の実行案と ChatGPT に貼るための「1日設計」テキストを生成する無料の Web アプリです。

## できること

- 固定予定（毎週くり返す授業・通学など）の登録
- 単発予定（その日だけの予定・外出・締切など）の登録
- タスクの登録、優先度・重要度・見積時間・状態管理
- 睡眠時間・体力・メモの保存
- 対象日の予定、48時間以内の締切、未完了タスク、空き時間の整理
- 空き時間にタスクを仮配置する「自動時間割候補」
- ChatGPT に貼る文章の自動生成とコピー
- `localStorage` 保存
- JSON バックアップの書き出し / 読み込み
- PWA 対応
- Google Calendar 連携（β）
  - 指定日の Google 予定の読込
  - 単発予定の Google 追加・更新・削除
  - 同期状態の表示

## 使い方

1. `index.html` をブラウザで開く
2. 固定予定・単発予定・タスクを入力する
3. 対象日を選ぶ
4. 睡眠時間・体力・メモを入力する
5. 自動時間割候補を確認する
6. 「今日を設計する文章を生成」を押す
7. 「コピー」を押して ChatGPT に貼る

## Google Calendar 連携の使い方

1. Google Cloud で `OAuth Client ID` と `API Key` を作成する
2. アプリ上の Google Calendar 連携欄に入力して保存する
3. `Googleで接続` を押す
4. 対象日を切り替えると、その日の Google 予定を読み込む
5. 単発予定の追加時に `Google Calendar にも追加する` を有効にすると、ローカル保存と同時に Google 側にも予定を作成する

## GitHub Pages で公開する

1. このリポジトリにファイルを配置する
2. GitHub の **Settings → Pages** を開く
3. **Build and deployment** で `Deploy from a branch` を選ぶ
4. Branch を `main` / `/ (root)` に設定して保存する

## 保存先

- 予定・タスク・体調メモはブラウザの `localStorage` に保存されます
- Google 連携用の `Client ID` と `API Key` もこのブラウザの `localStorage` にだけ保存されます
- 別端末へ移す場合は「バックアップ書き出し」で JSON を保存してから、「バックアップ読込」で復元してください

## 注意

- Google Calendar 連携は最初は **単発予定のみ** を同期対象にしています
- 固定予定とタスクは Google Calendar へ自動同期しません
- Google 側で直接作成した予定は、接続後に対象日ごとに読み込みます
- API キーは Google Cloud 側で **HTTP referrer 制限** と **Google Calendar API 制限** をかけた状態で使う前提です
