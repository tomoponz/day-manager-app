import { state } from "./state.js";
import { googleState, hasValidGoogleToken, getCachedGoogleEvents, formatGoogleEventTime } from "./google-calendar.js";
import { $, getFormValue } from "./utils.js";
import { WEEKDAY_NAMES, getNowContext, formatDateInput } from "./time.js";
import {
  getSchedulesForDate,
  getUpcomingTasks,
  getPendingTasks,
  computeFreeSlots,
  buildAutoPlan,
  splitSchedulesByNow,
  buildCurrentStateLines,
  buildTimelineStatusLines,
  buildRiskAlerts,
  buildCutCandidates,
  formatScheduleLine
} from "./planner.js";

const handlers = {
  onEditFixed: null,
  onDuplicateFixed: null,
  onDeleteFixed: null,
  onEditEvent: null,
  onDuplicateEvent: null,
  onSyncEvent: null,
  onSyncUpdatedEvent: null,
  onDeleteEvent: null,
  onQuickSetTaskStatus: null,
  onDeferTaskToTomorrow: null,
  onEditTask: null,
  onDeleteTask: null,
  onDeleteGoogleEvent: null
};

export function configureRenderHandlers(nextHandlers = {}) {
  Object.assign(handlers, nextHandlers);
}

export function hydrateGoogleConfigInputs() {
  const clientInput = $("googleClientId");
  const apiInput = $("googleApiKey");
  if (clientInput) clientInput.value = googleState.config.clientId || "";
  if (apiInput) apiInput.value = googleState.config.apiKey || "";
}

export function hydratePlannerMode() {
  const select = $("plannerMode");
  if (select) select.value = state.uiState?.plannerMode || "auto";
}

export function loadConditionInputsForDate(date) {
  const data = state.dayConditions[date] || { sleepHours: "", fatigue: "", note: "" };
  $("sleepHours").value = data.sleepHours || "";
  $("fatigue").value = data.fatigue || "";
  $("conditionNote").value = data.note || "";
}

export function renderCurrentClock() {
  const ctx = getNowContext($("selectedDate")?.value || formatDateInput(new Date()), state.uiState?.plannerMode || "auto");
  $("currentDateTime").textContent = ctx.currentDateLabel;
  $("currentDateMeta").textContent = `${ctx.timeZone} / ${WEEKDAY_NAMES[ctx.now.getDay()]}曜日 / 現在時刻を基準に再設計`;
  updateActiveModeChip(ctx);
}

export function renderAll() {
  renderCurrentClock();
  renderFixedSchedules();
  renderOneOffEvents();
  renderTasks();
  renderGoogleEventList();
  renderCurrentState();
  renderSummaries();
  renderAutoPlan();
  updateGoogleConnectionBadge();
}

export function renderFixedSchedules() {
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
      title: `${WEEKDAY_NAMES[item.weekday]} ${item.start} - ${item.end} / ${item.title}`,
      meta: "毎週固定",
      note: item.note,
      actions: [
        makeActionButton("編集", () => handlers.onEditFixed?.(item.id)),
        makeActionButton("複製", () => handlers.onDuplicateFixed?.(item.id)),
        makeDeleteButton(() => handlers.onDeleteFixed?.(item.id))
      ]
    }));
  });
}

export function renderOneOffEvents() {
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
    const timeLabel = item.allDay ? "終日" : item.start ? `${item.start}${item.end ? ` - ${item.end}` : ""}` : "時刻未設定";
    const syncLabel = getLocalEventSyncLabel(item);
    const actions = [
      makeActionButton("編集", () => handlers.onEditEvent?.(item.id)),
      makeActionButton("複製", () => handlers.onDuplicateEvent?.(item.id))
    ];

    if (hasValidGoogleToken()) {
      if (!item.googleEventId) {
        actions.push(makeActionButton(item.googleSyncStatus === "failed" ? "Google再送" : "Google追加", () => handlers.onSyncEvent?.(item.id)));
      } else if (item.googleSyncStatus === "outdated") {
        actions.push(makeActionButton("Google更新", () => handlers.onSyncUpdatedEvent?.(item.id)));
      }
    }

    actions.push(makeDeleteButton(() => handlers.onDeleteEvent?.(item.id)));

    wrap.appendChild(createListItem({
      title: `${item.date} / ${item.title}`,
      meta: `${timeLabel} / ${syncLabel}`,
      note: item.note,
      actions
    }));
  });
}

