const STORAGE_KEY = "day-manager-v1";
const GOOGLE_CONFIG_KEY = "day-manager-google-config-v1";
const DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest";
const SCOPES = "https://www.googleapis.com/auth/calendar.events";

const INITIAL_STATE = {
  fixedSchedules: [],
  oneOffEvents: [],
  tasks: [],
  dayConditions: {}
};

const $ = (id) => document.getElementById(id);
const state = loadState();
const weekdayNames = ["日", "月", "火", "水", "木", "金", "土"];

const googleState = {
  config: loadGoogleConfig(),
  gapiLibraryLoaded: false,
  gapiReady: false,
  gisReady: false,
  tokenClient: null,
  eventsByDate: {}
};

window.gapiLoaded = function gapiLoaded() {
  googleState.gapiLibraryLoaded = true;
  gapi.load("client", async () => {
    await maybeInitializeGoogleClient();
  });
};

window.gisLoaded = function gisLoaded() {
  googleState.gisReady = true;
  maybePrepareTokenClient();
};

init();

function init() {
  setToday();
  bindEvents();
  hydrateGoogleConfigInputs();
  renderAll();
  updateGoogleConnectionBadge();
  updateGoogleStatus(
    googleState.config.clientId && googleState.config.apiKey
      ? "連携設定は保存されています。Googleで接続すると対象日の予定を読み込めます。"
      : "未接続です。Client ID と API Key を保存してから Google で接続してください。"
  );
  registerServiceWorker();
  maybePrepareTokenClient();
}

