// Deprecated:
// Worker 版ではブラウザ側に Google の資格情報を固定しません。
// 旧設計との互換のためファイルだけ残していますが、現在は未使用です。

export const GOOGLE_OAUTH_CONFIG = {
  clientId: "",
  apiKey: ""
};

export function hasConfiguredGoogleKeys() {
  return false;
}
