const $ = (id) => document.getElementById(id);

init().catch((error) => {
  updateStatus(`初期化に失敗しました: ${getErrorMessage(error)}`, "warn");
});

function init() {
  bindEvents();
  setTodayDefaults();
  renderEvents([]);
  return refreshStatus();
}

function bindEvents() {
  $("connectBtn").addEventListener("click", onConnect);
  $("signoutBtn").addEventListener("click", onSignOut);
  $("refreshStatusBtn").addEventListener("click", refreshStatus);
  $("loadEventsBtn").addEventListener("click", loadEventsForSelectedDate);
  $("createEventForm").addEventListener("submit", onCreateEvent);
  $("selectedDate").addEventListener("change", syncEventFormDate);
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
    try {
      const data = await response.json();
      message = data.error || data.message || message;
    } catch {}
    throw new Error(message);
  }

  if (response.status === 204) return null;
  return response.json();
}

function onConnect() {
  const returnTo = encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
  window.location.href = `/auth/google/start?returnTo=${returnTo}`;
}

async function onSignOut() {
  try {
    await api("/api/google/disconnect", {
      method: "POST",
      body: "{}"
    });
    renderEvents([]);
    updateStatus("接続を解除しました。", "");
  } catch (error) {
    updateStatus(`接続解除に失敗しました: ${getErrorMessage(error)}`, "warn");
  }
}

async function refreshStatus() {
  try {
    const data = await api("/api/google/status");
    if (data.connected) {
      const tail = data.lastBackgroundSyncAt
        ? ` / 最終自動同期: ${new Date(data.lastBackgroundSyncAt).toLocaleString("ja-JP")}`
        : "";
      updateStatus(`Google Calendar 接続済み${data.email ? ` (${data.email})` : ""}${tail}`, "ok");
    } else {
      updateStatus("未接続です。『Googleで接続』を押してください。", "");
    }
  } catch (error) {
    updateStatus(`状態取得に失敗しました: ${getErrorMessage(error)}`, "warn");
  }
}

async function loadEventsForSelectedDate() {
  const dateStr = $("selectedDate").value;
  if (!dateStr) {
    updateStatus("対象日を選んでください。", "warn");
    return;
  }

  try {
    updateStatus("予定を読み込んでいます...", "");
    const data = await api(`/api/google/events?date=${encodeURIComponent(dateStr)}`);
    const events = data.items || [];
    renderEvents(events);
    updateStatus(`${events.length} 件の予定を読み込みました。`, "ok");
  } catch (error) {
    updateStatus(`予定の読込に失敗しました: ${getErrorMessage(error)}`, "warn");
  }
}

async function onCreateEvent(e) {
  e.preventDefault();

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
    await api("/api/google/local-event-upsert", {
      method: "POST",
      body: JSON.stringify({
        localEvent: {
          title,
          date,
          start,
          end,
          note: description,
          allDay: false
        }
      })
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
  try {
    updateStatus("予定を削除しています...", "");
    await api(`/api/google/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE"
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

function updateStatus(message, variant = "") {
  const box = $("statusBox");
  box.textContent = message;
  box.className = "status-box";
  if (variant) box.classList.add(variant);
}

function getErrorMessage(error) {
  return error?.message || String(error);
}

function formatDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
