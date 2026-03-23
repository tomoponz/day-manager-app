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

  if (googleState.config.clientId && googleState.config.apiKey) {
    updateGoogleStatus("連携設定は保存されています。Googleで接続すると対象日の予定を読み込めます。");
  } else {
    updateGoogleStatus("未接続です。Client ID と API Key を保存してから Google で接続してください。");
  }

  registerServiceWorker();
  maybePrepareTokenClient();
}

function bindEvents() {
  $("fixedForm").addEventListener("submit", onSubmitFixedSchedule);
  $("eventForm").addEventListener("submit", onSubmitOneOffEvent);
  $("taskForm").addEventListener("submit", onSubmitTask);

  $("fixedCancelBtn").addEventListener("click", resetFixedForm);
  $("eventCancelBtn").addEventListener("click", resetEventForm);
  $("taskCancelBtn").addEventListener("click", resetTaskForm);

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

  $("eventAllDay").addEventListener("change", toggleEventTimeInputs);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(INITIAL_STATE);
    const parsed = JSON.parse(raw);
    return {
      fixedSchedules: (parsed.fixedSchedules || []).map(normalizeFixedSchedule),
      oneOffEvents: (parsed.oneOffEvents || []).map(normalizeOneOffEvent),
      tasks: (parsed.tasks || []).map(normalizeTask),
      dayConditions: parsed.dayConditions || {}
    };
  } catch {
    return structuredClone(INITIAL_STATE);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizeFixedSchedule(item) {
  return {
    id: item.id || crypto.randomUUID(),
    title: item.title || "",
    weekday: Number(item.weekday ?? 0),
    start: item.start || "",
    end: item.end || "",
    note: item.note || ""
  };
}

function normalizeOneOffEvent(item) {
  return {
    id: item.id || crypto.randomUUID(),
    title: item.title || "",
    date: item.date || "",
    start: item.start || "",
    end: item.end || "",
    note: item.note || "",
    allDay: Boolean(item.allDay),
    googleEventId: item.googleEventId || "",
    googleSyncStatus: item.googleSyncStatus || (item.googleEventId ? "synced" : "local")
  };
}

function normalizeTask(item) {
  return {
    id: item.id || crypto.randomUUID(),
    title: item.title || "",
    category: item.category || "",
    deadlineDate: item.deadlineDate || "",
    deadlineTime: item.deadlineTime || "",
    estimate: item.estimate || "",
    priority: item.priority || "中",
    importance: item.importance || "できれば",
    note: item.note || "",
    status: item.status || "未着手"
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
  if (eventDateInput && !getFormValue("eventForm", "editId")) {
    eventDateInput.value = date;
  }

  if (hasValidGoogleToken()) {
    await loadGoogleEventsForDate(date, { silent: true });
  } else {
    renderGoogleEventList();
    renderSummaries();
    renderAutoPlan();
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
  renderAutoPlan();
}

function loadConditionInputsForDate(date) {
  const data = state.dayConditions[date] || { sleepHours: "", fatigue: "", note: "" };
  $("sleepHours").value = data.sleepHours || "";
  $("fatigue").value = data.fatigue || "";
  $("conditionNote").value = data.note || "";
}

function onSubmitFixedSchedule(e) {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const payload = normalizeFixedSchedule({
    id: String(fd.get("editId") || "") || crypto.randomUUID(),
    title: String(fd.get("title")).trim(),
    weekday: Number(fd.get("weekday")),
    start: String(fd.get("start")),
    end: String(fd.get("end")),
    note: String(fd.get("note")).trim()
  });

  if (!payload.title) {
    alert("タイトルを入力してください。");
    return;
  }
  if (!isValidTimeRange(payload.start, payload.end)) {
    alert("固定予定は開始時刻より後の終了時刻を設定してください。");
    return;
  }

  const editingId = String(fd.get("editId") || "");
  if (editingId) {
    const target = state.fixedSchedules.find((item) => item.id === editingId);
    if (!target) return;
    Object.assign(target, payload);
  } else {
    state.fixedSchedules.push(payload);
  }

  saveState();
  resetFixedForm();
  renderAll();
}

async function onSubmitOneOffEvent(e) {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const editingId = String(fd.get("editId") || "");
  const allDay = Boolean(fd.get("allDay"));

  const payload = normalizeOneOffEvent({
    id: editingId || crypto.randomUUID(),
    title: String(fd.get("title")).trim(),
    date: String(fd.get("date")),
    start: allDay ? "" : String(fd.get("start") || ""),
    end: allDay ? "" : String(fd.get("end") || ""),
    note: String(fd.get("note")).trim(),
    allDay
  });

  if (!payload.title || !payload.date) {
    alert("タイトルと日付を入力してください。");
    return;
  }

  if (!payload.allDay && payload.start && payload.end && !isValidTimeRange(payload.start, payload.end)) {
    alert("単発予定は開始時刻より後の終了時刻を設定してください。");
    return;
  }

  const shouldSyncToGoogle = Boolean(fd.get("syncToGoogle"));
  let target = editingId
    ? state.oneOffEvents.find((item) => item.id === editingId)
    : null;

  if (target) {
    Object.assign(target, payload);
    if (target.googleEventId) {
      if (hasValidGoogleToken()) {
        try {
          await updateGoogleEventFromLocal(target);
          target.googleSyncStatus = "synced";
          updateGoogleStatus("Google Calendar の予定も更新しました。", "ok");
        } catch (error) {
          target.googleSyncStatus = "outdated";
          updateGoogleStatus(`Google 側の更新に失敗しました。あとで『Google更新』を押してください: ${getErrorMessage(error)}`, "warn");
        }
      } else {
        target.googleSyncStatus = "outdated";
        updateGoogleStatus("Google未接続のため、ローカルだけ更新しました。あとで『Google更新』を押してください。", "warn");
      }
    } else if (shouldSyncToGoogle) {
      await tryCreateGoogleForLocalEvent(target);
    }
  } else {
    target = payload;
    if (shouldSyncToGoogle) {
      if (hasValidGoogleToken()) {
        await tryCreateGoogleForLocalEvent(target);
      } else {
        target.googleSyncStatus = "pending";
        updateGoogleStatus("Google未接続のため、ローカル保存のみ行いました。あとで『Google追加』から同期できます。", "warn");
      }
    }
    state.oneOffEvents.push(target);
  }

  saveState();
  resetEventForm();
  renderAll();

  if (hasValidGoogleToken() && $("selectedDate").value === payload.date) {
    await loadGoogleEventsForDate(payload.date, { silent: true });
  }
}

async function tryCreateGoogleForLocalEvent(localEvent) {
  try {
    const created = await createGoogleEventFromLocal(localEvent);
    localEvent.googleEventId = created.id;
    localEvent.googleSyncStatus = "synced";
    cacheGoogleEvent(created, localEvent.date);
    updateGoogleStatus("Google Calendar にも予定を追加しました。", "ok");
  } catch (error) {
    localEvent.googleSyncStatus = "failed";
    updateGoogleStatus(`Google への追加に失敗しました。ローカル保存のみ行います: ${getErrorMessage(error)}`, "warn");
  }
}

function onSubmitTask(e) {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const editingId = String(fd.get("editId") || "");
  const payload = normalizeTask({
    id: editingId || crypto.randomUUID(),
    title: String(fd.get("title")).trim(),
    category: String(fd.get("category")).trim(),
    deadlineDate: String(fd.get("deadlineDate") || ""),
    deadlineTime: String(fd.get("deadlineTime") || ""),
    estimate: String(fd.get("estimate") || ""),
    priority: String(fd.get("priority") || "中"),
    importance: String(fd.get("importance") || "できれば"),
    note: String(fd.get("note")).trim(),
    status: String(fd.get("status") || "未着手")
  });

  if (!payload.title) {
    alert("タスク名を入力してください。");
    return;
  }

  if (editingId) {
    const target = state.tasks.find((item) => item.id === editingId);
    if (!target) return;
    Object.assign(target, payload);
  } else {
    state.tasks.push(payload);
  }

  saveState();
  resetTaskForm();
  renderAll();
}

function resetFixedForm() {
  const form = $("fixedForm");
  form.reset();
  form.elements.editId.value = "";
  $("fixedSubmitBtn").textContent = "固定予定を追加";
  $("fixedCancelBtn").hidden = true;
}

function resetEventForm() {
  const form = $("eventForm");
  form.reset();
  form.elements.editId.value = "";
  $("eventSubmitBtn").textContent = "単発予定を追加";
  $("eventCancelBtn").hidden = true;
  form.elements.date.value = $("selectedDate").value;
  $("syncEventToGoogle").checked = true;
  $("eventAllDay").checked = false;
  toggleEventTimeInputs();
}

function resetTaskForm() {
  const form = $("taskForm");
  form.reset();
  form.elements.editId.value = "";
  form.elements.priority.value = "中";
  form.elements.importance.value = "できれば";
  form.elements.status.value = "未着手";
  $("taskSubmitBtn").textContent = "タスクを追加";
  $("taskCancelBtn").hidden = true;
}

function toggleEventTimeInputs() {
  const form = $("eventForm");
  const allDay = form.elements.allDay.checked;
  form.elements.start.disabled = allDay;
  form.elements.end.disabled = allDay;
  if (allDay) {
    form.elements.start.value = "";
    form.elements.end.value = "";
  }
}

function renderAll() {
  renderFixedSchedules();
  renderOneOffEvents();
  renderTasks();
  renderGoogleEventList();
  renderSummaries();
  renderAutoPlan();
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
        makeActionButton("編集", () => populateFixedForm(item.id)),
        makeActionButton("複製", () => duplicateFixedSchedule(item.id)),
        makeDeleteButton(() => {
          state.fixedSchedules = state.fixedSchedules.filter((x) => x.id !== item.id);
          saveState();
          renderAll();
        })
      ]
    }));
  });
}

