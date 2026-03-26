import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(__dirname, "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SESSION_SECRET = process.env.SESSION_SECRET || "change-me";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const SYNC_INTERVAL_MINUTES = Math.max(5, Number(process.env.SYNC_INTERVAL_MINUTES || 15));
const SYNC_LOOKAHEAD_DAYS = Math.max(1, Number(process.env.SYNC_LOOKAHEAD_DAYS || 30));
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events"
];

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(STORE_PATH)) {
  fs.writeFileSync(STORE_PATH, JSON.stringify({ users: {} }, null, 2), "utf-8");
}

function loadStore() {
  return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
}

function saveStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

function createOAuthClient() {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    `${BASE_URL}/auth/google/callback`
  );
}

function requireGoogleConfig(res) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    res.status(500).json({ error: "Google OAuth の環境変数が未設定です。" });
    return false;
  }
  return true;
}

function getSessionUser(store, req) {
  const userKey = req.session.userKey;
  if (!userKey) return null;
  return store.users[userKey] || null;
}

function sanitizeReturnTo(value) {
  if (typeof value !== "string" || !value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  return value;
}

async function refreshAndPersistUser(store, userKey) {
  const user = store.users[userKey];
  if (!user?.tokens) return null;

  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials(user.tokens);

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  const now = new Date();
  const max = new Date();
  max.setDate(max.getDate() + SYNC_LOOKAHEAD_DAYS);

  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin: now.toISOString(),
    timeMax: max.toISOString(),
    showDeleted: false,
    singleEvents: true,
    orderBy: "startTime"
  });

  const items = response.data.items || [];
  const cacheByDate = {};

  for (const event of items) {
    const dateKey = event.start?.date || event.start?.dateTime?.slice(0, 10);
    if (!dateKey) continue;
    if (!cacheByDate[dateKey]) cacheByDate[dateKey] = [];
    cacheByDate[dateKey].push(event);
  }

  for (const dateKey of Object.keys(cacheByDate)) {
    cacheByDate[dateKey].sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b)));
  }

  user.cacheByDate = cacheByDate;
  user.lastBackgroundSyncAt = new Date().toISOString();

  const nextTokens = oauth2Client.credentials;
  if (nextTokens?.refresh_token || nextTokens?.access_token) {
    user.tokens = { ...user.tokens, ...nextTokens };
  }

  store.users[userKey] = user;
  saveStore(store);
  return user;
}

function eventSortKey(event) {
  if (event.start?.date && !event.start?.dateTime) return `${event.start.date} 00:00`;
  const dt = event.start?.dateTime || "";
  return `${dt.slice(0, 10)} ${dt.slice(11, 16)}`;
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

  const timeZone = "Asia/Tokyo";
  resource.start = { dateTime: `${localEvent.date}T${localEvent.start}:00`, timeZone };
  resource.end = { dateTime: `${localEvent.date}T${localEvent.end}:00`, timeZone };
  return resource;
}

async function getCalendarClientForUser(user) {
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials(user.tokens);
  return google.calendar({ version: "v3", auth: oauth2Client });
}

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE
  }
}));

app.get("/auth/google/start", (req, res) => {
  if (!requireGoogleConfig(res)) return;
  const oauth2Client = createOAuthClient();
  const returnTo = sanitizeReturnTo(
    typeof req.query.returnTo === "string" ? req.query.returnTo : "/"
  );
  const state = crypto.randomBytes(16).toString("hex");

  req.session.returnTo = returnTo;
  req.session.oauthState = state;

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    state
  });

  res.redirect(url);
});

app.get("/auth/google/callback", async (req, res) => {
  if (!requireGoogleConfig(res)) return;
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";

  if (!code) {
    res.status(400).send("OAuth code がありません。");
    return;
  }

  if (!req.session.oauthState || state !== req.session.oauthState) {
    res.status(400).send("OAuth state の検証に失敗しました。");
    return;
  }

  try {
    const oauth2Client = createOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const me = await oauth2.userinfo.get();
    const email = me.data.email || "";
    const userKey = email || me.data.id || `user-${Date.now()}`;

    const store = loadStore();
    const previous = store.users[userKey] || {};
    store.users[userKey] = {
      ...previous,
      email,
      profile: {
        id: me.data.id || "",
        name: me.data.name || "",
        picture: me.data.picture || ""
      },
      tokens: {
        ...previous.tokens,
        ...tokens
      },
      cacheByDate: previous.cacheByDate || {},
      lastBackgroundSyncAt: previous.lastBackgroundSyncAt || ""
    };
    saveStore(store);

    req.session.userKey = userKey;

    try {
      const syncStore = loadStore();
      await refreshAndPersistUser(syncStore, userKey);
    } catch (syncError) {
      console.error("Initial background sync failed:", syncError);
    }

    const returnTo = sanitizeReturnTo(req.session.returnTo || "/");
    delete req.session.returnTo;
    delete req.session.oauthState;
    res.redirect(returnTo);
  } catch (error) {
    console.error("OAuth callback failed:", error);
    res.status(500).send("Google認証に失敗しました。");
  }
});