function bindEvents() {
  $("fixedForm").addEventListener("submit", onAddFixedSchedule);
  $("eventForm").addEventListener("submit", onAddOneOffEvent);
  $("taskForm").addEventListener("submit", onAddTask);
  $("selectedDate").addEventListener("change", async () => {
    await onDateChanged();
  });
  $("sleepHours").addEventListener("input", saveCurrentConditionInputs);
  $("fatigue").addEventListener("input", saveCurrentConditionInputs);
  $("conditionNote").addEventListener("input", saveCurrentConditionInputs);
  $("generateBtn").addEventListener("click", generatePrompt);
  $("copyBtn").addEventListener("click", copyPrompt);
  $("exportBtn").addEventListener("click", exportData);
  $("importInput").addEventListener("change", importData);

  $("saveGoogleConfigBtn").addEventListener("click", onSaveGoogleConfig);
  $("clearGoogleConfigBtn").addEventListener("click", onClearGoogleConfig);
  $("connectGoogleBtn").addEventListener("click", onConnectGoogle);
  $("disconnectGoogleBtn").addEventListener("click", onDisconnectGoogle);
  $("reloadGoogleEventsBtn").addEventListener("click", async () => {
    await loadGoogleEventsForSelectedDate();
  });
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(INITIAL_STATE);
    const parsed = JSON.parse(raw);
    return {
      fixedSchedules: parsed.fixedSchedules || [],
      oneOffEvents: (parsed.oneOffEvents || []).map(normalizeOneOffEvent),
      tasks: parsed.tasks || [],
      dayConditions: parsed.dayConditions || {}
    };
  } catch {
    return structuredClone(INITIAL_STATE);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizeOneOffEvent(item) {
  return {
    id: item.id || crypto.randomUUID(),
    title: item.title || "",
    date: item.date || "",
    start: item.start || "",
    end: item.end || "",
    note: item.note || "",
    googleEventId: item.googleEventId || "",
    googleSyncStatus: item.googleSyncStatus || (item.googleEventId ? "synced" : "local")
  };
}

function loadGoogleConfig() {
  try {
    const raw = localStorage.getItem(GOOGLE_CONFIG_KEY);
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

function saveGoogleConfig(config) {
  localStorage.setItem(GOOGLE_CONFIG_KEY, JSON.stringify(config));
}

function hydrateGoogleConfigInputs() {
  $("googleClientId").value = googleState.config.clientId || "";
  $("googleApiKey").value = googleState.config.apiKey || "";
}

async function maybeInitializeGoogleClient() {
  if (!googleState.gapiLibraryLoaded) return;
  if (!googleState.config.apiKey) {
    googleState.gapiReady = false;
    return;
  }

  try {
    await gapi.client.init({
      apiKey: googleState.config.apiKey,
      discoveryDocs: [DISCOVERY_DOC]
    });
    googleState.gapiReady = true;
    updateGoogleStatus(
      hasValidGoogleToken()
        ? "Google Calendar に接続中です。"
        : "Google API の準備ができました。Googleで接続してください。",
      hasValidGoogleToken() ? "ok" : ""
    );
  } catch (error) {
    googleState.gapiReady = false;
    updateGoogleStatus(`Google API 初期化に失敗しました: ${getErrorMessage(error)}`, "warn");
  }
}

function maybePrepareTokenClient() {
  if (!googleState.gisReady) return;
  if (!googleState.config.clientId) return;

  googleState.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: googleState.config.clientId,
    scope: SCOPES,
    callback: ""
  });
}

function setToday() {
  const today = formatDateInput(new Date());
  $("selectedDate").value = today;
  loadConditionInputsForDate(today);
  const eventDateInput = document.querySelector('#eventForm input[name="date"]');
  if (eventDateInput) eventDateInput.value = today;
}

async function onDateChanged() {
  const date = $("selectedDate").value;
  loadConditionInputsForDate(date);

  const eventDateInput = document.querySelector('#eventForm input[name="date"]');
  if (eventDateInput) eventDateInput.value = date;

  if (hasValidGoogleToken()) {
    await loadGoogleEventsForDate(date, { silent: true });
  } else {
    renderGoogleEventList();
    renderSummaries();
  }
}

function saveCurrentConditionInputs() {
  const date = $("selectedDate").value;
  if (!date) return;
  state.dayConditions[date] = {
    sleepHours: $("sleepHours").value,
    fatigue: $("fatigue").value,
    note: $("conditionNote").value.trim()
  };
  saveState();
}

function loadConditionInputsForDate(date) {
  const data = state.dayConditions[date] || { sleepHours: "", fatigue: "", note: "" };
  $("sleepHours").value = data.sleepHours || "";
  $("fatigue").value = data.fatigue || "";
  $("conditionNote").value = data.note || "";
}

function onAddFixedSchedule(e) {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  state.fixedSchedules.push({
    id: crypto.randomUUID(),
    title: String(fd.get("title")).trim(),
    weekday: Number(fd.get("weekday")),
    start: String(fd.get("start")),
    end: String(fd.get("end")),
    note: String(fd.get("note")).trim()
  });
  saveState();
  e.currentTarget.reset();
  renderAll();
}

async function onAddOneOffEvent(e) {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const eventItem = normalizeOneOffEvent({
    id: crypto.randomUUID(),
    title: String(fd.get("title")).trim(),
    date: String(fd.get("date")),
    start: String(fd.get("start") || ""),
    end: String(fd.get("end") || ""),
    note: String(fd.get("note")).trim()
  });

  const shouldSyncToGoogle = Boolean(fd.get("syncToGoogle"));

  if (shouldSyncToGoogle) {
    if (hasValidGoogleToken()) {
      try {
        const created = await createGoogleEventFromLocal(eventItem);
        eventItem.googleEventId = created.id;
        eventItem.googleSyncStatus = "synced";
        cacheGoogleEvent(created, eventItem.date);
        updateGoogleStatus("Google Calendar にも予定を追加しました。", "ok");
      } catch (error) {
        eventItem.googleSyncStatus = "failed";
        updateGoogleStatus(`Google への追加に失敗しました。ローカル保存のみ行います: ${getErrorMessage(error)}`, "warn");
      }
    } else {
      eventItem.googleSyncStatus = "pending";
      updateGoogleStatus("Google未接続のため、ローカル保存のみ行いました。あとで『Google追加』から同期できます。", "warn");
    }
  }

  state.oneOffEvents.push(eventItem);
  saveState();
  e.currentTarget.reset();

  const eventDateInput = document.querySelector('#eventForm input[name="date"]');
  if (eventDateInput) eventDateInput.value = $("selectedDate").value;
  $("syncEventToGoogle").checked = true;

  renderAll();

  if (hasValidGoogleToken() && $("selectedDate").value === eventItem.date) {
    await loadGoogleEventsForDate(eventItem.date, { silent: true });
  }
}

function onAddTask(e) {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  state.tasks.push({
    id: crypto.randomUUID(),
    title: String(fd.get("title")).trim(),
    category: String(fd.get("category")).trim(),
    deadlineDate: String(fd.get("deadlineDate") || ""),
    deadlineTime: String(fd.get("deadlineTime") || ""),
    estimate: String(fd.get("estimate") || ""),
    priority: String(fd.get("priority") || "中"),
    note: String(fd.get("note")).trim(),
    status: "未着手"
  });
  saveState();
  e.currentTarget.reset();
  renderAll();
}

function renderAll() {
  renderFixedSchedules();
  renderOneOffEvents();
  renderTasks();
  renderGoogleEventList();
  renderSummaries();
  updateGoogleConnectionBadge();
}

function renderFixedSchedules() {
  const wrap = $("fixedList");
  wrap.innerHTML = "";
  const items = [...state.fixedSchedules].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
  if (!items.length) {
    wrap.className = "list-wrap empty";
    wrap.textContent = "まだありません";
    return;
  }
  wrap.className = "list-wrap";
  items.forEach((item) => {
    wrap.appendChild(createListItem({
      title: `${weekdayNames[item.weekday]} ${item.start} - ${item.end} / ${item.title}`,
      meta: "毎週固定",
      note: item.note,
      actions: [
        makeDeleteButton(() => {
          state.fixedSchedules = state.fixedSchedules.filter((x) => x.id !== item.id);
          saveState();
          renderAll();
        })
      ]
    }));
  });
}

function renderOneOffEvents() {
  const wrap = $("eventList");
  wrap.innerHTML = "";
  const items = [...state.oneOffEvents].sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
  if (!items.length) {
    wrap.className = "list-wrap empty";
    wrap.textContent = "まだありません";
    return;
  }
  wrap.className = "list-wrap";
  items.forEach((item) => {
    const timeLabel = item.start ? `${item.start}${item.end ? ` - ${item.end}` : ""}` : "時刻未設定";
    const syncLabel = getLocalEventSyncLabel(item);
    const actions = [];

    if (hasValidGoogleToken() && !item.googleEventId) {
      actions.push(makeActionButton(item.googleSyncStatus === "failed" ? "Google再送" : "Google追加", async () => {
        await syncLocalEventToGoogle(item.id);
      }));
    }

    actions.push(makeDeleteButton(async () => {
      await deleteLocalEvent(item.id);
    }));

    wrap.appendChild(createListItem({
      title: `${item.date} / ${item.title}`,
      meta: `${timeLabel} / ${syncLabel}`,
      note: item.note,
      actions
    }));
  });
}

function getLocalEventSyncLabel(item) {
  if (item.googleEventId) return "Google同期済";
  if (item.googleSyncStatus === "failed") return "Google同期失敗";
  if (item.googleSyncStatus === "pending") return "Google未同期";
  return "ローカルのみ";
}

function renderTasks() {
  const wrap = $("taskList");
  wrap.innerHTML = "";
  const order = { "高": 0, "中": 1, "低": 2 };
  const statusRank = { "未着手": 0, "進行中": 1, "完了": 2 };
  const items = [...state.tasks].sort((a, b) => {
    if (statusRank[a.status] !== statusRank[b.status]) return statusRank[a.status] - statusRank[b.status];
    const deadlineA = `${a.deadlineDate || "9999-99-99"} ${a.deadlineTime || "99:99"}`;
    const deadlineB = `${b.deadlineDate || "9999-99-99"} ${b.deadlineTime || "99:99"}`;
    if (deadlineA !== deadlineB) return deadlineA.localeCompare(deadlineB);
    return order[a.priority] - order[b.priority];
  });

  if (!items.length) {
    wrap.className = "list-wrap empty";
    wrap.textContent = "まだありません";
    return;
  }
  wrap.className = "list-wrap";
  items.forEach((item) => {
    const actions = [];
    const statusSelect = document.createElement("select");
    statusSelect.className = "status-select";
    ["未着手", "進行中", "完了"].forEach((status) => {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = status;
      if (status === item.status) option.selected = true;
      statusSelect.appendChild(option);
    });
    statusSelect.addEventListener("change", () => {
      const target = state.tasks.find((x) => x.id === item.id);
      target.status = statusSelect.value;
      saveState();
      renderAll();
    });
    actions.push(statusSelect);
    actions.push(makeDeleteButton(() => {
      state.tasks = state.tasks.filter((x) => x.id !== item.id);
      saveState();
      renderAll();
    }));

    const deadlineText = item.deadlineDate
      ? `${item.deadlineDate}${item.deadlineTime ? ` ${item.deadlineTime}` : ""}`
      : "締切未設定";
    const meta = [item.category || "分類なし", `優先度:${item.priority}`, `見積:${item.estimate || "?"}分`, `締切:${deadlineText}`, `状態:${item.status}`].join(" / ");

    wrap.appendChild(createListItem({
      title: item.title,
      meta,
      note: item.note,
      actions
    }));
  });
}

function renderGoogleEventList() {
  const wrap = $("googleEventList");
  wrap.innerHTML = "";

  const date = $("selectedDate").value;
  const events = getCachedGoogleEvents(date);

  if (!hasValidGoogleToken()) {
    wrap.className = "list-wrap empty";
    wrap.textContent = "Google未接続です";
    return;
  }

  if (!events.length) {
    wrap.className = "list-wrap empty";
    wrap.textContent = "まだありません";
    return;
  }

  wrap.className = "list-wrap";
  events.forEach((event) => {
    wrap.appendChild(createListItem({
      title: event.summary || "タイトルなし",
      meta: `Google Calendar / ${formatGoogleEventTime(event)}`,
      note: event.description || "",
      actions: [
        makeDeleteButton(async () => {
          if (!confirm("Googleカレンダーからこの予定を削除します。よろしいですか？")) return;
          await deleteGoogleEventById(event.id, { removeLocalMirror: true });
        })
      ]
    }));
  });
}

function renderSummaries() {
  const selectedDate = $("selectedDate").value;
  const schedules = getSchedulesForDate(selectedDate);
  const deadlines = getUpcomingTasks(selectedDate, 48);
  const pending = getPendingTasks();
  const freeSlots = computeFreeSlots(schedules);

  fillSummary($("dayScheduleSummary"), schedules.length
    ? schedules.map((item) => `${formatScheduleLine(item)}`)
    : []);
  fillSummary($("deadlineSummary"), deadlines.length
    ? deadlines.map((task) => `${task.title} / ${task.deadlineDate}${task.deadlineTime ? ` ${task.deadlineTime}` : ""} / 優先度:${task.priority}`)
    : []);
  fillSummary($("pendingSummary"), pending.length
    ? pending.slice(0, 8).map((task) => `${task.title} / ${task.category || "分類なし"} / ${task.status}`)
    : []);
  fillSummary($("freeTimeSummary"), freeSlots.length
    ? freeSlots.map((slot) => `${slot.start} - ${slot.end} (${slot.minutes}分)`)
    : []);
}

function fillSummary(container, lines) {
  container.innerHTML = "";
  if (!lines.length) {
    container.className = "summary-list empty";
    container.textContent = "まだありません";
    return;
  }
  container.className = "summary-list";
  lines.forEach((line) => {
    const div = document.createElement("div");
    div.className = "summary-chip";
    div.textContent = line;
    container.appendChild(div);
  });
}

function getSchedulesForDate(dateStr) {
  if (!dateStr) return [];
  const dateObj = new Date(`${dateStr}T00:00:00`);
  const weekday = dateObj.getDay();
  const fixed = state.fixedSchedules
    .filter((item) => item.weekday === weekday)
    .map((item) => ({ ...item, type: "fixed", date: dateStr }));

  const oneOff = state.oneOffEvents
    .filter((item) => item.date === dateStr)
    .map((item) => ({ ...item, type: "event" }));

  const syncedIds = new Set(oneOff.map((item) => item.googleEventId).filter(Boolean));
  const googleSchedules = getCachedGoogleEvents(dateStr)
    .filter((event) => !syncedIds.has(event.id))
    .map((event) => mapGoogleEventToSchedule(event, dateStr));

  return [...fixed, ...oneOff, ...googleSchedules].sort(compareSchedule);
}

function getCachedGoogleEvents(dateStr) {
  return googleState.eventsByDate[dateStr] || [];
}

function mapGoogleEventToSchedule(event, fallbackDate) {
  const isAllDay = Boolean(event.start?.date && !event.start?.dateTime);

  if (isAllDay) {
    return {
      id: event.id,
      title: event.summary || "Google予定",
      start: "",
      end: "",
      note: event.description ? `Google / ${event.description}` : "Google Calendar",
      type: "google",
      source: "google",
      allDay: true,
      date: event.start?.date || fallbackDate
    };
  }

  const startDate = new Date(event.start?.dateTime || event.start?.date || `${fallbackDate}T00:00:00`);
  const endDate = event.end?.dateTime ? new Date(event.end.dateTime) : null;

  return {
    id: event.id,
    title: event.summary || "Google予定",
    start: formatTimeOnly(startDate),
    end: endDate ? formatTimeOnly(endDate) : "",
    note: event.description ? `Google / ${event.description}` : "Google Calendar",
    type: "google",
    source: "google",
    allDay: false,
    date: formatDateInput(startDate)
  };
}

function getUpcomingTasks(dateStr, hours = 48) {
  const start = new Date(`${dateStr}T00:00:00`);
  const end = new Date(start.getTime() + hours * 60 * 60 * 1000);
  return state.tasks
    .filter((task) => task.status !== "完了" && task.deadlineDate)
    .filter((task) => {
      const taskDate = new Date(`${task.deadlineDate}T${task.deadlineTime || "23:59"}:00`);
      return taskDate >= start && taskDate <= end;
    })
    .sort((a, b) => (`${a.deadlineDate}${a.deadlineTime}`).localeCompare(`${b.deadlineDate}${b.deadlineTime}`));
}

function getPendingTasks() {
  return state.tasks.filter((task) => task.status !== "完了");
}

function compareSchedule(a, b) {
  const allDayRankA = a.allDay ? 0 : 1;
  const allDayRankB = b.allDay ? 0 : 1;
  if (allDayRankA !== allDayRankB) return allDayRankA - allDayRankB;

  const aKey = `${a.start || "99:99"}${a.title}`;
  const bKey = `${b.start || "99:99"}${b.title}`;
  return aKey.localeCompare(bKey);
}

function formatScheduleLine(item) {
  if (item.allDay) {
    return `終日 / ${item.title}${item.note ? ` / ${item.note}` : ""}`;
  }
  const time = item.start ? `${item.start}${item.end ? ` - ${item.end}` : ""}` : "時刻未設定";
  const note = item.note ? ` / ${item.note}` : "";
  return `${time} / ${item.title}${note}`;
}

function computeFreeSlots(schedules) {
  const baseStart = toMinutes("06:00");
  const baseEnd = toMinutes("24:00");
  const blocks = schedules
    .filter((item) => !item.allDay && item.start && item.end)
    .map((item) => ({ start: toMinutes(item.start), end: toMinutes(item.end) }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const block of blocks) {
    if (!merged.length || block.start > merged[merged.length - 1].end) {
      merged.push({ ...block });
    } else {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, block.end);
    }
  }

  const free = [];
  let cursor = baseStart;
  for (const block of merged) {
    if (block.start > cursor) {
      free.push(makeSlot(cursor, block.start));
    }
    cursor = Math.max(cursor, block.end);
  }
  if (cursor < baseEnd) free.push(makeSlot(cursor, baseEnd));
  return free.filter((slot) => slot.minutes >= 20);
}

function makeSlot(start, end) {
  return {
    start: fromMinutes(start),
    end: fromMinutes(end),
    minutes: end - start
  };
}

function generatePrompt() {
  saveCurrentConditionInputs();
  const selectedDate = $("selectedDate").value;
  const dayData = state.dayConditions[selectedDate] || {};
  const schedules = getSchedulesForDate(selectedDate);
  const deadlines = getUpcomingTasks(selectedDate, 48);
  const pending = getPendingTasks();
  const freeSlots = computeFreeSlots(schedules);

  const text = [
    "今日の1日を設計して。",
    `日付：${selectedDate} (${weekdayNames[new Date(`${selectedDate}T00:00:00`).getDay()]})`,
    `睡眠・体調：睡眠 ${dayData.sleepHours || "未入力"} 時間 / 体力 ${dayData.fatigue || "未入力"} / メモ ${dayData.note || "なし"}`,
    "固定予定・単発予定：",
    schedules.length ? schedules.map((item) => `- ${formatScheduleLine(item)}`).join("\n") : "- なし",
    "48時間以内の締切：",
    deadlines.length
      ? deadlines.map((task) => `- ${task.title} / ${task.deadlineDate}${task.deadlineTime ? ` ${task.deadlineTime}` : ""} / 優先度:${task.priority} / 見積:${task.estimate || "?"}分 / ${task.note || "メモなし"}`).join("\n")
      : "- なし",
    "未完了タスク：",
    pending.length
      ? pending.map((task) => `- ${task.title} / ${task.category || "分類なし"} / 状態:${task.status} / 優先度:${task.priority} / 見積:${task.estimate || "?"}分 / 締切:${task.deadlineDate || "未設定"}${task.deadlineTime ? ` ${task.deadlineTime}` : ""}${task.note ? ` / ${task.note}` : ""}`).join("\n")
      : "- なし",
    "空き時間候補：",
    freeSlots.length
      ? freeSlots.map((slot) => `- ${slot.start} - ${slot.end} (${slot.minutes}分)`).join("\n")
      : "- ほぼなし",
    "出力形式：",
    "1. 今日の最優先3件",
    "2. 時間ブロック化した1日設計",
    "3. 今やらないこと",
    "4. 詰まった時の代替案",
    "5. 夜の締め条件"
  ].join("\n");

  $("promptOutput").value = text;
}

async function copyPrompt() {
  const textarea = $("promptOutput");
  if (!textarea.value.trim()) generatePrompt();
  try {
    await navigator.clipboard.writeText(textarea.value);
    alert("コピーしました");
  } catch {
    textarea.select();
    document.execCommand("copy");
    alert("コピーしました");
  }
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `day-manager-backup-${formatDateInput(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      state.fixedSchedules = parsed.fixedSchedules || [];
      state.oneOffEvents = (parsed.oneOffEvents || []).map(normalizeOneOffEvent);
      state.tasks = parsed.tasks || [];
      state.dayConditions = parsed.dayConditions || {};
      saveState();
      loadConditionInputsForDate($("selectedDate").value);
      renderAll();
      alert("バックアップを読み込みました");
    } catch {
      alert("JSONの読み込みに失敗しました");
    }
  };
  reader.readAsText(file, "utf-8");
  e.target.value = "";
}

function createListItem({ title, meta, note, actions }) {
  const tpl = $("listItemTemplate").content.cloneNode(true);
  tpl.querySelector(".item-title").textContent = title;
  tpl.querySelector(".item-meta").textContent = meta || "";
  tpl.querySelector(".item-note").textContent = note || "";
  const actionWrap = tpl.querySelector(".list-actions");
  (actions || []).forEach((el) => actionWrap.appendChild(el));
  return tpl;
}

function makeDeleteButton(onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mini-btn";
  btn.textContent = "削除";
  btn.addEventListener("click", onClick);
  return btn;
}

function makeActionButton(label, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function toMinutes(timeStr) {
  if (!timeStr) return NaN;
  const [h, m] = timeStr.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

function fromMinutes(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatTimeOnly(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

async function onSaveGoogleConfig() {
  googleState.config = {
    clientId: $("googleClientId").value.trim(),
    apiKey: $("googleApiKey").value.trim()
  };

  if (!googleState.config.clientId || !googleState.config.apiKey) {
    updateGoogleStatus("Client ID と API Key の両方を入力してください。", "warn");
    return;
  }

  saveGoogleConfig(googleState.config);
  maybePrepareTokenClient();
  await maybeInitializeGoogleClient();
  updateGoogleConnectionBadge();
}

function onClearGoogleConfig() {
  localStorage.removeItem(GOOGLE_CONFIG_KEY);
  googleState.config = { clientId: "", apiKey: "" };
  googleState.tokenClient = null;
  googleState.gapiReady = false;
  googleState.eventsByDate = {};
  hydrateGoogleConfigInputs();

  if (gapi?.client?.setToken) {
    gapi.client.setToken("");
  }

  updateGoogleStatus("保存済みの連携設定を削除しました。", "");
  renderAll();
}

function onConnectGoogle() {
  if (!googleState.config.clientId || !googleState.config.apiKey) {
    updateGoogleStatus("先に Client ID と API Key を保存してください。", "warn");
    return;
  }
  if (!googleState.gapiReady) {
    updateGoogleStatus("Google API の初期化がまだ終わっていません。設定保存後に少し待ってから再試行してください。", "warn");
    return;
  }
  if (!googleState.tokenClient) {
    maybePrepareTokenClient();
    if (!googleState.tokenClient) {
      updateGoogleStatus("OAuth クライアントを準備できませんでした。Client ID を確認してください。", "warn");
      return;
    }
  }

  googleState.tokenClient.callback = async (response) => {
    if (response.error) {
      updateGoogleStatus(`Google接続に失敗しました: ${response.error}`, "warn");
      return;
    }
    updateGoogleStatus("Google Calendar に接続しました。対象日の予定を読み込みます。", "ok");
    updateGoogleConnectionBadge();
    await loadGoogleEventsForSelectedDate();
  };

  const currentToken = gapi.client.getToken();
  if (!currentToken) {
    googleState.tokenClient.requestAccessToken({ prompt: "consent" });
  } else {
    googleState.tokenClient.requestAccessToken({ prompt: "" });
  }
}

function onDisconnectGoogle() {
  const token = gapi?.client?.getToken();
  if (token?.access_token) {
    google.accounts.oauth2.revoke(token.access_token);
    gapi.client.setToken("");
  }
  googleState.eventsByDate = {};
  updateGoogleStatus("Google との接続を解除しました。", "");
  renderAll();
}

async function loadGoogleEventsForSelectedDate() {
  await loadGoogleEventsForDate($("selectedDate").value);
}

async function loadGoogleEventsForDate(dateStr, { silent = false } = {}) {
  if (!hasValidGoogleToken()) {
    renderGoogleEventList();
    renderSummaries();
    if (!silent) updateGoogleStatus("先に Google で接続してください。", "warn");
    return [];
  }

  if (!dateStr) {
    if (!silent) updateGoogleStatus("対象日を選んでください。", "warn");
    return [];
  }

  try {
    if (!silent) updateGoogleStatus("Google予定を読み込んでいます...", "");
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
    renderGoogleEventList();
    renderSummaries();

    if (!silent) {
      updateGoogleStatus(`${googleState.eventsByDate[dateStr].length} 件の Google 予定を読み込みました。`, "ok");
    }
    return googleState.eventsByDate[dateStr];
  } catch (error) {
    if (!silent) {
      updateGoogleStatus(`Google予定の読込に失敗しました: ${getErrorMessage(error)}`, "warn");
    }
    return [];
  }
}

function updateGoogleStatus(message, variant = "") {
  const box = $("googleStatusBox");
  if (!box) return;
  box.textContent = message;
  box.className = "calendar-status";
  if (variant) box.classList.add(variant);
}

function updateGoogleConnectionBadge() {
  const badge = $("googleConnectionBadge");
  if (!badge) return;

  badge.className = "calendar-badge";
  if (hasValidGoogleToken()) {
    badge.textContent = "接続中";
    badge.classList.add("connected");
  } else if (googleState.config.clientId && googleState.config.apiKey) {
    badge.textContent = "設定済み";
  } else {
    badge.textContent = "未接続";
  }
}

function hasValidGoogleToken() {
  return Boolean(gapi?.client?.getToken()?.access_token);
}

async function createGoogleEventFromLocal(localEvent) {
  if (!hasValidGoogleToken()) {
    throw new Error("Google に接続していません");
  }

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const resource = {
    summary: localEvent.title,
    description: localEvent.note || ""
  };

  if (localEvent.start && localEvent.end) {
    resource.start = {
      dateTime: `${localEvent.date}T${localEvent.start}:00`,
      timeZone
    };
    resource.end = {
      dateTime: `${localEvent.date}T${localEvent.end}:00`,
      timeZone
    };
  } else {
    resource.start = { date: localEvent.date };
    resource.end = { date: addDays(localEvent.date, 1) };
  }

  const response = await gapi.client.calendar.events.insert({
    calendarId: "primary",
    resource
  });

  return response.result;
}

async function syncLocalEventToGoogle(localEventId) {
  const item = state.oneOffEvents.find((event) => event.id === localEventId);
  if (!item) return;

  if (!hasValidGoogleToken()) {
    updateGoogleStatus("Google に接続してから『Google追加』を押してください。", "warn");
    return;
  }

  try {
    updateGoogleStatus("ローカル予定を Google Calendar に追加しています...", "");
    const created = await createGoogleEventFromLocal(item);
    item.googleEventId = created.id;
    item.googleSyncStatus = "synced";
    saveState();
    cacheGoogleEvent(created, item.date);
    renderAll();
    updateGoogleStatus("Google Calendar に追加しました。", "ok");
  } catch (error) {
    item.googleSyncStatus = "failed";
    saveState();
    renderAll();
    updateGoogleStatus(`Google Calendar への追加に失敗しました: ${getErrorMessage(error)}`, "warn");
  }
}

function cacheGoogleEvent(event, dateStr) {
  const targetDate = dateStr || event.start?.date || formatDateInput(new Date(event.start?.dateTime || new Date()));
  const list = getCachedGoogleEvents(targetDate).filter((item) => item.id !== event.id);
  list.push(event);
  list.sort((a, b) => formatGoogleEventTime(a).localeCompare(formatGoogleEventTime(b)));
  googleState.eventsByDate[targetDate] = list;
}

async function deleteLocalEvent(localEventId) {
  const item = state.oneOffEvents.find((event) => event.id === localEventId);
  if (!item) return;

  if (item.googleEventId) {
    if (hasValidGoogleToken()) {
      try {
        await deleteGoogleEventById(item.googleEventId, { removeLocalMirror: false, silent: true });
      } catch (error) {
        const proceed = confirm(`Google 側の削除に失敗しました。ローカルだけ削除しますか？\n\n${getErrorMessage(error)}`);
        if (!proceed) return;
      }
    } else {
      const proceed = confirm("この予定は Google Calendar と同期されています。現在は未接続なので、ローカルだけ削除されます。続けますか？");
      if (!proceed) return;
    }
  }

  state.oneOffEvents = state.oneOffEvents.filter((event) => event.id !== localEventId);
  saveState();
  renderAll();
}

async function deleteGoogleEventById(eventId, { removeLocalMirror = true, silent = false } = {}) {
  if (!hasValidGoogleToken()) {
    throw new Error("Google に接続していません");
  }

  await gapi.client.calendar.events.delete({
    calendarId: "primary",
    eventId
  });

  Object.keys(googleState.eventsByDate).forEach((dateKey) => {
    googleState.eventsByDate[dateKey] = googleState.eventsByDate[dateKey].filter((event) => event.id !== eventId);
  });

  if (removeLocalMirror) {
    state.oneOffEvents = state.oneOffEvents.filter((event) => event.googleEventId !== eventId);
    saveState();
  }

  renderAll();

  if (!silent) {
    updateGoogleStatus("Google Calendar の予定を削除しました。", "ok");
  }
}

function formatGoogleEventTime(event) {
  if (event.start?.date && !event.start?.dateTime) {
    return `${event.start.date} / 終日`;
  }
  const start = event.start?.dateTime ? new Date(event.start.dateTime) : null;
  const end = event.end?.dateTime ? new Date(event.end.dateTime) : null;
  if (!start) return "時刻不明";
  const startText = `${formatDateInput(start)} ${formatTimeOnly(start)}`;
  const endText = end ? formatTimeOnly(end) : "--:--";
  return `${startText} - ${endText}`;
}

function getErrorMessage(error) {
  return error?.result?.error?.message || error?.message || String(error);
}

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00`);
  date.setDate(date.getDate() + days);
  return formatDateInput(date);
}
