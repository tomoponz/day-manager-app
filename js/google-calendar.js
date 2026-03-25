import { state, saveState, normalizeOneOffEvent } from "./state.js";
import { $ } from "./utils.js";
import { addDays, formatDateInput, formatTimeOnly } from "./time.js";
import { confirmDialog, showToast } from "./ui-feedback.js";
import { GOOGLE_OAUTH_CONFIG, hasConfiguredGoogleKeys } from "./google-config.js";

export const DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest";
export const SCOPES = "https://www.googleapis.com/auth/calendar.events";

export const googleState = {
  config: {
    clientId: GOOGLE_OAUTH_CONFIG.clientId || "",
    apiKey: GOOGLE_OAUTH_CONFIG.apiKey || ""
  },
  gapiLibraryLoaded: false,
  gapiReady: false,
  gisReady: false,
  tokenClient: null,
  eventsByDate: {}
};

const ui = {
  renderAll: null,
  updateGoogleStatus: null,
  updateGoogleConnectionBadge: null,
  hydrateGoogleConfigInputs: null
};

export function configureGoogleUi(callbacks = {}) {
  Object.assign(ui, callbacks);
}

function notifyStatus(message, variant = "") {
  ui.updateGoogleStatus?.(message, variant);
}

function rerender() {
  ui.hydrateGoogleConfigInputs?.();
  ui.renderAll?.();
  ui.updateGoogleConnectionBadge?.();
}

export async function gapiLoaded() {
  googleState.gapiLibraryLoaded = true;
  gapi.load("client", async () => {
    await maybeInitializeGoogleClient();
  });
}

export function gisLoaded() {
  googleState.gisReady = true;
  maybePrepareTokenClient();
}

export async function maybeInitializeGoogleClient() {
  googleState.config = {
    clientId: GOOGLE_OAUTH_CONFIG.clientId || "",
    apiKey: GOOGLE_OAUTH_CONFIG.apiKey || ""
  };

  if (!googleState.gapiLibraryLoaded) return;
  if (!hasConfiguredGoogleKeys()) {
    googleState.gapiReady = false;
    notifyStatus("js/google-config.js に Client ID / API Key を入れてください。", "warn");
    return;
  }

  try {
    await gapi.client.init({
      apiKey: googleState.config.apiKey,
      discoveryDocs: [DISCOVERY_DOC]
    });
    googleState.gapiReady = true;
    notifyStatus(
      hasValidGoogleToken()
        ? "Google Calendar に接続中です。"
        : "Google で接続できます。",
      hasValidGoogleToken() ? "ok" : ""
    );
  } catch (error) {
    googleState.gapiReady = false;
    notifyStatus(`Google API 初期化に失敗しました: ${getErrorMessage(error)}`, "warn");
  }
}

export function maybePrepareTokenClient() {
  googleState.config = {
    clientId: GOOGLE_OAUTH_CONFIG.clientId || "",
    apiKey: GOOGLE_OAUTH_CONFIG.apiKey || ""
  };

  if (!googleState.gisReady || !hasConfiguredGoogleKeys()) return;

  googleState.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: googleState.config.clientId,
    scope: SCOPES,
    callback: ""
  });
}

export function hasValidGoogleToken() {
  return Boolean(gapi?.client?.getToken()?.access_token);
}

export function getCachedGoogleEvents(dateStr) {
  return googleState.eventsByDate[dateStr] || [];
}

export async function onSaveGoogleConfig() {
  notifyStatus("この版では入力保存を使いません。js/google-config.js に固定してください。", "warn");
}

export function onClearGoogleConfig() {
  notifyStatus("この版では入力保存を使いません。js/google-config.js を編集してください。", "warn");
}

