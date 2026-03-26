import { state, saveState, normalizeOneOffEvent } from "./state.js";
import { $ } from "./utils.js";
import { formatDateInput, formatTimeOnly } from "./time.js";
import { confirmDialog, showToast } from "./ui-feedback.js";

export const googleState = {
  connected: false,
  email: "",
  lastBackgroundSyncAt: "",
  eventsByDate: {},
  rangeLoaded: {
    start: "",
    end: ""
  }
};

const ui = {
  renderAll: null,
  updateGoogleStatus: null,
  updateGoogleConnectionBadge: null
};

export function configureGoogleUi(callbacks = {}) {
  Object.assign(ui, callbacks);
}

function notifyStatus(message, variant = "") {
  ui.updateGoogleStatus?.(message, variant);
}

function rerender() {
  ui.renderAll?.();
  ui.updateGoogleConnectionBadge?.();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    let code = "";
    let reconnectUrl = "";

    try {
      const data = await response.json();
      message = data.error || data.message || message;
      code = data.code || "";
      reconnectUrl = data.reconnectUrl || "";
    } catch {}

    const error = new Error(message);
    error.status = response.status;
    error.code = code;
    error.reconnectUrl = reconnectUrl;
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
}

function isReconnectRequiredError(error) {
  return error?.status === 401 || error?.code === "GOOGLE_REAUTH_REQUIRED";
}

function handleReconnectRequired(error, fallbackMessage) {
  googleState.connected = false;
  clearGoogleCache();
  rerender();

  const message =
    fallbackMessage ||
    "Google の接続期限が切れました。もう一度『Googleで接続』を押して再接続してください。";

  notifyStatus(message, "warn");
  return error?.reconnectUrl || "";
}

export async function initializeGoogleBackgroundSync() {
  await refreshGoogleStatus({ silent: false });

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible" && googleState.connected) {
      await refreshGoogleStatus({ silent: true });
      await loadGoogleEventsForSelectedDate({ silent: true });
    }
  });

  window.addEventListener("focus", async () => {
    if (googleState.connected) {
      await refreshGoogleStatus({ silent: true });
      await loadGoogleEventsForSelectedDate({ silent: true });
    }
  });
}

export async function refreshGoogleStatus({ silent = false } = {}) {
  try {
    const data = await api("/api/google/status");
    googleState.connected = Boolean(data.connected);
    googleState.email = data.email || "";
    googleState.lastBackgroundSyncAt = data.lastBackgroundSyncAt || "";
    rerender();

    if (!silent) {
      if (googleState.connected) {
        const tail = googleState.lastBackgroundSyncAt
          ? ` / 最終自動同期: ${new Date(googleState.lastBackgroundSyncAt).toLocaleString("ja-JP")}`
          : "";
        notifyStatus(
          `Google Calendar 接続済み${googleState.email ? ` (${googleState.email})` : ""}${tail}`,
          "ok"
        );
      } else {
        clearGoogleCache();
        notifyStatus("Googleで接続すると、この Worker が Google Calendar と同期します。");
      }
    }
    return data;
  } catch (error) {
    if (isReconnectRequiredError(error)) {
      if (!silent) handleReconnectRequired(error);
      return null;
    }

    googleState.connected = false;
    rerender();
    if (!silent) notifyStatus(`Google状態の取得に失敗しました: ${getErrorMessage(error)}`, "warn");
    return null;
  }
}

export function maybePrepareTokenClient() {}
export async function gapiLoaded() {}
export function gisLoaded() {}

export function hasValidGoogleToken() {
  return googleState.connected;
}

export function getCachedGoogleEvents(dateStr) {
  return googleState.eventsByDate[dateStr] || [];
}

export function getCachedGoogleEventsInRange(startDate, endDate) {
  const result = [];
  if (!startDate || !endDate) return result;

  for (const dateKey of Object.keys(googleState.eventsByDate || {})) {
    if (dateKey >= startDate && dateKey <= endDate) {
      result.push(...(googleState.eventsByDate[dateKey] || []));
    }
  }

  return result;
}

function clearGoogleCache() {
  googleState.eventsByDate = {};
  googleState.rangeLoaded = { start: "", end: "" };
}

function setCachedGoogleEventsForRange(startDate, endDate, items = []) {
  if (!startDate || !endDate) return;

  for (const dateKey of enumerateDateKeys(startDate, endDate)) {
    googleState.eventsByDate[dateKey] = [];
  }

  for (const event of items) {
    const dateKey = event.start?.date || event.start?.dateTime?.slice(0, 10);
    if (!dateKey) continue;
    if (!googleState.eventsByDate[dateKey]) googleState.eventsByDate[dateKey] = [];
    googleState.eventsByDate[dateKey].push(event);
  }

  for (const dateKey of Object.keys(googleState.eventsByDate)) {
    googleState.eventsByDate[dateKey].sort((a, b) =>
      formatGoogleEventTime(a).localeCompare(formatGoogleEventTime(b))
    );
  }

  googleState.rangeLoaded = { start: startDate, end: endDate };
}

