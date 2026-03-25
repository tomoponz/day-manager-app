この zip は起動時の `Cannot read properties of null (reading 'addEventListener')` を止めるためのガード版です。

入っているもの:
- js/actions.js

直した内容:
- すべての addEventListener を安全バインド化
- 要素が無いときはスキップする
- そのため、UI差分や古いキャッシュが混ざっても起動時に落ちにくくなる

重要:
このエラーは Service Worker の古いキャッシュで新旧ファイルが混ざっているときにも起こりやすいです。
反映後はブラウザ側でも以下をしてください。

1. DevTools を開く
2. Application
3. Service Workers
4. Unregister
5. Clear storage
6. Hard Reload
