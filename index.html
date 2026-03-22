const STORAGE_KEY = "day-manager-v1";
const INITIAL_STATE = {
  fixedSchedules: [],
  oneOffEvents: [],
  tasks: [],
  dayConditions: {}
};

const $ = (id) => document.getElementById(id);
const state = loadState();

const weekdayNames = ["日", "月", "火", "水", "木", "金", "土"];

init();

function init() {
  setToday();
  bindEvents();
  renderAll();
  registerServiceWorker();
}

function bindEvents() {
  $("fixedForm").addEventListener("submit", onAddFixedSchedule);
  $("eventForm").addEventListener("submit", onAddOneOffEvent);
  $("taskForm").addEventListener("submit", onAddTask);
  $("selectedDate").addEventListener("change", onDateChanged);
  $("sleepHours").addEventListener("input", saveCurrentConditionInputs);
  $("fatigue").addEventListener("input", saveCurrentConditionInputs);
  $("conditionNote").addEventListener("input", saveCurrentConditionInputs);
  $("generateBtn").addEventListener("click", generatePrompt);
  $("copyBtn").addEventListener("click", copyPrompt);
  $("exportBtn").addEventListener("click", exportData);
  $("importInput").addEventListener("change", importData);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(INITIAL_STATE);
    const parsed = JSON.parse(raw);
    return {
      fixedSchedules: parsed.fixedSchedules || [],
      oneOffEvents: parsed.oneOffEvents || [],
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

function setToday() {
  const today = formatDateInput(new Date());
  $("selectedDate").value = today;
  loadConditionInputsForDate(today);
}

function onDateChanged() {
  loadConditionInputsForDate($("selectedDate").value);
  renderSummaries();
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

function onAddOneOffEvent(e) {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  state.oneOffEvents.push({
    id: crypto.randomUUID(),
    title: String(fd.get("title")).trim(),
    date: String(fd.get("date")),
    start: String(fd.get("start") || ""),
    end: String(fd.get("end") || ""),
    note: String(fd.get("note")).trim()
  });
  saveState();
  e.currentTarget.reset();
  renderAll();
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
  renderSummaries();
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
    wrap.appendChild(createListItem({
      title: `${item.date} / ${item.title}`,
      meta: timeLabel,
      note: item.note,
      actions: [
        makeDeleteButton(() => {
          state.oneOffEvents = state.oneOffEvents.filter((x) => x.id !== item.id);
          saveState();
          renderAll();
        })
      ]
    }));
  });
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
  return [...fixed, ...oneOff].sort(compareSchedule);
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
  const aKey = `${a.start || "99:99"}${a.title}`;
  const bKey = `${b.start || "99:99"}${b.title}`;
  return aKey.localeCompare(bKey);
}

function formatScheduleLine(item) {
  const time = item.start ? `${item.start}${item.end ? ` - ${item.end}` : ""}` : "時刻未設定";
  const note = item.note ? ` / ${item.note}` : "";
  return `${time} / ${item.title}${note}`;
}

function computeFreeSlots(schedules) {
  const baseStart = toMinutes("06:00");
  const baseEnd = toMinutes("24:00");
  const blocks = schedules
    .filter((item) => item.start && item.end)
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
      state.oneOffEvents = parsed.oneOffEvents || [];
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

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}
