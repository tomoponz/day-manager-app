今回の改善は「UIを増やす」ではなく、運用事故を減らす方向に寄せています。

入れた内容:
- 破壊的操作の前に自動退避を保存
- 管理パネルから「直前状態を復元」を追加
- AI提案の上書き・削除・反映前も自動退避
- Worker の cacheByDate を保存時に剪定して肥大化を抑制

差し替えファイル:
- index.html
- style.css
- js/actions.js
- js/study-manager-editor.js
- js/ai-drafts.js
- js/recovery.js (新規)
- cloudflare-worker/src/index.js
- cloudflare-worker/wrangler.toml
