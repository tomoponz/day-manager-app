# Delete candidates after review

以下は、現行コードの参照を確認したうえで、次に削除候補として扱えるものです。

- `js/google-config.js`
- `js/product-ui-tune.js`
- `legacy-server/`
- `download`
- `cloudflare-worker/download`
- `calendar-test.html`
- `calendar-test.js`

注意:
- `calendar-test.html` / `calendar-test.js` はローカル疎通確認に使うなら残して構いません。
- 完全削除する前に `rg -n "google-config|product-ui-tune|calendar-test|legacy-server" .` で再確認してください。