function enumerateDateKeys(startDate, endDate) {
  const values = [];
  if (!startDate || !endDate) return values;

  const cursor = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  while (cursor <= end) {
    values.push(formatDateInput(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return values;
}

export async function onSaveGoogleConfig() {
  notifyStatus("Cloudflare Workers 版ではブラウザ入力を使いません。Worker secrets を設定してください。", "warn");
}

export function onClearGoogleConfig() {
  notifyStatus("Cloudflare Workers 版ではブラウザ入力を使いません。Worker secrets を設定してください。", "warn");
}

export function onConnectGoogle() {
  const returnTo = encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
  window.location.href = `/auth/google/start?returnTo=${returnTo}`;
}

export async function onDisconnectGoogle() {
  try {
    await api("/api/google/disconnect", { method: "POST", body: "{}" });
    googleState.connected = false;
    clearGoogleCache();
    rerender();
    notifyStatus("Google との接続を解除しました。");
  } catch (error) {
    notifyStatus(`接続解除に失敗しました: ${getErrorMessage(error)}`, "warn");
  }
}

export async function loadGoogleEventsForSelectedDate(options = {}) {
  return loadGoogleEventsForDate($("selectedDate")?.value || "", options);
}

export async function loadGoogleEventsForDate(dateStr, { silent = false } = {}) {
  if (!googleState.connected) {
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
    const data = await api(`/api/google/events?date=${encodeURIComponent(dateStr)}`);
    setCachedGoogleEventsForRange(dateStr, dateStr, data.items || []);
    if (data.lastBackgroundSyncAt) googleState.lastBackgroundSyncAt = data.lastBackgroundSyncAt;
    rerender();

    if (!silent) {
      notifyStatus(`${googleState.eventsByDate[dateStr].length} 件の Google 予定を読み込みました。`, "ok");
    }

    return googleState.eventsByDate[dateStr];
  } catch (error) {
    if (isReconnectRequiredError(error)) {
      if (!silent) handleReconnectRequired(error);
      return [];
    }

    if (!silent) notifyStatus(`Google予定の読込に失敗しました: ${getErrorMessage(error)}`, "warn");
    return [];
  }
}

export async function loadGoogleEventsRange(
  startDate,
  endDate,
  { silent = false, skipRerender = false } = {}
) {
  if (!googleState.connected) {
    if (!silent) notifyStatus("先に Google で接続してください。", "warn");
    if (!skipRerender) rerender();
    return [];
  }
  if (!startDate || !endDate) return [];

  try {
    if (!silent) notifyStatus("表示範囲の Google 予定を読み込んでいます...");
    const data = await api(
      `/api/google/events-range?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`
    );
    setCachedGoogleEventsForRange(startDate, endDate, data.items || []);
    if (data.lastBackgroundSyncAt) googleState.lastBackgroundSyncAt = data.lastBackgroundSyncAt;
    if (!skipRerender) rerender();

    if (!silent) {
      notifyStatus(`表示範囲の Google 予定を ${data.items?.length || 0} 件読み込みました。`, "ok");
    }

    return data.items || [];
  } catch (error) {
    if (isReconnectRequiredError(error)) {
      if (!silent) handleReconnectRequired(error);
      return [];
    }

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
    const duplicateLocal = state.oneOffEvents.some(
      (item) =>
        item.date === candidate.date &&
        item.title === candidate.title &&
        (item.start || "") === (candidate.start || "") &&
        (item.end || "") === (candidate.end || "") &&
        Boolean(item.allDay) === Boolean(candidate.allDay)
    );

    if (alreadyLinked || duplicateLocal) {
      skipped += 1;
      return;
    }

    state.oneOffEvents.push(normalizeOneOffEvent(candidate));
    imported += 1;
  });

  saveState();
  rerender();
  notifyStatus(
    `Google 予定をローカルへ ${imported} 件取り込みました。重複候補 ${skipped} 件はスキップしました。`,
    imported ? "ok" : "warn"
  );
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
  const result = await api("/api/google/local-event-upsert", {
    method: "POST",
    body: JSON.stringify({ localEvent })
  });
  return result.event;
}

export async function updateGoogleEventFromLocal(localEvent) {
  const result = await api("/api/google/local-event-upsert", {
    method: "POST",
    body: JSON.stringify({ localEvent })
  });
  return result.event;
}

export async function syncLocalEventToGoogle(localEventId) {
  const item = state.oneOffEvents.find((event) => event.id === localEventId);
  if (!item) return;
  if (!googleState.connected) {
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

    if (isReconnectRequiredError(error)) {
      handleReconnectRequired(error);
      return;
    }

    notifyStatus(`Google Calendar への追加に失敗しました: ${getErrorMessage(error)}`, "warn");
  }
}

export async function syncUpdatedLocalEventToGoogle(localEventId) {
  const item = state.oneOffEvents.find((event) => event.id === localEventId);
  if (!item || !item.googleEventId) return;
  if (!googleState.connected) {
    notifyStatus("Google に接続してから『Google更新』を押してください。", "warn");
    return;
  }

  try {
    notifyStatus("Google Calendar の予定を更新しています...");
    const updated = await updateGoogleEventFromLocal(item);
    item.googleSyncStatus = "synced";
    saveState();
    cacheGoogleEvent(updated, item.date);
    rerender();
    notifyStatus("Google Calendar の予定を更新しました。", "ok");
  } catch (error) {
    item.googleSyncStatus = "failed";
    saveState();
    rerender();

    if (isReconnectRequiredError(error)) {
      handleReconnectRequired(error);
      return;
    }

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
    if (googleState.connected) {
      try {
        await deleteGoogleEventById(item.googleEventId, { removeLocalMirror: false, silent: true });
      } catch (error) {
        if (isReconnectRequiredError(error)) {
          handleReconnectRequired(error);
          return;
        }

        const proceed = await confirmDialog({
          title: "Google 側の削除に失敗",
          message: `Google 側の削除に失敗しました。ローカルだけ削除しますか？\n\n${getErrorMessage(error)}`,
          confirmText: "ローカルだけ削除",
          danger: true
        });
        if (!proceed) return;
      }
    } else {
      const proceed = await confirmDialog({
        title: "ローカルだけ削除",
        message:
          "この予定は Google Calendar と同期されています。現在は未接続なので、ローカルだけ削除されます。続けますか？",
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
  await api(`/api/google/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE"
  });

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
  return error?.message || String(error);
}
