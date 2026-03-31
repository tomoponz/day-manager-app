import { state, saveState, normalizeOneOffEvent, serializePersistableState, getLocalStateUpdatedAt, setLocalStateUpdatedAt } from "./state.js";
import { normalizePersistedState, applyPersistedState, captureRecoverySnapshot } from "./recovery.js";
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
  },
  appStateSync: {
    remoteUpdatedAt: "",
    lastSyncedAt: "",
    mode: "",
    connectedAccount: ""
  }
};

let appStatePushTimer = null;
let suppressAutoAppStatePush = false;

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

function setAppStateSyncStatus(message, variant = "") {
  const box = $("appStateSyncStatusBox");
  if (!box) return;
  box.textContent = message;
  box.dataset.variant = variant || "";
}

function updateAppStateSyncButtons() {
  const disabled = !googleState.connected;
  [$("pullCloudAppStateBtn"), $("pushCloudAppStateBtn")].forEach((button) => {
    if (!button) return;
    button.disabled = disabled;
  });
}

function hasMeaningfulItems(value) {
  return Array.isArray(value) && value.length > 0;
}

function hasMeaningfulObjectEntries(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function hasMeaningfulAppStateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;
  return [
    hasMeaningfulItems(snapshot.fixedSchedules),
    hasMeaningfulItems(snapshot.oneOffEvents),
    hasMeaningfulItems(snapshot.tasks),
    hasMeaningfulItems(snapshot.studyLocations),
    hasMeaningfulItems(snapshot.courses),
    hasMeaningfulItems(snapshot.materials),
    hasMeaningfulItems(snapshot.assessments),
    hasMeaningfulItems(snapshot.milestones),
    hasMeaningfulItems(snapshot.planningDrafts),
    hasMeaningfulObjectEntries(snapshot.dayConditions),
    hasMeaningfulObjectEntries(snapshot.weeklyPlans)
  ].some(Boolean);
}

function getLocalAppStateSnapshot() {
  try {
    return serializePersistableState();
  } catch {
    return null;
  }
}

function getSyncStatusTail() {
  return googleState.appStateSync.lastSyncedAt
    ? ` / 最終同期: ${new Date(googleState.appStateSync.lastSyncedAt).toLocaleString("ja-JP")}`
    : "";
}

