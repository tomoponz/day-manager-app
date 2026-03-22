const CONFIG_STORAGE_KEY = "calendar-test-config-v1";
const DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest";
const SCOPES = "https://www.googleapis.com/auth/calendar.events";

let tokenClient = null;
let gapiReady = false;
let gisReady = false;
let currentConfig = loadConfig();

const $ = (id) => document.getElementById(id);

window.gapiLoaded = function gapiLoaded() {
  gapi.load("client", async () => {
    try {
      await gapi.client.init({
        apiKey: currentConfig.apiKey || "",
        discoveryDocs: [DISCOVERY_DOC]
      });
      gapiReady = true;
      updateStatus("Google API ライブラリを読み込みました。Client ID と API Key を保存してから接続してください。", "");
    } catch (error) {
      updateStatus(`gapi 初期化に失敗しました: ${getErrorMessage(error)}`, "warn");
    }
  });
};

window.gisLoaded = function gisLoaded() {
  gisReady = true;
  maybePrepareTokenClient();
};

init();

function init() {
  bindEvents();
  hydrateConfigInputs();
  setTodayDefaults();
  renderEvents([]);
  maybePrepareTokenClient();
}

function bindEvents() {
  $("saveConfigBtn").addEventListener("click", onSaveConfig);
  $("clearConfigBtn").addEventListener("click", onClearConfig);
  $("connectBtn").addEventListener("click", onConnect);
  $("signoutBtn").addEventListener("click", onSignOut);
  $("loadEventsBtn").addEventListener("click", loadEventsForSelectedDate);
  $("createEventForm").addEventListener("submit", onCreateEvent);
  $("selectedDate").addEventListener("change", syncEventFormDate);
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return { clientId: "", apiKey: "" };
    const parsed = JSON.parse(raw);
    return {
      clientId: parsed.clientId || "",
      apiKey: parsed.apiKey || ""
    };
  } catch {
    return { clientId: "", apiKey: "" };
  }
}

function saveConfig(config) {
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
}

function hydrateConfigInputs() {
  $("clientIdInput").value = currentConfig.clientId || "";
  $("apiKeyInput").value = currentConfig.apiKey || "";
}

function setTodayDefaults() {
  const today = formatDateInput(new Date());
  $("selectedDate").value = today;
  $("eventDateInput").value = today;
  $("eventStartInput").value = "09:00";
  $("eventEndInput").value = "10:00";
}

function syncEventFormDate() {
  $("eventDateInput").value = $("selectedDate").value;
}

async function onSaveConfig() {
  currentConfig = {
    clientId: $("clientIdInput").value.trim(),
    apiKey: $("apiKeyInput").value.trim()
  };

  if (!currentConfig.clientId || !currentConfig.apiKey) {
    updateStatus("Client ID と API Key の両方を入力してください。", "warn");
    return;
  }

  saveConfig(currentConfig);
  maybePrepareTokenClient();

  try {
    if (gapi?.client) {
      await gapi.client.init({
        apiKey: currentConfig.apiKey,
        discoveryDocs: [DISCOVERY_DOC]
      });
      gapiReady = true;
    }
    updateStatus("設定を保存しました。次に『Googleで接続』を押してください。", "ok");
  } catch (error) {
    updateStatus(`設定保存後の初期化に失敗しました: ${getErrorMessage(error)}`, "warn");
  }
}

function onClearConfig() {
  localStorage.removeItem(CONFIG_STORAGE_KEY);
  currentConfig = { clientId: "", apiKey: "" };
  hydrateConfigInputs();
  if (gapi?.client) {
    gapi.client.setToken("");
  }
  tokenClient = null;
  updateStatus("保存済みの設定を削除しました。", "");
  renderEvents([]);
}

function maybePrepareTokenClient() {
  if (!gisReady) return;
  if (!currentConfig.clientId) return;

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: currentConfig.clientId,
    scope: SCOPES,
    callback: ""
  });
}

function onConnect() {
  if (!currentConfig.clientId || !currentConfig.apiKey) {
    updateStatus("先に Client ID と API Key を保存してください。", "warn");
    return;
  }
  if (!gapiReady) {
    updateStatus("Google API ライブラリの初期化がまだ終わっていません。少し待ってから再試行してください。", "warn");
    return;
  }
  if (!tokenClient) {
    maybePrepareTokenClient();
    if (!tokenClient) {
      updateStatus("OAuth クライアントを準備できませんでした。Client ID を確認してください。", "warn");
      return;
    }
  }

  tokenClient.callback = async (response) => {
    if (response.error) {
      updateStatus(`接続に失敗しました: ${response.error}`, "warn");
      return;
    }
    updateStatus("Googleカレンダーに接続しました。予定一覧を読み込めます。", "ok");
    await loadEventsForSelectedDate();
  };

  const currentToken = gapi.client.getToken();
  if (!currentToken) {
    tokenClient.requestAccessToken({ prompt: "consent" });
  } else {
    tokenClient.requestAccessToken({ prompt: "" });
  }
}

