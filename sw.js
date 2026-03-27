const CACHE_NAME = "day-manager-cache-v11";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./js/actions.js",
  "./js/ai-drafts.js",
  "./js/ai-gemini-assist.js",
  "./js/calendar-ui.js",
  "./js/date-nav-ui.js",
  "./js/google-calendar.js",
  "./js/main-screen-layout.js",
  "./js/planner.js",
  "./js/product-ui-tune.js",
  "./js/prompt.js",
  "./js/quick-add.js",
  "./js/render.js",
  "./js/state.js",
  "./js/study-manager.js",
  "./js/study-manager-shared.js",
  "./js/study-manager-summary.js",
  "./js/study-manager-editor.js",
  "./js/time.js",
  "./js/ui-feedback.js",
  "./js/utils.js",
  "./js/workspace-nav.js"
];

const STATIC_ASSET_PATTERN = /\.(?:css|js|mjs|png|svg|jpg|jpeg|webp|gif|ico|woff2?|ttf|otf|json|webmanifest)$/i;
const BYPASS_PREFIXES = ["/api/", "/auth/"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (shouldBypassCache(url)) return;

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request));
    return;
  }

  if (!isStaticAssetRequest(url)) {
    return;
  }

  event.respondWith(staleWhileRevalidate(event.request));
});

function shouldBypassCache(url) {
  return BYPASS_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

function isStaticAssetRequest(url) {
  if (url.pathname === "/" || url.pathname.endsWith("/index.html")) return true;
  return STATIC_ASSET_PATTERN.test(url.pathname);
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch {
    const cached = await cache.match(request);
    return cached || caches.match("./index.html");
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response?.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || fetchPromise || Response.error();
}
