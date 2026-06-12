const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events"
];
const APP_TIME_ZONE = "Asia/Tokyo";
class GoogleAuthError extends Error {
  constructor(message, code = "GOOGLE_REAUTH_REQUIRED") {
    super(message);
    this.name = "GoogleAuthError";
    this.code = code;
  }
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originError = validateMutationOrigin(request, env, url);
    if (originError) return originError;
    if (url.pathname.startsWith("/auth/google/start")) {
      return handleGoogleStart(request, env);
    }
    if (url.pathname.startsWith("/auth/google/callback")) {
      return handleGoogleCallback(request, env);
    }
    if (url.pathname === "/api/google/status") {
      return handleGoogleStatus(request, env);
    }
    if (url.pathname === "/api/app-state" && request.method === "GET") {
      return handleGetAppState(request, env);
    }
    if (url.pathname === "/api/app-state" && request.method === "PUT") {
      return handlePutAppState(request, env);
    }
    if (url.pathname === "/api/google/disconnect" && request.method === "POST") {
      return handleGoogleDisconnect(request, env);
    }
    if (url.pathname === "/api/google/events" && request.method === "GET") {
      return handleGetEvents(request, env);
    }
    if (url.pathname === "/api/google/events-range" && request.method === "GET") {
      return handleGetEventsRange(request, env);
    }
    if (url.pathname === "/api/google/local-event-upsert" && request.method === "POST") {
      return handleLocalEventUpsert(request, env);
    }
    if (url.pathname.startsWith("/api/google/events/") && request.method === "DELETE") {
      return handleDeleteEvent(request, env);
    }
    if (url.pathname === "/api/manaba/token" && request.method === "GET") {
      return handleManabaGetToken(request, env);
    }
    if (url.pathname === "/api/manaba/push" && request.method === "POST") {
      return handleManabaPush(request, env);
    }
    if (url.pathname === "/api/manaba/data" && request.method === "GET") {
      return handleManabaGetData(request, env);
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(syncAllUsers(env));
  }
};
async function handleGoogleStart(request, env) {
  ensureGoogleConfig(env);
  const url = new URL(request.url);
  const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo"));
  const state = crypto.randomUUID();
  await env.DM_STORE.put(`oauth_state:${state}`, JSON.stringify({ returnTo }), {
    expirationTtl: 600
  });
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", getRedirectUri(request));
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  if (url.searchParams.get("forceConsent") === "1") {
    authUrl.searchParams.set("prompt", "consent");
  }
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("state", state);
  return Response.redirect(authUrl.toString(), 302);
}
async function handleGoogleCallback(request, env) {
  ensureGoogleConfig(env);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") || "";
  if (!code || !state) {
    return text("OAuth code または state がありません。", 400);
  }
  const stateRaw = await env.DM_STORE.get(`oauth_state:${state}`);
  if (!stateRaw) {
    return text("OAuth state が不正か期限切れです。", 400);
  }
  await env.DM_STORE.delete(`oauth_state:${state}`);
  const stateData = JSON.parse(stateRaw);
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: getRedirectUri(request),
      grant_type: "authorization_code"
    })
  });
  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return text(`トークン交換に失敗しました: ${err}`, 500);
  }
  const tokens = await tokenRes.json();
  const userInfo = await fetchGoogleUserInfo(tokens.access_token);
  const userKey = userInfo.sub || userInfo.email;
  if (!userKey) {
    return text("Google ユーザー情報の取得に失敗しました。", 500);
  }
  const current = await readUser(env, userKey);
  const user = {
    email: userInfo.email || "",
    profile: {
      sub: userInfo.sub || "",
      name: userInfo.name || "",
      picture: userInfo.picture || ""
    },
    tokens: {
      refresh_token: tokens.refresh_token || current?.tokens?.refresh_token || "",
      access_token: tokens.access_token || "",
      expiry_date: Date.now() + Number(tokens.expires_in || 3600) * 1000
    },
    cacheByDate: current?.cacheByDate || {},
    lastBackgroundSyncAt: current?.lastBackgroundSyncAt || ""
  };
  await writeUser(env, userKey, user);
  await syncOneUser(env, userKey, user);
  const cookieValue = await makeSignedSession(userKey, env.COOKIE_SIGNING_SECRET);
  const headers = new Headers({
    Location: stateData.returnTo || "/"
  });
  headers.append("Set-Cookie", buildSessionCookie(cookieValue));
  return new Response(null, { status: 302, headers });
}
async function handleGoogleStatus(request, env) {
  const session = await getSessionUser(request, env);
  if (!session) {
    return json({ connected: false });
  }
  try {
    const user = await ensureFreshAccessToken(env, session.userKey, session.user);
    return json({
      connected: true,
      email: user.email || "",
      lastBackgroundSyncAt: user.lastBackgroundSyncAt || ""
    });
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      return buildReauthResponse(request, error);
    }
    throw error;
  }
}
async function handleGetAppState(request, env) {
  const session = await requireSessionUser(request, env);
  if (session.error) return session.error;
  const data = await readAppState(env, session.userKey);
  return json({
    state: data?.state || null,
    updatedAt: data?.updatedAt || "",
    revision: Number(data?.revision || 0)
  });
}
async function handlePutAppState(request, env) {
  const session = await requireSessionUser(request, env);
  if (session.error) return session.error;
  const body = await request.json().catch(() => ({}));
  const nextState = body?.state;
  const current = await readAppState(env, session.userKey);
  const currentRevision = Number(current?.revision || 0);
  const requestedRevision = parseRequestedRevision(request, body, currentRevision);
  const serverUpdatedAt = new Date().toISOString();
  if (!nextState || typeof nextState !== "object" || Array.isArray(nextState)) {
    return json({ error: "state が必要です。" }, 400);
  }
  if (requestedRevision !== currentRevision) {
    return json({
      error: "他の端末の更新が先に保存されました。最新状態を取得してから再試行してください。",
      code: "APP_STATE_REVISION_CONFLICT",
      updatedAt: current?.updatedAt || "",
      revision: currentRevision
    }, 409);
  }
  const payload = {
    updatedAt: serverUpdatedAt,
    revision: currentRevision + 1,
    state: nextState
  };
  const serialized = JSON.stringify(payload);
  if (serialized.length > 750_000) {
    return json({ error: "同期データが大きすぎます。" }, 413);
  }
  await writeAppState(env, session.userKey, payload);
  return json({ ok: true, updatedAt: serverUpdatedAt, revision: payload.revision });
}
function validateMutationOrigin(request, env, url) {
  if (!["PUT", "POST", "PATCH", "DELETE"].includes(request.method)) return null;
  if (!url.pathname.startsWith("/api/")) return null;
  const configured = String(env.ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!configured.length) return null;
  const origin = request.headers.get("Origin") || "";
  if (!origin) {
    return json({ error: "Origin ヘッダーが必要です。", code: "ORIGIN_REQUIRED" }, 400);
  }
  if (!configured.includes(origin)) {
    return json({ error: "許可されていない Origin です。", code: "ORIGIN_NOT_ALLOWED" }, 403);
  }
  return null;
}
function parseRequestedRevision(request, body, fallback = 0) {
  const headerValue = request.headers.get("If-Match") || "";
  const headerMatch = headerValue.match(/^(?:W\/)?"?(\d+)"?$/);
  if (headerMatch) return Number(headerMatch[1] || fallback);
  const bodyRevision = Number(body?.baseRevision);
  if (Number.isFinite(bodyRevision) && bodyRevision >= 0) return bodyRevision;
  return fallback;
}
async function handleGoogleDisconnect(request, env) {
  const session = await getSessionUser(request, env);
  if (session) {
    try {
      if (session.user?.tokens?.access_token) {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(session.user.tokens.access_token)}`, {
          method: "POST"
        });
      }
    } catch {}
    await env.DM_STORE.delete(`user:${session.userKey}`);
  }
  const headers = new Headers();
  headers.append("Set-Cookie", clearSessionCookie());
  return new Response(null, { status: 204, headers });
}
async function handleGetEvents(request, env) {
  const session = await requireSessionUser(request, env);
  if (session.error) return session.error;
  try {
    const url = new URL(request.url);
    const date = url.searchParams.get("date") || "";
    if (!date) return json({ error: "date が必要です。" }, 400);
    let user = session.user;
    const today = getTodayDateInAppTimeZone();
    const stale = isCacheStale(user.lastBackgroundSyncAt, Number(env.SYNC_INTERVAL_MINUTES || 15));
    if (date <= today) {
      user = await refreshSingleDateCache(env, session.userKey, user, date);
    } else {
      if (!user.cacheByDate?.[date] || stale) {
        user = await syncOneUser(env, session.userKey, user);
      }
      if (!user.cacheByDate?.[date]) {
        user = await refreshSingleDateCache(env, session.userKey, user, date);
      }
    }
    return json({
      items: user.cacheByDate?.[date] || [],
      lastBackgroundSyncAt: user.lastBackgroundSyncAt || ""
    });
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      return buildReauthResponse(request, error);
    }
    throw error;
  }
}
async function handleGetEventsRange(request, env) {
  const session = await requireSessionUser(request, env);
  if (session.error) return session.error;
  try {
    const url = new URL(request.url);
    const start = url.searchParams.get("start") || "";
    const end = url.searchParams.get("end") || "";
    if (!start || !end) return json({ error: "start と end が必要です。" }, 400);
    if (end < start) return json({ error: "end は start 以降にしてください。" }, 400);
    let user = session.user;
    user = await ensureFreshAccessToken(env, session.userKey, user);
    const items = await fetchEventsForDateRange(user, start, end);
    const rangeCache = {};
    for (const dateKey of enumerateDateRange(start, end)) {
      rangeCache[dateKey] = [];
    }
    for (const event of items) {
      const dateKey = event.start?.date || event.start?.dateTime?.slice(0, 10);
      if (!dateKey) continue;
      if (!rangeCache[dateKey]) rangeCache[dateKey] = [];
      rangeCache[dateKey].push(event);
    }
    for (const dateKey of Object.keys(rangeCache)) {
      rangeCache[dateKey].sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b)));
    }
    const nextUser = {
      ...user,
      cacheByDate: {
        ...(user.cacheByDate || {}),
        ...rangeCache
      },
      lastBackgroundSyncAt: new Date().toISOString()
    };
    await writeUser(env, session.userKey, nextUser);
    return json({
      items,
      start,
      end,
      lastBackgroundSyncAt: nextUser.lastBackgroundSyncAt || ""
    });
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      return buildReauthResponse(request, error);
    }
    throw error;
  }
}
async function handleLocalEventUpsert(request, env) {
  const session = await requireSessionUser(request, env);
  if (session.error) return session.error;
  try {
    const body = await request.json().catch(() => ({}));
    const localEvent = body.localEvent;
    if (!localEvent?.title || !localEvent?.date) {
      return json({ error: "localEvent.title と localEvent.date が必要です。" }, 400);
    }
    let user = session.user;
    user = await ensureFreshAccessToken(env, session.userKey, user);
    let resource;
    try {
      resource = buildGoogleResource(localEvent);
    } catch (error) {
      return json({ error: error?.message || "Google に送る予定データが不正です。" }, 400);
    }
    const path = localEvent.googleEventId
      ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(localEvent.googleEventId)}`
      : `https://www.googleapis.com/calendar/v3/calendars/primary/events`;
    const method = localEvent.googleEventId ? "PUT" : "POST";
    const response = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${user.tokens.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(resource)
    });
    if (!response.ok) {
      const err = await response.text();
      const status = response.status >= 400 && response.status < 500 ? response.status : 500;
      return json({ error: `Google同期に失敗しました: ${err}` }, status);
    }
    const event = await response.json();
    user = await syncOneUser(env, session.userKey, user);
    return json({ ok: true, event, lastBackgroundSyncAt: user.lastBackgroundSyncAt || "" });
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      return buildReauthResponse(request, error);
    }
    throw error;
  }
}
async function handleDeleteEvent(request, env) {
  const session = await requireSessionUser(request, env);
  if (session.error) return session.error;
  try {
    const eventId = decodeURIComponent(new URL(request.url).pathname.split("/").pop() || "");
    if (!eventId) return json({ error: "eventId が必要です。" }, 400);
    let user = session.user;
    user = await ensureFreshAccessToken(env, session.userKey, user);
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${user.tokens.access_token}`
        }
      }
    );
    if (!response.ok && response.status !== 404) {
      const err = await response.text();
      const status = response.status >= 400 && response.status < 500 ? response.status : 500;
      return json({ error: `Google予定の削除に失敗しました: ${err}` }, status);
    }
    user = await syncOneUser(env, session.userKey, user);
    return json({ ok: true, lastBackgroundSyncAt: user.lastBackgroundSyncAt || "" });
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      return buildReauthResponse(request, error);
    }
    throw error;
  }
}
async function syncAllUsers(env) {
  let cursor = undefined;
  while (true) {
    const page = await env.DM_STORE.list({ prefix: "user:", cursor, limit: 100 });
    for (const key of page.keys) {
      const userKey = key.name.replace(/^user:/, "");
      const user = await readUser(env, userKey);
      if (!user) continue;
      try {
        await syncOneUser(env, userKey, user);
      } catch (error) {
        if (error instanceof GoogleAuthError) {
          console.warn("[cron sync skipped: reconnect required]", userKey);
          continue;
        }
        console.error("[cron sync failed]", userKey, String(error));
      }
    }
    if (page.list_complete) break;
    cursor = page.cursor;
  }
}
async function syncOneUser(env, userKey, user) {
  user = await ensureFreshAccessToken(env, userKey, user);
  const today = getTodayDateInAppTimeZone();
  const lookaheadDays = Math.max(0, Number(env.SYNC_LOOKAHEAD_DAYS || 30));
  const { timeMin } = buildDateRangeForGoogleApi(today);
  const max = new Date(Date.now() + lookaheadDays * 24 * 60 * 60 * 1000);
  const items = await fetchEventsList(user, {
    timeMin,
    timeMax: max.toISOString()
  });
  const cacheByDate = {};
  for (let offset = 0; offset <= lookaheadDays; offset += 1) {
    cacheByDate[shiftDateString(today, offset)] = [];
  }
  for (const event of items) {
    const dateKey = event.start?.date || event.start?.dateTime?.slice(0, 10);
    if (!dateKey) continue;
    if (!cacheByDate[dateKey]) cacheByDate[dateKey] = [];
    cacheByDate[dateKey].push(event);
  }
  for (const dateKey of Object.keys(cacheByDate)) {
    cacheByDate[dateKey].sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b)));
  }
  const preservedPastCache = Object.fromEntries(
    Object.entries(user.cacheByDate || {}).filter(([dateKey]) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && dateKey < today)
  );
  const nextUser = {
    ...user,
    cacheByDate: {
      ...preservedPastCache,
      ...cacheByDate
    },
    lastBackgroundSyncAt: new Date().toISOString()
  };
  await writeUser(env, userKey, nextUser);
  return nextUser;
}
async function refreshSingleDateCache(env, userKey, user, dateStr) {
  user = await ensureFreshAccessToken(env, userKey, user);
  const items = await fetchEventsForDate(user, dateStr);
  const nextUser = {
    ...user,
    cacheByDate: {
      ...(user.cacheByDate || {}),
      [dateStr]: items
    },
    lastBackgroundSyncAt: new Date().toISOString()
  };
  await writeUser(env, userKey, nextUser);
  return nextUser;
}
async function fetchEventsForDate(user, dateStr) {
  const { timeMin, timeMax } = buildDateRangeForGoogleApi(dateStr);
  return fetchEventsList(user, { timeMin, timeMax });
}
async function fetchEventsForDateRange(user, startDate, endDate) {
  const { timeMin, timeMax } = buildDateRangeForGoogleApiRange(startDate, endDate);
  return fetchEventsList(user, { timeMin, timeMax });
}
async function fetchEventsList(user, { timeMin, timeMax }) {
  const allItems = [];
  let pageToken = "";
  while (true) {
    const listUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    listUrl.searchParams.set("timeMin", timeMin);
    listUrl.searchParams.set("timeMax", timeMax);
    listUrl.searchParams.set("showDeleted", "false");
    listUrl.searchParams.set("singleEvents", "true");
    listUrl.searchParams.set("orderBy", "startTime");
    listUrl.searchParams.set("maxResults", "2500");
    if (pageToken) listUrl.searchParams.set("pageToken", pageToken);
    const response = await fetch(listUrl.toString(), {
      headers: {
        Authorization: `Bearer ${user.tokens.access_token}`
      }
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Googleイベント取得失敗: ${err}`);
    }
    const data = await response.json();
    allItems.push(...(data.items || []));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return dedupeEventsById(allItems).sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b)));
}
async function ensureFreshAccessToken(env, userKey, user) {
  const refreshToken = user?.tokens?.refresh_token;
  const expiry = Number(user?.tokens?.expiry_date || 0);
  const stillValid = user?.tokens?.access_token && expiry > Date.now() + 60_000;
  if (stillValid) return user;
  if (!refreshToken) {
    await env.DM_STORE.delete(`user:${userKey}`);
    throw new GoogleAuthError("Google の接続期限が切れました。もう一度接続してください。");
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  if (!response.ok) {
    const err = await response.text();
    const shouldRequireReconnect = response.status === 400 && err.includes("invalid_grant");
    if (shouldRequireReconnect) {
      await env.DM_STORE.delete(`user:${userKey}`);
      throw new GoogleAuthError("Google の接続期限が切れました。もう一度接続してください。");
    }
    throw new Error(`アクセストークン更新失敗: ${err}`);
  }
  const tokens = await response.json();
  const nextUser = {
    ...user,
    tokens: {
      ...user.tokens,
      access_token: tokens.access_token,
      expiry_date: Date.now() + Number(tokens.expires_in || 3600) * 1000,
      refresh_token: refreshToken
    }
  };
  await writeUser(env, userKey, nextUser);
  return nextUser;
}
function buildGoogleResource(localEvent) {
  const resource = {
    summary: localEvent.title,
    description: localEvent.note || ""
  };
  if (localEvent.allDay) {
    resource.start = { date: localEvent.date };
    const endDate = new Date(`${localEvent.date}T00:00:00`);
    endDate.setDate(endDate.getDate() + 1);
    resource.end = { date: endDate.toISOString().slice(0, 10) };
    return resource;
  }
  if (!localEvent.start || !localEvent.end) {
    throw new Error("Google同期する単発予定は、終日予定にするか、開始・終了時刻の両方を入れてください。");
  }
  resource.start = { dateTime: `${localEvent.date}T${localEvent.start}:00`, timeZone: APP_TIME_ZONE };
  resource.end = { dateTime: `${localEvent.date}T${localEvent.end}:00`, timeZone: APP_TIME_ZONE };
  return resource;
}
async function fetchGoogleUserInfo(accessToken) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`userinfo 取得失敗: ${err}`);
  }
  return response.json();
}
async function readAppState(env, userKey) {
  const raw = await env.DM_STORE.get(`appstate:${userKey}`);
  return raw ? JSON.parse(raw) : null;
}
async function writeAppState(env, userKey, payload) {
  await env.DM_STORE.put(`appstate:${userKey}`, JSON.stringify(payload));
}
async function readUser(env, userKey) {
  const raw = await env.DM_STORE.get(`user:${userKey}`);
  return raw ? JSON.parse(raw) : null;
}
async function writeUser(env, userKey, user) {
  const normalizedUser = normalizeUserForStorage(user, env);
  await env.DM_STORE.put(`user:${userKey}`, JSON.stringify(normalizedUser));
}
function normalizeUserForStorage(user, env) {
  return {
    ...user,
    cacheByDate: pruneCacheByDate(user?.cacheByDate || {}, env)
  };
}
function pruneCacheByDate(cacheByDate, env) {
  const pastDays = Math.max(0, Number(env.CACHE_PAST_RETENTION_DAYS || 45));
  const futureDays = Math.max(
    Number(env.SYNC_LOOKAHEAD_DAYS || 30),
    Number(env.CACHE_FUTURE_RETENTION_DAYS || 45)
  );
  const today = getTodayDateInAppTimeZone();
  const minDate = shiftDateString(today, -pastDays);
  const maxDate = shiftDateString(today, futureDays);
  const next = {};
  for (const [dateKey, items] of Object.entries(cacheByDate || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
    if (dateKey < minDate || dateKey > maxDate) continue;
    next[dateKey] = Array.isArray(items) ? items : [];
  }
  return next;
}
function shiftDateString(dateStr, diffDays) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + diffDays);
  return date.toISOString().slice(0, 10);
}
function eventSortKey(event) {
  if (event.start?.date && !event.start?.dateTime) return `${event.start.date} 00:00`;
  const dt = event.start?.dateTime || "";
  return `${dt.slice(0, 10)} ${dt.slice(11, 16)}`;
}
function dedupeEventsById(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.id || `${item.summary || ''}:${eventSortKey(item)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function isCacheStale(lastSyncAt, minutes) {
  if (!lastSyncAt) return true;
  return Date.now() - new Date(lastSyncAt).getTime() > minutes * 60 * 1000;
}
async function requireSessionUser(request, env) {
  const session = await getSessionUser(request, env);
  if (!session) {
    return {
      error: buildReauthResponse(request, new GoogleAuthError("Google に接続していません。", "GOOGLE_NOT_CONNECTED"))
    };
  }
  return session;
}
async function getSessionUser(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const raw = cookies.dm_session;
  if (!raw) return null;
  const [userKey, signature] = raw.split(".");
  if (!userKey || !signature) return null;
  const valid = await verifySignature(userKey, signature, env.COOKIE_SIGNING_SECRET);
  if (!valid) return null;
  const user = await readUser(env, userKey);
  if (!user) return null;
  return { userKey, user };
}
async function makeSignedSession(userKey, secret) {
  const signature = await signValue(userKey, secret);
  return `${userKey}.${signature}`;
}
function buildSessionCookie(value) {
  return `dm_session=${value}; Path=/; Max-Age=${60 * 60 * 24 * 30}; HttpOnly; Secure; SameSite=Lax`;
}
function clearSessionCookie() {
  return `dm_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
function buildReauthResponse(request, error) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8"
  });
  headers.append("Set-Cookie", clearSessionCookie());
  const url = new URL(request.url);
  const returnTo = sanitizeReturnTo(`${url.pathname}${url.search}`);
  const reconnectUrl = `/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`;
  return new Response(
    JSON.stringify({
      error: error.message,
      code: error.code || "GOOGLE_REAUTH_REQUIRED",
      reconnectUrl
    }),
    {
      status: 401,
      headers
    }
  );
}
async function signValue(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toBase64Url(signature);
}
async function verifySignature(value, signature, secret) {
  const expected = await signValue(value, secret);
  return timingSafeEqual(expected, signature);
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
function toBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function parseCookies(cookieHeader) {
  const result = {};
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (!key) continue;
    result[key] = rest.join("=");
  }
  return result;
}
function sanitizeReturnTo(value) {
  if (!value || typeof value !== "string") return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  return value;
}
function getRedirectUri(request) {
  const url = new URL(request.url);
  return `${url.origin}/auth/google/callback`;
}
function ensureGoogleConfig(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.COOKIE_SIGNING_SECRET) {
    throw new Error("Cloudflare Worker secrets が未設定です。");
  }
}
function buildDateRangeForGoogleApi(dateStr) {
  const start = new Date(`${dateStr}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return {
    timeMin: start.toISOString(),
    timeMax: end.toISOString()
  };
}
function buildDateRangeForGoogleApiRange(startDateStr, endDateStr) {
  const start = new Date(`${startDateStr}T00:00:00+09:00`);
  const end = new Date(`${endDateStr}T00:00:00+09:00`);
  end.setDate(end.getDate() + 1);
  return {
    timeMin: start.toISOString(),
    timeMax: end.toISOString()
  };
}
function enumerateDateRange(startDateStr, endDateStr) {
  const result = [];
  const cursor = new Date(`${startDateStr}T00:00:00+09:00`);
  const end = new Date(`${endDateStr}T00:00:00+09:00`);
  while (cursor <= end) {
    result.push(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: APP_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(cursor)
    );
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}
function getTodayDateInAppTimeZone() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
function text(message, status = 200) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}
async function handleManabaGetToken(request, env) {
  const session = await requireSessionUser(request, env);
  if (session.error) return session.error;
  const userKey = session.userKey;
  const kvKey = `manaba_token:${userKey}`;
  let token = await env.DM_STORE.get(kvKey);
  if (!token) {
    token = generateOpaqueToken();
    await env.DM_STORE.put(kvKey, token);
  }
  await env.DM_STORE.put(`manaba_token_index:${token}`, userKey);
  return json({ token });
}
async function handleManabaPush(request, env) {
  const token = String(request.headers.get("X-Manaba-Token") || "").trim();
  if (!token) {
    return json({ error: "X-Manaba-Token ヘッダーが必要です。" }, 401);
  }
  const userKey = await env.DM_STORE.get(`manaba_token_index:${token}`);
  if (!userKey) {
    return json({ error: "manaba 同期トークンが無効です。" }, 403);
  }
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.courses)) {
    return json({ error: "courses 配列が必要です。" }, 400);
  }
  const now = new Date().toISOString();
  const courses = sanitizeManabaCourses(body.courses);
  const payload = {
    version: 1,
    receivedAt: now,
    scrapedAt: normalizeIsoText(body.scrapedAt) || now,
    manabaUrl: truncateTextValue(body.manabaUrl, 500),
    courses
  };
  await env.DM_STORE.put(`manaba_data:${userKey}`, JSON.stringify(payload), {
    expirationTtl: 60 * 60 * 24 * 30
  });
  return json({
    ok: true,
    courseCount: courses.length,
    assignmentCount: courses.reduce((sum, course) => sum + course.assignments.length, 0),
    receivedAt: now
  });
}
async function handleManabaGetData(request, env) {
  // トークン認証（Claude / 外部API用）
  const token = String(request.headers.get("X-Manaba-Token") || "").trim();
  if (token) {
    const userKey = await env.DM_STORE.get(`manaba_token_index:${token}`);
    if (!userKey) {
      return json({ error: "manaba 同期トークンが無効です。" }, 403);
    }
    const raw = await env.DM_STORE.get(`manaba_data:${userKey}`);
    if (!raw) return json({ data: null });
    return json({ data: JSON.parse(raw) });
  }
  // セッション認証（Day Manager フロントエンド用、従来通り）
  const session = await requireSessionUser(request, env);
  if (session.error) return session.error;
  const raw = await env.DM_STORE.get(`manaba_data:${session.userKey}`);
  if (!raw) return json({ data: null });
  return json({ data: JSON.parse(raw) });
}
function sanitizeManabaCourses(courses) {
  return courses.slice(0, 300).map((course) => ({
    title: truncateTextValue(course?.title || course?.name, 200),
    url: normalizeHttpText(course?.url),
    externalId: truncateTextValue(course?.externalId || course?.url || course?.title || course?.name, 500),
    assignments: sanitizeManabaAssignments(course?.assignments)
  })).filter((course) => course.title);
}
function sanitizeManabaAssignments(assignments) {
  if (!Array.isArray(assignments)) return [];
  return assignments.slice(0, 500).map((assignment) => ({
    title: truncateTextValue(assignment?.title, 300),
    dueDate: normalizeDateOnlyText(assignment?.dueDate),
    dueTime: normalizeTimeOnlyText(assignment?.dueTime),
    status: truncateTextValue(assignment?.status, 120),
    url: normalizeHttpText(assignment?.url),
    type: truncateTextValue(assignment?.type, 80),
    externalId: truncateTextValue(assignment?.externalId || assignment?.url || assignment?.title, 500),
    updatedAt: normalizeIsoText(assignment?.updatedAt)
  })).filter((assignment) => assignment.title);
}
function normalizeDateOnlyText(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}
function normalizeTimeOnlyText(value) {
  const text = String(value || "").trim();
  return /^\d{2}:\d{2}$/.test(text) ? text : "";
}
function normalizeHttpText(value) {
  const text = String(value || "").trim();
  return /^https?:\/\//i.test(text) ? text.slice(0, 500) : "";
}
function normalizeIsoText(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
function truncateTextValue(value, maxLength = 200) {
  return String(value || "").trim().slice(0, maxLength);
}
function generateOpaqueToken() {
  const tokenBytes = new Uint8Array(24);
  crypto.getRandomValues(tokenBytes);
  return toBase64Url(tokenBytes.buffer);
}