export function onConnectGoogle() {
  if (!hasConfiguredGoogleKeys()) {
    notifyStatus("js/google-config.js に Client ID / API Key を入れてください。", "warn");
    return;
  }
  if (!googleState.gapiReady) {
    notifyStatus("Google API の初期化がまだ終わっていません。少し待ってから再試行してください。", "warn");
    return;
  }
  if (!googleState.tokenClient) {
    maybePrepareTokenClient();
    if (!googleState.tokenClient) {
      notifyStatus("OAuth クライアントを準備できませんでした。js/google-config.js を確認してください。", "warn");
      return;
    }
  }

  googleState.tokenClient.callback = async (response) => {
    if (response.error) {
      notifyStatus(`Google接続に失敗しました: ${response.error}`, "warn");
      return;
    }
    notifyStatus("Google Calendar に接続しました。対象日の予定を読み込みます。", "ok");
    rerender();
    await loadGoogleEventsForSelectedDate();
  };

  const currentToken = gapi.client.getToken();
  if (!currentToken) googleState.tokenClient.requestAccessToken({ prompt: "consent" });
  else googleState.tokenClient.requestAccessToken({ prompt: "" });
}

export function onDisconnectGoogle() {
  const token = gapi?.client?.getToken();
  if (token?.access_token) {
    google.accounts.oauth2.revoke(token.access_token);
    gapi.client.setToken(null);
  }
  googleState.eventsByDate = {};
  rerender();
  notifyStatus("Google との接続を解除しました。");
}

export async function loadGoogleEventsForSelectedDate() {
  return loadGoogleEventsForDate($("selectedDate")?.value || "");
}

export async function loadGoogleEventsForDate(dateStr, { silent = false } = {}) {
  if (!hasValidGoogleToken()) {
    if (!silent) notifyStatus("先に Google で接続してください。", "warn");
    rerender();
    return [];
  }
  if (!dateStr) {
    if (!silent) notifyStatus("対象日を選んでください。", "warn");
    return [];
  }

  try {
    if (!silent) notifyStatus("Google予定を読み込んでいます...");
    const timeMin = new Date(`${dateStr}T00:00:00`).toISOString();
    const timeMax = new Date(`${dateStr}T23:59:59`).toISOString();

    const response = await gapi.client.calendar.events.list({
      calendarId: "primary",
      timeMin,
      timeMax,
      showDeleted: false,
      singleEvents: true,
      orderBy: "startTime"
    });

    googleState.eventsByDate[dateStr] = response.result.items || [];
    rerender();

    if (!silent) {
      notifyStatus(`${googleState.eventsByDate[dateStr].length} 件の Google 予定を読み込みました。`, "ok");
    }
    return googleState.eventsByDate[dateStr];
  } catch (error) {
    if (!silent) notifyStatus(`Google予定の読込に失敗しました: ${getErrorMessage(error)}`, "warn");
    return [];
  }
}

export function importGoogleEventsToLocal(dateStr = $("selectedDate")?.value || "") {
  const events = getCachedGoogleEvents(dateStr);
  if (!events.length) {
    notifyStatus("取り込める Google 予定がありません。先に対象日の予定を読み込んでください。", "warn");
    return { imported: 0, skipped: 0 };
  }

  let imported = 0;
  let skipped = 0;

  events.forEach((event) => {
    const candidate = mapGoogleEventToLocal(event, dateStr);
    const alreadyLinked = state.oneOffEvents.some((item) => item.googleEventId === event.id);
    const duplicateLocal = state.oneOffEvents.some((item) => item.date === candidate.date && item.title === candidate.title && (item.start || "") === (candidate.start || "") && (item.end || "") === (candidate.end || "") && Boolean(item.allDay) === Boolean(candidate.allDay));

    if (alreadyLinked || duplicateLocal) {
      skipped += 1;
      return;
    }

    state.oneOffEvents.push(normalizeOneOffEvent(candidate));
    imported += 1;
  });

  saveState();
  rerender();
  notifyStatus(`Google 予定をローカルへ ${imported} 件取り込みました。重複候補 ${skipped} 件はスキップしました。`, imported ? "ok" : "warn");
  return { imported, skipped };
}