function onSignOut() {
  const token = gapi?.client?.getToken();
  if (token?.access_token) {
    google.accounts.oauth2.revoke(token.access_token);
    gapi.client.setToken("");
  }
  updateStatus("接続を解除しました。", "");
}

async function loadEventsForSelectedDate() {
  if (!hasValidToken()) {
    updateStatus("先に Google で接続してください。", "warn");
    return;
  }

  const dateStr = $("selectedDate").value;
  if (!dateStr) {
    updateStatus("対象日を選んでください。", "warn");
    return;
  }

  try {
    updateStatus("予定を読み込んでいます...", "");
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

    const events = response.result.items || [];
    renderEvents(events);
    updateStatus(`${events.length} 件の予定を読み込みました。`, "ok");
  } catch (error) {
    updateStatus(`予定の読込に失敗しました: ${getErrorMessage(error)}`, "warn");
  }
}

async function onCreateEvent(e) {
  e.preventDefault();

  if (!hasValidToken()) {
    updateStatus("先に Google で接続してください。", "warn");
    return;
  }

  const title = $("eventTitleInput").value.trim();
  const date = $("eventDateInput").value;
  const start = $("eventStartInput").value;
  const end = $("eventEndInput").value;
  const description = $("eventDescriptionInput").value.trim();

  if (!title || !date || !start || !end) {
    updateStatus("タイトル・日付・開始時刻・終了時刻を入力してください。", "warn");
    return;
  }

  if (`${date}T${end}` <= `${date}T${start}`) {
    updateStatus("終了時刻は開始時刻より後にしてください。", "warn");
    return;
  }

  try {
    updateStatus("予定を追加しています...", "");
    await gapi.client.calendar.events.insert({
      calendarId: "primary",
      resource: {
        summary: title,
        description,
        start: {
          dateTime: new Date(`${date}T${start}:00`).toISOString()
        },
        end: {
          dateTime: new Date(`${date}T${end}:00`).toISOString()
        }
      }
    });

    updateStatus("予定を追加しました。", "ok");
    e.currentTarget.reset();
    $("eventDateInput").value = $("selectedDate").value;
    $("eventStartInput").value = "09:00";
    $("eventEndInput").value = "10:00";
    await loadEventsForSelectedDate();
  } catch (error) {
    updateStatus(`予定の追加に失敗しました: ${getErrorMessage(error)}`, "warn");
  }
}

async function deleteEvent(eventId) {
  if (!hasValidToken()) {
    updateStatus("先に Google で接続してください。", "warn");
    return;
  }

  try {
    updateStatus("予定を削除しています...", "");
    await gapi.client.calendar.events.delete({
      calendarId: "primary",
      eventId
    });
    updateStatus("予定を削除しました。", "ok");
    await loadEventsForSelectedDate();
  } catch (error) {
    updateStatus(`予定の削除に失敗しました: ${getErrorMessage(error)}`, "warn");
  }
}

function renderEvents(events) {
  const wrap = $("eventList");
  wrap.innerHTML = "";

  if (!events.length) {
    wrap.className = "list-wrap empty";
    wrap.textContent = "まだありません";
    return;
  }

  wrap.className = "list-wrap";

  events.forEach((event) => {
    const node = $("eventItemTemplate").content.cloneNode(true);
    node.querySelector(".item-title").textContent = event.summary || "タイトルなし";
    node.querySelector(".event-time").textContent = formatEventTime(event);
    node.querySelector(".item-note").textContent = event.description || "説明なし";
    node.querySelector(".delete-event-btn").addEventListener("click", () => deleteEvent(event.id));
    wrap.appendChild(node);
  });
}

function formatEventTime(event) {
  const start = event.start?.dateTime || event.start?.date;
  const end = event.end?.dateTime || event.end?.date;
  if (!start) return "時刻不明";

  if (event.start?.date && !event.start?.dateTime) {
    return `${event.start.date} 終日`;
  }

  const startDate = new Date(start);
  const endDate = end ? new Date(end) : null;
  const startText = `${formatDateInput(startDate)} ${String(startDate.getHours()).padStart(2, "0")}:${String(startDate.getMinutes()).padStart(2, "0")}`;
  const endText = endDate
    ? `${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}`
    : "--:--";
  return `${startText} - ${endText}`;
}

function hasValidToken() {
  return Boolean(gapi?.client?.getToken()?.access_token);
}

function updateStatus(message, variant = "") {
  const box = $("statusBox");
  box.textContent = message;
  box.className = "status-box";
  if (variant) box.classList.add(variant);
}

function getErrorMessage(error) {
  return error?.result?.error?.message || error?.message || String(error);
}

function formatDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
