export const GOOGLE_OAUTH_CONFIG = {
  clientId: "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com",
  apiKey: "YOUR_GOOGLE_API_KEY"
};

export function hasConfiguredGoogleKeys() {
  return Boolean(
    GOOGLE_OAUTH_CONFIG.clientId &&
    GOOGLE_OAUTH_CONFIG.apiKey &&
    !GOOGLE_OAUTH_CONFIG.clientId.includes("YOUR_GOOGLE_OAUTH_CLIENT_ID") &&
    !GOOGLE_OAUTH_CONFIG.apiKey.includes("YOUR_GOOGLE_API_KEY")
  );
}