function mapGoogleEventToLocal(event, fallbackDate) {
  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  if (allDay) {
    return {
      id: crypto.randomUUID(),
      title: event.summary || "Google予定",
      date: event.start?.date || fallbackDate,
      start: "",
      end: "",
      note: event.description || "Google から取込",
      allDay: true,
      googleEventId: event.id,
      googleSyncStatus: "synced"
    };
  }

  const start = event.start?.dateTime ? new Date(event.start.dateTime) : new Date(`${fallbackDate}T00:00:00`);
  const end = event.end?.dateTime ? new Date(event.end.dateTime) : null;
  return {
    id: crypto.randomUUID(),
    title: event.summary || "Google予定",
    date: formatDateInput(start),
    start: formatTimeOnly(start),
    end: end ? formatTimeOnly(end) : "",
    note: event.description || "Google から取込",
    allDay: false,
    googleEventId: event.id,
    googleSyncStatus: "synced"
  };
}

export async function createGoogleEventFromLocal(localEvent) {
  if (!hasValidGoogleToken()) throw new Error("Google に接続していません");

  const resource = buildGoogleEventResource(localEvent);
  const response = await gapi.client.calendar.events.insert({ calendarId: "primary", resource });
  return response.result;
}

export async function updateGoogleEventFromLocal(localEvent) {
  if (!hasValidGoogleToken()) throw new Error("Google に接続していません");
  if (!localEvent.googleEventId) throw new Error("Google Event ID がありません");

  const resource = buildGoogleEventResource(localEvent);
  const response = await gapi.client.calendar.events.update({
    calendarId: "primary",
    eventId: localEvent.googleEventId,
    resource
  });

  Object.keys(googleState.eventsByDate).forEach((dateKey) => {
    googleState.eventsByDate[dateKey] = googleState.eventsByDate[dateKey].filter((event) => event.id !== localEvent.googleEventId);
  });
  cacheGoogleEvent(response.result, localEvent.date);
  return response.result;
}

function buildGoogleEventResource(localEvent) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const resource = { summary: localEvent.title, description: localEvent.note || "" };

  if (localEvent.allDay) {
    resource.start = { date: localEvent.date };
    resource.end = { date: addDays(localEvent.date, 1) };
    return resource;
  }

  if (!localEvent.start || !localEvent.end) {
    throw new Error("Google同期する単発予定は、終日予定にするか、開始・終了時刻の両方を入れてください。");
  }

  resource.start = { dateTime: `${localEvent.date}T${localEvent.start}:00`, timeZone };
  resource.end = { dateTime: `${localEvent.date}T${localEvent.end}:00`, timeZone };
  return resource;
}

export async function syncLocalEventToGoogle(localEventId) {
  const item = state.oneOffEvents.find((event) => event.id === localEventId);
  if (!item) return;
  if (!hasValidGoogleToken()) {
    notifyStatus("Google に接続してから『Google追加』を押してください。", "warn");
    return;
  }

  try {
    notifyStatus("ローカル予定を Google Calendar に追加しています...");
    const created = await createGoogleEventFromLocal(item);
    item.googleEventId = created.id;
    item.googleSyncStatus = "synced";
    saveState();
    cacheGoogleEvent(created, item.date);
    rerender();
    notifyStatus("Google Calendar に追加しました。", "ok");
  } catch (error) {
    item.googleSyncStatus = "failed";
    saveState();
    rerender();
    notifyStatus(`Google Calendar への追加に失敗しました: ${getErrorMessage(error)}`, "warn");
  }
}

