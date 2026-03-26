# 適用方法

今使うべき作業フォルダ:
`day-manager-app-git`

## 上書きするファイル
- `.assetsignore`
- `sw.js`
- `js/render.js`
- `js/google-calendar.js`
- `cloudflare-worker/src/index.js`

## 手順
1. `day-manager-app-git` をバックアップする
2. このフォルダ構成のまま、同じ相対パスへ上書きコピーする
3. `day-manager-app-git/cloudflare-worker` で再 deploy する

```bash
npm install
npm run deploy
```

## このパッチで入る修正
- 不要ファイルの静的配信除外を強化
- `calendar-test.*` を PWA のコアキャッシュから外す
- `calendar-ui.js` を PWA のコアキャッシュへ追加
- `render.js` を可読性重視で整形
- Google refresh token 失効時に、再接続が必要だとフロントへ明示する
- フロント側でも 401 を受けたときに「再接続してください」と出す