app.get("/api/google/status", async (req, res) => {
  const store = loadStore();
  const user = getSessionUser(store, req);
  if (!user) {
    res.json({ connected: false });
    return;
  }

  res.json({
    connected: true,
    email: user.email || "",
    lastBackgroundSyncAt: user.lastBackgroundSyncAt || ""
  });
});

app.post("/api/google/disconnect", async (req, res) => {
  const store = loadStore();
  const userKey = req.session.userKey;
  const user = userKey ? store.users[userKey] : null;

  if (user?.tokens?.access_token) {
    try {
      const oauth2Client = createOAuthClient();
      oauth2Client.setCredentials(user.tokens);
      await oauth2Client.revokeCredentials();
    } catch (error) {
      console.error("Revoke failed:", error);
    }
  }

  if (userKey && store.users[userKey]) {
    delete store.users[userKey];
    saveStore(store);
  }
  req.session.destroy(() => {});
  res.status(204).end();
});

app.get("/api/google/events", async (req, res) => {
  const date = typeof req.query.date === "string" ? req.query.date : "";
  const store = loadStore();
  const userKey = req.session.userKey;
  const user = userKey ? store.users[userKey] : null;

  if (!user) {
    res.status(401).json({ error: "Google に接続していません。" });
    return;
  }
  if (!date) {
    res.status(400).json({ error: "date が必要です。" });
    return;
  }

  try {
    await refreshAndPersistUser(store, userKey);
    const latestStore = loadStore();
    const latest = latestStore.users[userKey] || user;
    res.json({
      items: latest.cacheByDate?.[date] || [],
      lastBackgroundSyncAt: latest.lastBackgroundSyncAt || ""
    });
  } catch (error) {
    console.error("Fetch events failed:", error);
    res.json({
      items: user.cacheByDate?.[date] || [],
      lastBackgroundSyncAt: user.lastBackgroundSyncAt || ""
    });
  }
});

app.post("/api/google/local-event-upsert", async (req, res) => {
  const store = loadStore();
  const userKey = req.session.userKey;
  const user = userKey ? store.users[userKey] : null;
  const localEvent = req.body?.localEvent;

  if (!user) {
    res.status(401).json({ error: "Google に接続していません。" });
    return;
  }
  if (!localEvent?.title || !localEvent?.date) {
    res.status(400).json({ error: "localEvent.title と localEvent.date が必要です。" });
    return;
  }

  try {
    const calendar = await getCalendarClientForUser(user);
    const resource = buildGoogleResource(localEvent);
    let result;

    if (localEvent.googleEventId) {
      const response = await calendar.events.update({
        calendarId: "primary",
        eventId: localEvent.googleEventId,
        requestBody: resource
      });
      result = response.data;
    } else {
      const response = await calendar.events.insert({
        calendarId: "primary",
        requestBody: resource
      });
      result = response.data;
    }

    const refreshStore = loadStore();
    await refreshAndPersistUser(refreshStore, userKey);

    res.json({ ok: true, event: result });
  } catch (error) {
    console.error("Upsert local event failed:", error);
    res.status(500).json({ error: error.message || "Google同期に失敗しました。" });
  }
});

app.delete("/api/google/events/:eventId", async (req, res) => {
  const store = loadStore();
  const userKey = req.session.userKey;
  const user = userKey ? store.users[userKey] : null;
  const eventId = req.params.eventId;

  if (!user) {
    res.status(401).json({ error: "Google に接続していません。" });
    return;
  }

  try {
    const calendar = await getCalendarClientForUser(user);
    await calendar.events.delete({
      calendarId: "primary",
      eventId
    });

    const refreshStore = loadStore();
    await refreshAndPersistUser(refreshStore, userKey);

    res.json({ ok: true });
  } catch (error) {
    console.error("Delete Google event failed:", error);
    res.status(500).json({ error: error.message || "Google予定の削除に失敗しました。" });
  }
});

app.use(express.static(ROOT_DIR));

async function backgroundSyncAllUsers() {
  const store = loadStore();
  const keys = Object.keys(store.users || {});
  if (!keys.length) return;

  for (const userKey of keys) {
    try {
      await refreshAndPersistUser(store, userKey);
      console.log(`[sync] ${userKey} ok`);
    } catch (error) {
      console.error(`[sync] ${userKey} failed:`, error.message || error);
    }
  }
}

setInterval(() => {
  backgroundSyncAllUsers().catch((error) => {
    console.error("Background sync failed:", error);
  });
}, SYNC_INTERVAL_MINUTES * 60 * 1000);

backgroundSyncAllUsers().catch((error) => {
  console.error("Initial background sync failed:", error);
});

app.listen(PORT, () => {
  console.log(`Day Manager server listening on ${BASE_URL}`);
});
