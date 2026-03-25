# Day Manager

予定・タスク・体調メモを1か所にまとめ、**現在時刻ベースの実行案**と ChatGPT に貼るための「1日設計」テキストを生成する無料の Web アプリです。

## 現在の構成

このリポジトリは、**Cloudflare Workers を使う Google Calendar 連携版**に寄っています。

- フロント本体: 静的ファイル
- Google 認証 / Google Calendar API / 定期同期: `cloudflare-worker/`
- 保存の中心: ブラウザ `localStorage`
- Google 側の定期取得キャッシュ: Cloudflare KV

そのため、**`index.html` をローカルで直接開くだけでは Google 連携は動きません。**
Google 連携を使う場合は、Cloudflare Workers 側の設定とデプロイが必要です。

## できること

- 固定予定（毎週くり返す授業・通学など）の登録
- 単発予定（その日だけの予定・外出・締切など）の登録
- タスクの登録、優先度・重要度・見積時間・状態管理
- 睡眠時間・体力・メモの保存
- 対象日の予定、48時間以内の締切、未完了タスク、残り空き時間の整理
- 現在時刻・進行中予定・危険アラート・今日切る候補の表示
- 朝 / 再設計 / 夜モード
- 空き時間にタスクを仮配置する「自動時間割候補」
- ワンタップ報告
  - 体力 -1 / +1
  - 想定外30分
  - 今から再設計
  - 今日はここまで
- ChatGPT に貼る文章の自動生成とコピー
- `localStorage` 保存
- JSON バックアップの書き出し / 読み込み
- PWA 対応
- Google Calendar 連携（β）
  - Google アカウントで接続
  - 指定日の Google 予定の読込
  - 単発予定の Google 追加・更新・削除
  - Worker による定期同期

## 重要な注意

### 1. 「放置しても毎日自動同期」の意味
この構成で自動同期されるのは、**Worker が Google Calendar から定期的に予定を取り直す部分**です。

一方で、**ブラウザの `localStorage` にしか存在しない新規ローカル予定**は、
アプリを閉じている間に勝手に Google へ送られません。

そこまでやるには、予定データ自体を `localStorage` から Worker / DB 側へ寄せる必要があります。

### 2. Google 連携に必要なもの
ブラウザ入力欄はありません。
代わりに、Cloudflare Worker 側で次を設定します。

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `COOKIE_SIGNING_SECRET`

## ローカル確認

Google 連携なしなら、静的ファイルとして確認できます。

Google 連携込みで確認する場合は、Cloudflare Worker 側を起動してください。

## Cloudflare Workers セットアップ

1. Cloudflare KV namespace を作る
2. `cloudflare-worker/wrangler.toml` の `id` / `preview_id` を埋める
3. `cloudflare-worker/.dev.vars.example` を `.dev.vars` にコピー
4. `.dev.vars` に secret を入れる
5. Google Cloud 側で OAuth Web Client を作る
6. Redirect URI に  
   `https://YOUR_WORKER_DOMAIN/auth/google/callback`  
   を追加する
7. `cloudflare-worker` ディレクトリで:
   - `npm install`
   - `npm run dev` または `npm run deploy`

## 保存先

- 予定・タスク・体調メモ・モード設定はブラウザの `localStorage`
- Google 連携ユーザー情報・トークン・取得済み Google 予定キャッシュは Cloudflare KV

## 補足

- Google Calendar 連携は最初は **単発予定のみ** を同期対象にしています
- 固定予定とタスクは Google Calendar へ自動同期しません
- Google 側で直接作成した予定は、接続後に対象日ごとに読み込みます
