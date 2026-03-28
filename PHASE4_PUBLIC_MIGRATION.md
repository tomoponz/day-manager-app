# Phase 4: public/ 分離適用メモ

## 何を変えるか
- Cloudflare Worker の assets 配信先を repo ルートから `public/` に変更
- 実際に配信する静的ファイル一式を `public/` に複製
- README を `public/` 前提に更新

## 適用手順
1. この配布物の `public/` を repo 直下へ配置する
2. `cloudflare-worker/wrangler.toml` を差し替える
3. Worker を再デプロイする

## 反映コマンド例（PowerShell）
```powershell
Copy-Item -Recurse -Force "C:\Users\yuto1\Downloads\day-manager-app-phase4\public" "C:\Users\yuto1\OneDrive\デスクトップ\day-manager-app-git\public"
Copy-Item -Force "C:\Users\yuto1\Downloads\day-manager-app-phase4\cloudflare-worker\wrangler.toml" "C:\Users\yuto1\OneDrive\デスクトップ\day-manager-app-git\cloudflare-worker\wrangler.toml"
Copy-Item -Force "C:\Users\yuto1\Downloads\day-manager-app-phase4\README.md" "C:\Users\yuto1\OneDrive\デスクトップ\day-manager-app-git\README.md"
Copy-Item -Force "C:\Users\yuto1\Downloads\day-manager-app-phase4\cloudflare-worker\README.md" "C:\Users\yuto1\OneDrive\デスクトップ\day-manager-app-git\cloudflare-worker\README.md"
```

## デプロイ
```powershell
cd "C:\Users\yuto1\OneDrive\デスクトップ\day-manager-app-git\cloudflare-worker"
npm run deploy
```

## まず確認すること
- Worker URL で画面が開くか
- `index.html` / `style.css` / `app.js` が `public/` 版で配信されているか
- Google 連携と FullCalendar が普通に動くか

## まだやっていないこと
- repo ルートの旧静的ファイル削除
- `calendar-test.*` や `legacy-server/` の物理整理
- `render.js` / `actions.js` の本格分割