export function renderTasks() {
  const wrap = $("taskList");
  wrap.innerHTML = "";
  const order = { 高: 0, 中: 1, 低: 2 };
  const statusRank = { 未着手: 0, 進行中: 1, 完了: 2 };
  const importanceRank = { 必須: 0, できれば: 1, 後回し: 2 };

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
    statusSelect.addEventListener("change", () => handlers.onQuickSetTaskStatus?.(item.id, statusSelect.value));
    actions.push(statusSelect);

    if (item.status !== "進行中") actions.push(makeActionButton("着手", () => handlers.onQuickSetTaskStatus?.(item.id, "進行中")));
    if (item.status !== "完了") actions.push(makeActionButton("完了", () => handlers.onQuickSetTaskStatus?.(item.id, "完了")));
    actions.push(makeActionButton("明日", () => handlers.onDeferTaskToTomorrow?.(item.id)));
    actions.push(makeActionButton("編集", () => handlers.onEditTask?.(item.id)));
    actions.push(makeDeleteButton(() => handlers.onDeleteTask?.(item.id)));

    const deadlineText = item.deadlineDate ? `${item.deadlineDate}${item.deadlineTime ? ` ${item.deadlineTime}` : ""}` : "締切未設定";
    const deferText = item.deferUntilDate ? ` / 保留:${item.deferUntilDate}` : "";
    const meta = [
      item.category || "分類なし",
      `重要度:${item.importance}`,
      `優先度:${item.priority}`,
      `見積:${item.estimate || "?"}分`,
      `締切:${deadlineText}`,
      `状態:${item.status}`
    ].join(" / ") + deferText;

    wrap.appendChild(createListItem({
      title: item.title,
      meta,
      note: item.note,
      actions
    }));
  });
}

export function renderGoogleEventList() {
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
        makeDeleteButton(() => handlers.onDeleteGoogleEvent?.(event.id))
      ]
    }));
  });
}

export function renderCurrentState() {
  const date = $("selectedDate").value;
  const ctx = getNowContext(date, state.uiState?.plannerMode || "auto");
  const schedules = getSchedulesForDate(date);
  const split = splitSchedulesByNow(schedules, ctx);
  const risks = buildRiskAlerts(date, ctx, schedules);
  const cuts = buildCutCandidates(date, ctx);
  const freeSlots = computeFreeSlots(schedules, ctx);

  fillSummary($("currentStateSummary"), buildCurrentStateLines(date, ctx, split, freeSlots));
  fillSummary($("timelineStatusSummary"), buildTimelineStatusLines(split));
  fillSummary($("riskSummary"), risks);
  fillSummary($("cutSummary"), cuts);

  const note = ctx.isToday
    ? `${ctx.effectiveModeLabel}として、現在時刻以降の残り時間を優先して評価しています。`
    : `対象日は今日ではないので、現在時刻は参考情報として扱い、日全体の計画を出します。`;
  updateStateNote(note);
}

export function renderSummaries() {
  const selectedDate = $("selectedDate").value;
  const ctx = getNowContext(selectedDate, state.uiState?.plannerMode || "auto");
  const schedules = getSchedulesForDate(selectedDate);
  const deadlines = getUpcomingTasks(selectedDate, 48, ctx);
  const pending = getPendingTasks(selectedDate, ctx);
  const freeSlots = computeFreeSlots(schedules, ctx);

  fillSummary($("dayScheduleSummary"), schedules.length ? schedules.map((item) => formatScheduleLine(item)) : []);
  fillSummary($("deadlineSummary"), deadlines.length ? deadlines.map((task) => `${task.title} / ${task.deadlineDate}${task.deadlineTime ? ` ${task.deadlineTime}` : ""} / 優先度:${task.priority}`) : []);
  fillSummary($("pendingSummary"), pending.length ? pending.slice(0, 8).map((task) => `${task.title} / ${task.category || "分類なし"} / ${task.status}`) : []);
  fillSummary($("freeTimeSummary"), freeSlots.length ? freeSlots.map((slot) => `${slot.start} - ${slot.end} (${slot.minutes}分)`) : []);
}

export function renderAutoPlan() {
  const date = $("selectedDate").value;
  const plan = buildAutoPlan(date);
  fillSummary($("autoTopThree"), plan.topThree);
  fillSummary($("autoTimeline"), plan.timeline);
  $("autoPlanNote").textContent = plan.note;
}

export function updateGoogleStatus(message, variant = "") {
  const box = $("googleStatusBox");
  if (!box) return;
  box.textContent = message;
  box.className = "calendar-status";
  if (variant) box.classList.add(variant);
}

export function updateGoogleConnectionBadge() {
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

export function updateStateNote(message) {
  const note = $("stateNote");
  if (note) note.textContent = message;
}

function updateActiveModeChip(ctx) {
  const chip = $("activeModeChip");
  if (!chip) return;
  chip.className = "mode-chip active";
  chip.textContent = ctx.effectiveModeLabel;
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

function getLocalEventSyncLabel(item) {
  if (item.googleEventId && item.googleSyncStatus === "outdated") return "Google要更新";
  if (item.googleEventId) return "Google同期済";
  if (item.googleSyncStatus === "failed") return "Google同期失敗";
  if (item.googleSyncStatus === "pending") return "Google未接続";
  return "ローカルのみ";
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