function populateFixedForm(id) {
  const item = state.fixedSchedules.find((entry) => entry.id === id);
  if (!item) return;
  const form = $("fixedForm");
  form.elements.editId.value = item.id;
  form.elements.title.value = item.title;
  form.elements.weekday.value = String(item.weekday);
  form.elements.start.value = item.start;
  form.elements.end.value = item.end;
  form.elements.note.value = item.note;
  $("fixedSubmitBtn").textContent = "固定予定を更新";
  $("fixedCancelBtn").hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function duplicateFixedSchedule(id) {
  const item = state.fixedSchedules.find((entry) => entry.id === id);
  if (!item) return;
  state.fixedSchedules.push({
    ...item,
    id: crypto.randomUUID(),
    title: `${item.title} (複製)`
  });
  saveState();
  renderAll();
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
    const timeLabel = item.allDay
      ? "終日"
      : item.start ? `${item.start}${item.end ? ` - ${item.end}` : ""}` : "時刻未設定";
    const syncLabel = getLocalEventSyncLabel(item);
    const actions = [
      makeActionButton("編集", () => populateEventForm(item.id)),
      makeActionButton("複製", () => duplicateOneOffEvent(item.id))
    ];

    if (hasValidGoogleToken()) {
      if (!item.googleEventId) {
        actions.push(makeActionButton(item.googleSyncStatus === "failed" ? "Google再送" : "Google追加", async () => {
          await syncLocalEventToGoogle(item.id);
        }));
      } else if (item.googleSyncStatus === "outdated") {
        actions.push(makeActionButton("Google更新", async () => {
          await syncUpdatedLocalEventToGoogle(item.id);
        }));
      }
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
  if (item.googleEventId && item.googleSyncStatus === "outdated") return "Google要更新";
  if (item.googleEventId) return "Google同期済";
  if (item.googleSyncStatus === "failed") return "Google同期失敗";
  if (item.googleSyncStatus === "pending") return "Google未接続";
  return "ローカルのみ";
}

function populateEventForm(id) {
  const item = state.oneOffEvents.find((entry) => entry.id === id);
  if (!item) return;
  const form = $("eventForm");
  form.elements.editId.value = item.id;
  form.elements.title.value = item.title;
  form.elements.date.value = item.date;
  form.elements.allDay.checked = Boolean(item.allDay);
  form.elements.start.value = item.start;
  form.elements.end.value = item.end;
  form.elements.note.value = item.note;
  $("syncEventToGoogle").checked = item.googleSyncStatus !== "local";
  toggleEventTimeInputs();
  $("eventSubmitBtn").textContent = "単発予定を更新";
  $("eventCancelBtn").hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function duplicateOneOffEvent(id) {
  const item = state.oneOffEvents.find((entry) => entry.id === id);
  if (!item) return;
  state.oneOffEvents.push({
    ...item,
    id: crypto.randomUUID(),
    title: `${item.title} (複製)`,
    googleEventId: "",
    googleSyncStatus: "local"
  });
  saveState();
  renderAll();
}

function renderTasks() {
  const wrap = $("taskList");
  wrap.innerHTML = "";
  const order = { "高": 0, "中": 1, "低": 2 };
  const statusRank = { "未着手": 0, "進行中": 1, "完了": 2 };
  const importanceRank = { "必須": 0, "できれば": 1, "後回し": 2 };

  const items = [...state.tasks].sort((a, b) => {
    if (statusRank[a.status] !== statusRank[b.status]) return statusRank[a.status] - statusRank[b.status];
    if (importanceRank[a.importance] !== importanceRank[b.importance]) return importanceRank[a.importance] - importanceRank[b.importance];
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
    actions.push(makeActionButton("編集", () => populateTaskForm(item.id)));
    actions.push(makeActionButton("複製", () => duplicateTask(item.id)));
    actions.push(makeDeleteButton(() => {
      state.tasks = state.tasks.filter((x) => x.id !== item.id);
      saveState();
      renderAll();
    }));

    const deadlineText = item.deadlineDate
      ? `${item.deadlineDate}${item.deadlineTime ? ` ${item.deadlineTime}` : ""}`
      : "締切未設定";
    const meta = [
      item.category || "分類なし",
      `重要度:${item.importance}`,
      `優先度:${item.priority}`,
      `見積:${item.estimate || "?"}分`,
      `締切:${deadlineText}`,
      `状態:${item.status}`
    ].join(" / ");

    wrap.appendChild(createListItem({
      title: item.title,
      meta,
      note: item.note,
      actions
    }));
  });
}

function populateTaskForm(id) {
  const item = state.tasks.find((entry) => entry.id === id);
  if (!item) return;
  const form = $("taskForm");
  form.elements.editId.value = item.id;
  form.elements.title.value = item.title;
  form.elements.category.value = item.category;
  form.elements.deadlineDate.value = item.deadlineDate;
  form.elements.deadlineTime.value = item.deadlineTime;
  form.elements.estimate.value = item.estimate;
  form.elements.priority.value = item.priority;
  form.elements.importance.value = item.importance;
  form.elements.status.value = item.status;
  form.elements.note.value = item.note;
  $("taskSubmitBtn").textContent = "タスクを更新";
  $("taskCancelBtn").hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function duplicateTask(id) {
  const item = state.tasks.find((entry) => entry.id === id);
  if (!item) return;
  state.tasks.push({
    ...item,
    id: crypto.randomUUID(),
    title: `${item.title} (複製)`,
    status: "未着手"
  });
  saveState();
  renderAll();
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

function renderAutoPlan() {
  const date = $("selectedDate").value;
  const plan = buildAutoPlan(date);

  fillSummary($("autoTopThree"), plan.topThree);
  fillSummary($("autoTimeline"), plan.timeline);

  const note = $("autoPlanNote");
  note.textContent = plan.note;
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

function buildAutoPlan(dateStr) {
  const schedules = getSchedulesForDate(dateStr);
  const freeSlots = computeFreeSlots(schedules);
  const selectedDate = new Date(`${dateStr}T00:00:00`);
  const fatigue = Number($("fatigue").value || 5);

  const tasks = state.tasks
    .filter((task) => task.status !== "完了")
    .map((task) => ({
      ...task,
      remaining: Math.max(20, Number(task.estimate) || 60)
    }));

  if (!tasks.length) {
    return {
      topThree: [],
      timeline: [],
      note: "未完了タスクがないため、自動時間割候補はありません。"
    };
  }

  if (!freeSlots.length) {
    return {
      topThree: [],
      timeline: [],
      note: "空き時間がほぼないため、自動時間割候補は作れません。"
    };
  }

  const placements = [];

  for (const slot of freeSlots) {
    let cursor = toMinutes(slot.start);
    let remainingSlot = slot.minutes;
    let safety = 0;

    while (remainingSlot >= 20 && safety < 20) {
      safety += 1;

      const candidates = tasks
        .filter((task) => task.remaining > 0)
        .map((task) => ({
          task,
          score: scoreTask(task, selectedDate, remainingSlot, fatigue)
        }))
        .filter((entry) => entry.score > -999)
        .sort((a, b) => b.score - a.score);

      const chosen = candidates[0]?.task;
      if (!chosen) break;

      const allocation = Math.min(chosen.remaining, remainingSlot, chosen.remaining <= 120 ? chosen.remaining : Math.min(90, remainingSlot));
      if (allocation < 20) break;

      const start = fromMinutes(cursor);
      const end = fromMinutes(cursor + allocation);
      const partial = allocation < chosen.remaining;

      placements.push({
        taskId: chosen.id,
        label: `${start} - ${end} / ${chosen.title}${partial ? " (部分着手)" : ""}`,
        topLabel: `${chosen.title} / ${chosen.importance} / 優先度:${chosen.priority}`,
        allocation
      });

      chosen.remaining -= allocation;
      cursor += allocation;
      remainingSlot -= allocation;
    }
  }

  const topThree = [];
  const seen = new Set();
  placements.forEach((item) => {
    if (seen.has(item.taskId)) return;
    if (topThree.length >= 3) return;
    seen.add(item.taskId);
    topThree.push(item.topLabel);
  });

  return {
    topThree,
    timeline: placements.map((item) => item.label),
    note: placements.length
      ? "空き時間に収まりやすい順で仮配置しています。必要に応じて手動で入れ替えてください。"
      : "空き時間はありますが、見積や優先度の条件に合う候補を作れませんでした。"
  };
}

function scoreTask(task, selectedDate, slotMinutes, fatigue) {
  let score = 0;

  score += ({ "必須": 60, "できれば": 25, "後回し": -10 })[task.importance] ?? 0;
  score += ({ "高": 30, "中": 12, "低": 0 })[task.priority] ?? 0;
  score += ({ "未着手": 8, "進行中": 16, "完了": -999 })[task.status] ?? 0;

  const estimate = Number(task.estimate) || 60;
  if (estimate <= slotMinutes) {
    score += 18;
  } else if (slotMinutes >= 30) {
    score += 6;
  } else {
    score -= 20;
  }

  if (task.deadlineDate) {
    const due = new Date(`${task.deadlineDate}T${task.deadlineTime || "23:59"}:00`);
    const hoursToDue = (due.getTime() - selectedDate.getTime()) / (1000 * 60 * 60);

    if (hoursToDue <= 24) score += 50;
    else if (hoursToDue <= 48) score += 36;
    else if (hoursToDue <= 72) score += 24;
    else if (hoursToDue <= 168) score += 10;
  }

  if (fatigue <= 3 && estimate >= 90) score -= 22;
  if (fatigue <= 3 && task.importance === "後回し") score -= 12;
  if (fatigue >= 7 && task.priority === "高") score += 8;

  return score;
}

function getSchedulesForDate(dateStr) {
  if (!dateStr) return [];
  const dateObj = new Date(`${dateStr}T00:00:00`);
  const weekday = dateObj.getDay();

  const fixed = state.fixedSchedules
    .filter((item) => item.weekday === weekday)
    .map((item) => ({ ...item, type: "fixed", date: dateStr, allDay: false }));

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

  const startDate = new Date(event.start?.dateTime || `${fallbackDate}T00:00:00`);
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
  const autoPlan = buildAutoPlan(selectedDate);

  const text = [
    "今日の1日を設計して。",
    `日付：${selectedDate} (${weekdayNames[new Date(`${selectedDate}T00:00:00`).getDay()]})`,
    `睡眠・体調：睡眠 ${dayData.sleepHours || "未入力"} 時間 / 体力 ${dayData.fatigue || "未入力"} / メモ ${dayData.note || "なし"}`,
    "固定予定・単発予定：",
    schedules.length ? schedules.map((item) => `- ${formatScheduleLine(item)}`).join("\n") : "- なし",
    "48時間以内の締切：",
    deadlines.length
      ? deadlines.map((task) => `- ${task.title} / ${task.deadlineDate}${task.deadlineTime ? ` ${task.deadlineTime}` : ""} / 優先度:${task.priority} / 重要度:${task.importance} / 見積:${task.estimate || "?"}分 / ${task.note || "メモなし"}`).join("\n")
      : "- なし",
    "未完了タスク：",
    pending.length
      ? pending.map((task) => `- ${task.title} / ${task.category || "分類なし"} / 状態:${task.status} / 重要度:${task.importance} / 優先度:${task.priority} / 見積:${task.estimate || "?"}分 / 締切:${task.deadlineDate || "未設定"}${task.deadlineTime ? ` ${task.deadlineTime}` : ""}${task.note ? ` / ${task.note}` : ""}`).join("\n")
      : "- なし",
    "空き時間候補：",
    freeSlots.length
      ? freeSlots.map((slot) => `- ${slot.start} - ${slot.end} (${slot.minutes}分)`).join("\n")
      : "- ほぼなし",
    "アプリ内の自動時間割候補：",
    autoPlan.timeline.length ? autoPlan.timeline.map((line) => `- ${line}`).join("\n") : "- なし",
    "アプリ内の最優先3件：",
    autoPlan.topThree.length ? autoPlan.topThree.map((line) => `- ${line}`).join("\n") : "- なし",
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
      state.fixedSchedules = (parsed.fixedSchedules || []).map(normalizeFixedSchedule);
      state.oneOffEvents = (parsed.oneOffEvents || []).map(normalizeOneOffEvent);
      state.tasks = (parsed.tasks || []).map(normalizeTask);
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

function getFormValue(formId, fieldName) {
  return $(formId).elements[fieldName]?.value || "";
}

function isValidTimeRange(start, end) {
  return toMinutes(end) > toMinutes(start);
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
    renderAutoPlan();
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
    renderAutoPlan();

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

  if (localEvent.allDay || !localEvent.start || !localEvent.end) {
    resource.start = { date: localEvent.date };
    resource.end = { date: addDays(localEvent.date, 1) };
  } else {
    resource.start = {
      dateTime: `${localEvent.date}T${localEvent.start}:00`,
      timeZone
    };
    resource.end = {
      dateTime: `${localEvent.date}T${localEvent.end}:00`,
      timeZone
    };
  }

  const response = await gapi.client.calendar.events.insert({
    calendarId: "primary",
    resource
  });

  return response.result;
}

async function updateGoogleEventFromLocal(localEvent) {
  if (!hasValidGoogleToken()) {
    throw new Error("Google に接続していません");
  }
  if (!localEvent.googleEventId) {
    throw new Error("Google Event ID がありません");
  }

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const resource = {
    summary: localEvent.title,
    description: localEvent.note || ""
  };

  if (localEvent.allDay || !localEvent.start || !localEvent.end) {
    resource.start = { date: localEvent.date };
    resource.end = { date: addDays(localEvent.date, 1) };
  } else {
    resource.start = {
      dateTime: `${localEvent.date}T${localEvent.start}:00`,
      timeZone
    };
    resource.end = {
      dateTime: `${localEvent.date}T${localEvent.end}:00`,
      timeZone
    };
  }

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

async function syncUpdatedLocalEventToGoogle(localEventId) {
  const item = state.oneOffEvents.find((event) => event.id === localEventId);
  if (!item || !item.googleEventId) return;

  if (!hasValidGoogleToken()) {
    updateGoogleStatus("Google に接続してから『Google更新』を押してください。", "warn");
    return;
  }

  try {
    updateGoogleStatus("Google Calendar の予定を更新しています...", "");
    await updateGoogleEventFromLocal(item);
    item.googleSyncStatus = "synced";
    saveState();
    renderAll();
    updateGoogleStatus("Google Calendar の予定を更新しました。", "ok");
  } catch (error) {
    item.googleSyncStatus = "failed";
    saveState();
    renderAll();
    updateGoogleStatus(`Google Calendar の更新に失敗しました: ${getErrorMessage(error)}`, "warn");
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