export async function syncUpdatedLocalEventToGoogle(localEventId) {
  const item = state.oneOffEvents.find((event) => event.id === localEventId);
  if (!item || !item.googleEventId) return;
  if (!hasValidGoogleToken()) {
    notifyStatus("Google に接続してから『Google更新』を押してください。", "warn");
    return;
  }

  try {
    notifyStatus("Google Calendar の予定を更新しています...");
    await updateGoogleEventFromLocal(item);
    item.googleSyncStatus = "synced";
    saveState();
    rerender();
    notifyStatus("Google Calendar の予定を更新しました。", "ok");
  } catch (error) {
    item.googleSyncStatus = "failed";
    saveState();
    rerender();
    notifyStatus(`Google Calendar の更新に失敗しました: ${getErrorMessage(error)}`, "warn");
  }
}

export function cacheGoogleEvent(event, dateStr) {
  const targetDate = dateStr || event.start?.date || event.start?.dateTime?.slice(0, 10);
  const list = getCachedGoogleEvents(targetDate).filter((item) => item.id !== event.id);
  list.push(event);
  list.sort((a, b) => formatGoogleEventTime(a).localeCompare(formatGoogleEventTime(b)));
  googleState.eventsByDate[targetDate] = list;
}

export async function deleteLocalEvent(localEventId) {
  const item = state.oneOffEvents.find((event) => event.id === localEventId);
  if (!item) return;
  const index = state.oneOffEvents.findIndex((event) => event.id === localEventId);

  if (item.googleEventId) {
    if (hasValidGoogleToken()) {
      try {
        await deleteGoogleEventById(item.googleEventId, { removeLocalMirror: false, silent: true });
      } catch (error) {
        const proceed = await confirmDialog({
          title: "Google 側の削除に失敗",
          message: `Google 側の削除に失敗しました。ローカルだけ削除しますか？

${getErrorMessage(error)}`,
          confirmText: "ローカルだけ削除",
          danger: true
        });
        if (!proceed) return;
      }
    } else {
      const proceed = await confirmDialog({
        title: "ローカルだけ削除",
        message: "この予定は Google Calendar と同期されています。現在は未接続なので、ローカルだけ削除されます。続けますか？",
        confirmText: "続ける",
        danger: true
      });
      if (!proceed) return;
    }
  }

  state.oneOffEvents = state.oneOffEvents.filter((event) => event.id !== localEventId);
  saveState();
  rerender();

  if (!item.googleEventId) {
    showToast("予定を削除しました。", {
      variant: "ok",
      duration: 5000,
      actionLabel: "元に戻す",
      onAction: () => {
        state.oneOffEvents.splice(index, 0, item);
        saveState();
        rerender();
        showToast("予定を元に戻しました。", { variant: "ok", duration: 1800 });
      }
    });
  }
}

export async function deleteGoogleEventById(eventId, { removeLocalMirror = true, silent = false } = {}) {
  if (!hasValidGoogleToken()) throw new Error("Google に接続していません");

  await gapi.client.calendar.events.delete({ calendarId: "primary", eventId });

  Object.keys(googleState.eventsByDate).forEach((dateKey) => {
    googleState.eventsByDate[dateKey] = googleState.eventsByDate[dateKey].filter((event) => event.id !== eventId);
  });

  if (removeLocalMirror) {
    state.oneOffEvents = state.oneOffEvents.filter((event) => event.googleEventId !== eventId);
    saveState();
  }

  rerender();
  if (!silent) notifyStatus("Google Calendar の予定を削除しました。", "ok");
}

export function formatGoogleEventTime(event) {
  if (event.start?.date && !event.start?.dateTime) return `${event.start.date} / 終日`;
  const start = event.start?.dateTime ? new Date(event.start.dateTime) : null;
  const end = event.end?.dateTime ? new Date(event.end.dateTime) : null;
  if (!start) return "時刻不明";
  const startText = `${formatDateInput(start)} ${formatTimeOnly(start)}`;
  const endText = end ? formatTimeOnly(end) : "--:--";
  return `${startText} - ${endText}`;
}

export function getErrorMessage(error) {
  return error?.result?.error?.message || error?.message || String(error);
}
