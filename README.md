# Day Manager

予定・タスク・体調メモを 1 か所にまとめ、**現在時刻ベースの実行案**と ChatGPT に貼るための「1日設計」テキストを生成する無料の Web アプリです。

## 現在の構成

このリポジトリは、**Cloudflare Workers を使う Google Calendar 連携版**です。

- フロント本体: `public/` の静的ファイル
- Google 認証 / Google Calendar API / 定期同期: `cloudflare-worker/`
- 保存の中心: ブラウザ `localStorage`
- Google 側の定期取得キャッシュ: Cloudflare KV

そのため、**`index.html` をローカルで直接開くだけでは Google 連携は動きません。**  
Google 連携を使う場合は、Cloudflare Workers 側の設定とデプロイが必要です。

### 第4弾の配信構造整理

現在の推奨構成では、**Worker が配信する静的 assets は `public/` のみ**です。

- 以前の repo ルート直下の `index.html` / `style.css` / `app.js` / `js/` は、移行確認が終わるまでは残してもかまいません
- ただし `wrangler.toml` は `public/` を向くように変更してください
- 新しい静的ファイルは原則として `public/` 配下だけを更新してください

---

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
  - 対象日の Google 予定の読込
  - 単発予定の Google 追加・更新・削除
  - Worker による定期同期

---

## 実運用上の完成度

### すでに実用に入っている部分

- Worker URL を開ける
- Google ログインが通る
- 接続状態を画面で確認できる
- 対象日の Google 予定を読む
- 単発予定を Google Calendar に追加・更新・削除する
- Worker の cron で Google 側の予定キャッシュを定期更新する

### まだ未完成の部分

- ブラウザの `localStorage` にしか存在しない新規ローカル予定を、**アプリ未起動のまま自動で Google に送る機能**
- 固定予定の Google 連携
- タスクの Google 連携
- Google 側の予定変更をローカル単発予定へ自動マージする機能
- 複数カレンダー選択
- 競合解決ルールの明文化

### 重要な注意

この構成で自動同期されるのは、**Worker が Google Calendar から定期的に予定を取り直す部分**です。  
一方で、**ブラウザの `localStorage` にしか存在しない新規ローカル予定**は、アプリを閉じている間に勝手に Google へ送られません。

そこまでやるには、予定データ自体を `localStorage` から Worker / DB 側へ寄せる必要があります。

---

## Google 連携に必要なもの

ブラウザ入力欄はありません。  
代わりに、Cloudflare Worker 側で次を設定します。

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `COOKIE_SIGNING_SECRET`

---

## どのフォルダを使うか

初心者向けに先に明示します。

### 普段見る本体フォルダ
`day-manager-app-main/public`

この中に少なくとも次がそろっているものを使ってください。

- `index.html`
- `style.css`
- `app.js`
- `js/`
- `icons/`
- `sw.js`

### Worker の作業フォルダ
`day-manager-app-main/cloudflare-worker`

`npm install` や `wrangler deploy` は **必ずこのフォルダで実行** します。

---

## ローカル確認

### Google 連携なしで画面確認したい場合
`public/` を静的に開く

### Google 連携込みで確認したい場合
Worker を起動または deploy した URL で確認する

---

## Cloudflare Workers セットアップ

1. **使う本体フォルダを確認する**  
   `day-manager-app-main`

2. **Worker 用フォルダへ入る**  
   `day-manager-app-main/cloudflare-worker`

3. **Cloudflare KV namespace を作る**

4. **`cloudflare-worker/wrangler.toml` の `id` / `preview_id` を埋める**

5. **Worker secrets を設定する**

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put COOKIE_SIGNING_SECRET
```

6. **Google Cloud 側で OAuth Web Client を設定する**

- Authorized JavaScript origins  
  `https://YOUR_WORKER_DOMAIN`
- Authorized redirect URIs  
  `https://YOUR_WORKER_DOMAIN/auth/google/callback`

7. **Worker を deploy する**

```bash
npm install
npm run deploy
```

---

## 保存先

- 予定・タスク・体調メモ・モード設定はブラウザの `localStorage`
- Google 連携ユーザー情報・トークン・取得済み Google 予定キャッシュは Cloudflare KV

---

## 補足

- Google Calendar 連携は最初は **単発予定のみ** を同期対象にしています
- 固定予定とタスクは Google Calendar へ自動同期しません
- Google 側で直接作成した予定は、接続後に対象日ごとに読み込みます


## 本格カレンダーUI（追加）

- FullCalendar ベースで、月 / 週 / 日 / 一覧表示を追加
- ローカル単発予定・固定予定・Google予定を同じカレンダー上で表示
- ローカル単発予定はドラッグ移動 / リサイズに対応
- 週 / 月表示に必要な Google 予定は `GET /api/google/events-range` で範囲取得