function scheduleAppStatePush() {
  if (suppressAutoAppStatePush || !googleState.connected) return;
  clearTimeout(appStatePushTimer);
  appStatePushTimer = setTimeout(() => {
    pushLocalAppState({ silent: true }).catch(() => {});
  }, 1200);
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

async function getRemoteAppState() {
  return api("/api/app-state");
}

async function putRemoteAppState(payload) {
  return api("/api/app-state", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

async function applyRemoteAppState(remote, { silent = false } = {}) {
  if (!remote?.state) {
    if (!silent) setAppStateSyncStatus("クラウド側に同期済みデータはまだありません。", "warn");
    return null;
  }

  suppressAutoAppStatePush = true;
  try {
    const normalized = normalizePersistedState(remote.state);
    if (hasMeaningfulAppStateSnapshot(getLocalAppStateSnapshot())) {
      captureRecoverySnapshot("cloud-pull");
    }
    applyPersistedState(normalized);
    setLocalStateUpdatedAt(remote.updatedAt || new Date().toISOString());
    googleState.appStateSync.remoteUpdatedAt = remote.updatedAt || "";
    googleState.appStateSync.lastSyncedAt = new Date().toISOString();
    googleState.appStateSync.mode = "pull";
    try {
      const studyModule = await import("./study-manager.js");
      studyModule.renderStudyManager?.();
    } catch {}
    rerender();
    setAppStateSyncStatus(`同じGoogleアカウントの保存データをこの端末へ同期しました。${getSyncStatusTail()}`, "ok");
    if (!silent) notifyStatus("クラウドのタスク・予定・学習データをこの端末へ同期しました。", "ok");
    return normalized;
  } finally {
    setTimeout(() => {
      suppressAutoAppStatePush = false;
    }, 0);
  }
}

async function pushLocalAppState({ silent = false } = {}) {
  if (!googleState.connected) {
    if (!silent) setAppStateSyncStatus("Googleで接続すると、同じアカウント間でタスクや予定を同期できます。", "warn");
    return null;
  }

  const updatedAt = getLocalStateUpdatedAt() || new Date().toISOString();
  const payload = {
    updatedAt,
    state: serializePersistableState()
  };

  const result = await putRemoteAppState(payload);
  const syncedAt = result?.updatedAt || updatedAt;
  googleState.appStateSync.remoteUpdatedAt = syncedAt;
  googleState.appStateSync.lastSyncedAt = new Date().toISOString();
  googleState.appStateSync.mode = "push";
  setLocalStateUpdatedAt(syncedAt);
  setAppStateSyncStatus(`この端末のデータをクラウドへ保存しました。${getSyncStatusTail()}`, "ok");
  if (!silent) notifyStatus("この端末のタスク・予定・学習データをクラウドへ保存しました。", "ok");
  return result;
}

export async function syncAppStateWithCloud({ silent = false, forcePull = false, forcePush = false } = {}) {
  if (!googleState.connected) {
    updateAppStateSyncButtons();
    if (!silent) setAppStateSyncStatus("Googleで接続すると、同じアカウント間でタスクや予定を同期できます。", "");
    return null;
  }

  try {
    if (forcePush) {
      return await pushLocalAppState({ silent });
    }

    const remote = await getRemoteAppState();
    const remoteUpdatedAt = remote?.updatedAt || "";
    const localUpdatedAt = getLocalStateUpdatedAt();
    googleState.appStateSync.remoteUpdatedAt = remoteUpdatedAt;

    if (forcePull) {
      return await applyRemoteAppState(remote, { silent });
    }

    const localSnapshot = getLocalAppStateSnapshot();
    const remoteSnapshot = remote?.state || null;
    const localHasMeaningfulData = hasMeaningfulAppStateSnapshot(localSnapshot);
    const remoteHasMeaningfulData = hasMeaningfulAppStateSnapshot(remoteSnapshot);

    if (!remote?.state) {
      if (localHasMeaningfulData && localUpdatedAt) {
        return await pushLocalAppState({ silent: true });
      }
      setAppStateSyncStatus("クラウド側に同期済みデータはまだありません。", "");
      return remote;
    }

    if (remoteHasMeaningfulData && !localHasMeaningfulData) {
      return await applyRemoteAppState(remote, { silent: true });
    }

    if (localHasMeaningfulData && !remoteHasMeaningfulData) {
      return await pushLocalAppState({ silent: true });
    }

    if (!localUpdatedAt) {
      return await applyRemoteAppState(remote, { silent: true });
    }

    if (remoteUpdatedAt && remoteUpdatedAt > localUpdatedAt) {
      return await applyRemoteAppState(remote, { silent: true });
    }

    if (!remoteUpdatedAt || localUpdatedAt > remoteUpdatedAt) {
      return await pushLocalAppState({ silent: true });
    }

    googleState.appStateSync.lastSyncedAt = new Date().toISOString();
    googleState.appStateSync.mode = "same";
    setAppStateSyncStatus(`同じGoogleアカウントの端末間データは最新です。${getSyncStatusTail()}`, "ok");
    return remote;
  } catch (error) {
    if (!silent) {
      setAppStateSyncStatus(`端末間同期に失敗しました: ${getErrorMessage(error)}`, "warn");
      notifyStatus(`端末間同期に失敗しました: ${getErrorMessage(error)}`, "warn");
    }
    throw error;
  } finally {
    updateAppStateSyncButtons();
  }
}

function isReconnectRequiredError(error) {
  return error?.status === 401 || error?.code === "GOOGLE_REAUTH_REQUIRED";
}

function handleReconnectRequired(error, fallbackMessage) {
  googleState.connected = false;
  clearGoogleCache();
  updateAppStateSyncButtons();
  setAppStateSyncStatus("Google の接続期限が切れました。再接続後に端末間同期が再開します。", "warn");
  rerender();

  const message =
    fallbackMessage ||
    "Google の接続期限が切れました。もう一度『Googleで接続』を押して再接続してください。";

  notifyStatus(message, "warn");
  return error?.reconnectUrl || "";
}

export async function initializeGoogleBackgroundSync() {
  $("pullCloudAppStateBtn")?.addEventListener("click", async () => {
    try {
      await syncAppStateWithCloud({ forcePull: true, silent: false });
    } catch {}
  });
  $("pushCloudAppStateBtn")?.addEventListener("click", async () => {
    try {
      await syncAppStateWithCloud({ forcePush: true, silent: false });
    } catch {}
  });

  window.addEventListener("day-manager:state-saved", () => {
    scheduleAppStatePush();
  });

  await refreshGoogleStatus({ silent: false });
  if (googleState.connected) {
    try {
      await syncAppStateWithCloud({ silent: true });
    } catch {}
  }

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible" && googleState.connected) {
      await refreshGoogleStatus({ silent: true });
      await loadGoogleEventsForSelectedDate({ silent: true });
      try {
        await syncAppStateWithCloud({ silent: true });
      } catch {}
    }
  });

  window.addEventListener("focus", async () => {
    if (googleState.connected) {
      await refreshGoogleStatus({ silent: true });
      await loadGoogleEventsForSelectedDate({ silent: true });
      try {
        await syncAppStateWithCloud({ silent: true });
      } catch {}
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
        updateAppStateSyncButtons();
        setAppStateSyncStatus("Googleで接続すると、同じアカウントでタスク・予定・学習データも同期できます。", "");
        notifyStatus("Googleで接続すると、この Worker が Google Calendar と同期します。");
      }
    }
    if (googleState.connected) {
      updateAppStateSyncButtons();
      setAppStateSyncStatus(`同じGoogleアカウントなら、タスク・予定・学習データも同期できます。${getSyncStatusTail()}`, "");
    }
    return data;
  } catch (error) {
    if (isReconnectRequiredError(error)) {
      if (!silent) handleReconnectRequired(error);
      return null;
    }

    googleState.connected = false;
    updateAppStateSyncButtons();
    setAppStateSyncStatus("Google状態の取得に失敗したため、端末間同期も停止しています。", "warn");
    rerender();
    if (!silent) notifyStatus(`Google状態の取得に失敗しました: ${getErrorMessage(error)}`, "warn");
    return null;
  }
}

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
    updateAppStateSyncButtons();
    setAppStateSyncStatus("接続解除中です。この端末のローカルデータは残ります。", "");
    rerender();
    notifyStatus("Google との接続を解除しました。", "ok");
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

export async function upsertGoogleEventFromLocal(localEvent) {
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
    const created = await upsertGoogleEventFromLocal(item);
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
    const updated = await upsertGoogleEventFromLocal(item);
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
