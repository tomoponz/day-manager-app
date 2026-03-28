import { state } from "./state.js";
import {
  googleState,
  hasValidGoogleToken,
  getCachedGoogleEvents,
  formatGoogleEventTime
} from "./google-calendar.js";
import { $ } from "./utils.js";
import { WEEKDAY_NAMES, getNowContext, formatDateInput } from "./time.js";
import {
  getSchedulesForDate,
  getUpcomingTasks,
  getPendingTasks,
  computeFreeSlots,
  buildAutoPlan,
  splitSchedulesByNow,
  buildCurrentStateLines,
  buildRiskAlerts,
  buildCutCandidates,
  buildTimelineStatusLines,
  formatScheduleLine,
  scoreTask
} from "./planner.js";
import { refreshCalendarUi, renderCalendarConnectionMeta } from "./calendar-ui.js";

const handlers = {
  onEditFixed: null,
  onDuplicateFixed: null,
  onDeleteFixed: null,
  onCreateFixed: null,
  onEditEvent: null,
  onDuplicateEvent: null,
  onSyncEvent: null,
  onSyncUpdatedEvent: null,
  onDeleteEvent: null,
  onCreateEvent: null,
  onQuickSetTaskStatus: null,
  onDeferTaskToTomorrow: null,
  onEditTask: null,
  onDeleteTask: null,
  onCreateTask: null,
  onDeleteGoogleEvent: null
};

export function configureRenderHandlers(nextHandlers = {}) {
  Object.assign(handlers, nextHandlers);
}


export function hydratePlannerMode() {
  const select = $("plannerMode");
  if (select) select.value = state.uiState?.plannerMode || "auto";
}

export function hydrateSettingsInputs() {
  if ($("focusMinutesTarget")) {
    $("focusMinutesTarget").value = String(state.settings?.focusMinutesTarget ?? 180);
  }
  if ($("bufferMinutes")) {
    $("bufferMinutes").value = String(state.settings?.bufferMinutes ?? 10);
  }
}

export function loadConditionInputsForDate(date) {
  const dayCondition = state.dayConditions[date] || {
    sleepHours: "",
    fatigue: "",
    note: ""
  };

  $("sleepHours").value = dayCondition.sleepHours || "";
  $("fatigue").value = dayCondition.fatigue || "";
  $("conditionNote").value = dayCondition.note || "";
}

export function renderCurrentClock() {
  const ctx = getNowContext(
    $("selectedDate")?.value || formatDateInput(new Date()),
    state.uiState?.plannerMode || "auto"
  );

  $("currentDateTime").textContent = ctx.currentDateLabel;
  $("currentDateMeta").textContent = `${ctx.timeZone} / ${WEEKDAY_NAMES[ctx.now.getDay()]}曜日 / 現在時刻を基準に再設計`;
  updateActiveModeChip(ctx);
}

export function renderAll() {
  renderCurrentClock();
  hydrateSettingsInputs();
  renderFixedSchedules();
  renderOneOffEvents();
  renderTasks();
  renderGoogleEventList();
  renderCurrentState();
  renderSummaries();
  renderAutoPlan();
  renderTodayActionDeck();
  updateGoogleConnectionBadge();
  renderCalendarConnectionMeta();
  refreshCalendarUi();
}

export function renderFixedSchedules() {
  const wrap = $("fixedList");
  wrap.innerHTML = "";

  const items = [...state.fixedSchedules].sort(
    (a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start)
  );

  if (!items.length) {
    renderEmptyState(wrap, {
      message: "固定予定がまだありません。まずは授業や通学などの毎週予定を入れると判断が安定します。",
      primaryLabel: "＋ 固定予定を追加する",
      onPrimary: () => handlers.onCreateFixed?.()
    });
    return;
  }

  wrap.className = "list-wrap";
  items.forEach((item) => {
    wrap.appendChild(
      createListItem({
        title: item.title,
        badges: [
          makeBadge("毎週固定", "ok"),
          makeBadge(`${WEEKDAY_NAMES[item.weekday]}曜日`),
          makeBadge(`${item.start} - ${item.end}`, "blue")
        ],
        detail: item.note ? `補足: ${item.note}` : "",
        note: item.note,
        actions: [
          makeActionButton("編集", () => handlers.onEditFixed?.(item.id)),
          makeActionButton("複製", () => handlers.onDuplicateFixed?.(item.id)),
          makeDeleteButton(() => handlers.onDeleteFixed?.(item.id))
        ],
        itemClassName: "fixed-item"
      })
    );
  });
}

export function renderOneOffEvents() {
  const wrap = $("eventList");
  wrap.innerHTML = "";

  const items = [...state.oneOffEvents].sort((a, b) =>
    `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`)
  );

  if (!items.length) {
    renderEmptyState(wrap, {
      message: "単発予定がまだありません。面談・外出・締切などを足すと、その日の重さが見えやすくなります。",
      primaryLabel: "＋ 単発予定を追加する",
      onPrimary: () => handlers.onCreateEvent?.()
    });
    return;
  }

  wrap.className = "list-wrap";
  items.forEach((item) => {
    const timeLabel = item.allDay
      ? "終日"
      : item.start
        ? `${item.start}${item.end ? ` - ${item.end}` : ""}`
        : "時刻未設定";

    const syncLabel = getLocalEventSyncLabel(item);
    const actions = [
      makeActionButton("編集", () => handlers.onEditEvent?.(item.id)),
      makeActionButton("複製", () => handlers.onDuplicateEvent?.(item.id))
    ];

    if (hasValidGoogleToken()) {
      if (!item.googleEventId) {
        actions.push(
          makeActionButton(
            item.googleSyncStatus === "failed" ? "Google再送" : "Google追加",
            () => handlers.onSyncEvent?.(item.id)
          )
        );
      } else if (item.googleSyncStatus === "outdated") {
        actions.push(makeActionButton("Google更新", () => handlers.onSyncUpdatedEvent?.(item.id)));
      }
    }

    actions.push(makeDeleteButton(() => handlers.onDeleteEvent?.(item.id)));

    wrap.appendChild(
      createListItem({
        title: item.title,
        badges: [
          makeBadge(item.date),
          makeBadge(timeLabel, item.allDay ? "ok" : "blue"),
          makeBadge(
            syncLabel,
            syncLabel.includes("失敗")
              ? "danger"
              : syncLabel.includes("同期済")
                ? "ok"
                : syncLabel.includes("要更新")
                  ? "warn"
                  : ""
          )
        ],
        detail: "",
        note: item.note,
        actions,
        itemClassName: "event-item"
      })
    );
  });
}

export function renderTasks() {
  const wrap = $("taskList");
  wrap.innerHTML = "";

  const priorityOrder = { 高: 0, 中: 1, 低: 2 };
  const statusRank = { 未着手: 0, 進行中: 1, 完了: 2 };
  const importanceRank = { 必須: 0, できれば: 1, 後回し: 2 };

  const items = [...state.tasks].sort((a, b) => {
    if (statusRank[a.status] !== statusRank[b.status]) {
      return statusRank[a.status] - statusRank[b.status];
    }

    if (importanceRank[a.importance] !== importanceRank[b.importance]) {
      return importanceRank[a.importance] - importanceRank[b.importance];
    }

    const deadlineA = `${a.deadlineDate || "9999-99-99"} ${a.deadlineTime || "99:99"}`;
    const deadlineB = `${b.deadlineDate || "9999-99-99"} ${b.deadlineTime || "99:99"}`;
    if (deadlineA !== deadlineB) return deadlineA.localeCompare(deadlineB);

    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  if (!items.length) {
    renderEmptyState(wrap, {
      message: "タスクがまだありません。1件だけでも入れると、今日の最優先候補を出せます。",
      primaryLabel: "＋ タスクを追加する",
      onPrimary: () => handlers.onCreateTask?.()
    });
    return;
  }

  wrap.className = "list-wrap";
  const now = new Date();
  const today = formatDateInput(now);
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

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

    if (item.status !== "進行中") {
      actions.push(makeActionButton("着手", () => handlers.onQuickSetTaskStatus?.(item.id, "進行中")));
    }
    if (item.status !== "完了") {
      actions.push(makeActionButton("完了", () => handlers.onQuickSetTaskStatus?.(item.id, "完了")));
    }

    actions.push(makeActionButton("明日", () => handlers.onDeferTaskToTomorrow?.(item.id)));
    actions.push(makeActionButton("編集", () => handlers.onEditTask?.(item.id)));
    actions.push(makeDeleteButton(() => handlers.onDeleteTask?.(item.id)));

    const deadlineText = item.deadlineDate
      ? `${item.deadlineDate}${item.deadlineTime ? ` ${item.deadlineTime}` : ""}`
      : "締切未設定";

    const itemClasses = ["task-item"];
    let deadlineVariant = "";

    if (item.priority === "高") itemClasses.push("priority-high");
    else if (item.priority === "中") itemClasses.push("priority-medium");
    else itemClasses.push("priority-low");

    if (item.status === "完了") itemClasses.push("is-completed");

    if (item.deadlineDate) {
      const overdue =
        item.deadlineDate < today ||
        (item.deadlineDate === today && item.deadlineTime && item.deadlineTime < currentTime && item.status !== "完了");
      const dueSoon = item.deadlineDate === today || item.deadlineDate < today;

      if (overdue) {
        itemClasses.push("is-overdue");
        deadlineVariant = "danger";
      } else if (dueSoon) {
        itemClasses.push("is-deadline-soon");
        deadlineVariant = "warn";
      }
    }

    const detailParts = [];
    if (item.category) detailParts.push(`分類: ${item.category}`);
    if (item.deferUntilDate) detailParts.push(`保留: ${item.deferUntilDate}`);
    if (item.note) detailParts.push(item.note);

    wrap.appendChild(
      createListItem({
        title: item.title,
        badges: [
          makeBadge(`重要度:${item.importance}`, item.importance === "必須" ? "warn" : ""),
          makeBadge(
            `優先度:${item.priority}`,
            item.priority === "高" ? "danger" : item.priority === "中" ? "warn" : "blue"
          ),
          makeBadge(
            `状態:${item.status}`,
            item.status === "完了" ? "ok" : item.status === "進行中" ? "warn" : ""
          ),
          makeBadge(`締切:${deadlineText}`, deadlineVariant),
          makeBadge(`見積:${item.estimate || "?"}分`),
          ...(item.protectTimeBlock ? [makeBadge("保護", "ok")] : [])
        ],
        detail: detailParts.join(" / "),
        note: item.note,
        actions,
        itemClassName: itemClasses.join(" ")
      })
    );
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
    wrap.appendChild(
      createListItem({
        title: event.summary || "タイトルなし",
        badges: [
          makeBadge("Google Calendar", "ok"),
          makeBadge(formatGoogleEventTime(event), "blue")
        ],
        detail: "",
        note: event.description || "",
        actions: [makeDeleteButton(() => handlers.onDeleteGoogleEvent?.(event.id))],
        itemClassName: "event-item"
      })
    );
  });
}

export function renderCurrentState() {
  const date = $("selectedDate").value;
  const ctx = getNowContext(date, state.uiState?.plannerMode || "auto");
  const schedules = getSchedulesForDate(date);
  const split = splitSchedulesByNow(schedules, ctx);
  const fatigue = Number(state.dayConditions?.[date]?.fatigue ?? $("fatigue")?.value ?? 5);
  const risks = buildRiskAlerts(date, ctx, schedules, fatigue);
  const cuts = buildCutCandidates(date, ctx, fatigue);
  const freeSlots = computeFreeSlots(schedules, ctx);

  fillSummary($("currentStateSummary"), buildCurrentStateLines(date, ctx, split, freeSlots));
  fillSummary($("riskSummary"), risks);
  fillSummary($("cutSummary"), cuts);

  const note = ctx.isToday
    ? `${ctx.effectiveModeLabel}として、現在時刻以降の残り時間を優先して評価しています。`
    : "対象日は今日ではないので、現在時刻は参考情報として扱い、日全体の計画を出します。";
  updateStateNote(note);
}

export function renderSummaries() {
  const selectedDate = $("selectedDate").value;
  const ctx = getNowContext(selectedDate, state.uiState?.plannerMode || "auto");
  const schedules = getSchedulesForDate(selectedDate);
  const deadlines = getUpcomingTasks(selectedDate, 48, ctx);
  const pending = getPendingTasks(selectedDate, ctx);
  const freeSlots = computeFreeSlots(schedules, ctx);

  fillSummary(
    $("dayScheduleSummary"),
    schedules.length ? schedules.map((item) => formatScheduleLine(item)) : []
  );
  fillSummary(
    $("deadlineSummary"),
    deadlines.length
      ? deadlines.map(
          (task) => `${task.title} / ${task.deadlineDate}${task.deadlineTime ? ` ${task.deadlineTime}` : ""} / 優先度:${task.priority}`
        )
      : []
  );
  fillSummary(
    $("pendingSummary"),
    pending.length ? pending.slice(0, 8).map((task) => `${task.title} / ${task.category || "分類なし"} / ${task.status}`) : []
  );
  fillSummary(
    $("freeTimeSummary"),
    freeSlots.length ? freeSlots.map((slot) => `${slot.start} - ${slot.end} (${slot.minutes}分)`) : []
  );

  const split = splitSchedulesByNow(schedules, ctx);
  fillSummary($("immediateScheduleSummary"), buildTimelineStatusLines(split).slice(0, 5));
}

export function renderAutoPlan() {
  const date = $("selectedDate").value;
  const ctx = getNowContext(date, state.uiState?.plannerMode || "auto");
  const fatigue = Number(state.dayConditions?.[date]?.fatigue ?? $("fatigue")?.value ?? 5);
  const plan = buildAutoPlan(date, ctx, false, fatigue);

  fillSummary($("autoTopThree"), plan.topThree);
  fillSummary($("autoTimeline"), plan.timeline);
  $("autoPlanNote").textContent = `${plan.note} / 集中ブロック: ${plan.focusSummary}`;
}

export function renderTodayActionDeck() {
  const wrap = $("todayActionDeck");
  if (!wrap) return;

  wrap.innerHTML = "";
  const selectedDate = $("selectedDate")?.value;
  if (!selectedDate) {
    wrap.className = "today-action-list empty";
    wrap.textContent = "対象日を選ぶと、ここに直接触れる候補を出します。";
    return;
  }

  const ctx = getNowContext(selectedDate, state.uiState?.plannerMode || "auto");
  const schedules = getSchedulesForDate(selectedDate);
  const freeSlots = computeFreeSlots(schedules, ctx);
  const slotMinutes = freeSlots[0]?.minutes || 60;
  const fatigue = Number(state.dayConditions?.[selectedDate]?.fatigue || $("fatigue")?.value || 5);
  const reference = ctx.isToday ? ctx.now : new Date(`${selectedDate}T00:00:00`);

  const ranked = getPendingTasks(selectedDate, ctx)
    .map((task) => ({ task, score: scoreTask(task, reference, slotMinutes, fatigue, ctx, selectedDate) }))
    .filter((entry) => entry.score > -999)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const deadlineA = `${a.task.deadlineDate || "9999-99-99"} ${a.task.deadlineTime || "99:99"}`;
      const deadlineB = `${b.task.deadlineDate || "9999-99-99"} ${b.task.deadlineTime || "99:99"}`;
      return deadlineA.localeCompare(deadlineB);
    })
    .slice(0, 3);

  if (!ranked.length) {
    wrap.className = "today-action-list empty";
    wrap.textContent = "未完了タスクがないので、ここには直接触る候補がありません。";
    return;
  }

  wrap.className = "today-action-list";
  ranked.forEach(({ task, score }) => wrap.appendChild(createTodayActionCard(task, score, slotMinutes, selectedDate)));
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

function renderEmptyState(
  container,
  { message, primaryLabel = "", onPrimary = null, secondaryLabel = "", onSecondary = null }
) {
  container.className = "list-wrap empty-cta";
  container.innerHTML = "";

  const messageEl = document.createElement("div");
  messageEl.className = "empty-cta__message";
  messageEl.textContent = message;
  container.appendChild(messageEl);

  const actions = document.createElement("div");
  actions.className = "empty-cta__actions";

  if (primaryLabel && typeof onPrimary === "function") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "empty-cta__button primary";
    button.textContent = primaryLabel;
    button.addEventListener("click", onPrimary);
    actions.appendChild(button);
  }

  if (secondaryLabel && typeof onSecondary === "function") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "empty-cta__button ghost";
    button.textContent = secondaryLabel;
    button.addEventListener("click", onSecondary);
    actions.appendChild(button);
  }

  if (actions.childNodes.length) {
    container.appendChild(actions);
  }
}

function createTodayActionCard(task, score, slotMinutes, selectedDate) {
  const card = document.createElement("article");
  card.className = "today-action-card";

  const head = document.createElement("div");
  head.className = "today-action-card__head";

  const titleWrap = document.createElement("div");
  titleWrap.className = "today-action-card__title-wrap";

  const title = document.createElement("strong");
  title.className = "today-action-card__title";
  title.textContent = task.title;
  titleWrap.appendChild(title);

  const scoreBadge = document.createElement("span");
  scoreBadge.className = "today-action-score";
  scoreBadge.textContent = `優先 ${Math.round(score)}`;
  head.appendChild(titleWrap);
  head.appendChild(scoreBadge);

  const meta = document.createElement("div");
  meta.className = "today-action-card__meta";
  [
    createActionMetaBadge(`状態:${task.status}`, task.status === "完了" ? "ok" : task.status === "進行中" ? "warn" : ""),
    createActionMetaBadge(`重要度:${task.importance}`, task.importance === "必須" ? "warn" : ""),
    createActionMetaBadge(`優先度:${task.priority}`, task.priority === "高" ? "danger" : task.priority === "中" ? "warn" : "blue"),
    createActionMetaBadge(`見積:${task.estimate || "?"}分`, "blue"),
    task.deadlineDate ? createActionMetaBadge(`締切:${formatTaskDeadline(task)}`, getDeadlineVariant(task, selectedDate)) : null,
    task.protectTimeBlock ? createActionMetaBadge("保護", "ok") : null
  ].filter(Boolean).forEach((badge) => meta.appendChild(badge));

  const reason = document.createElement("p");
  reason.className = "today-action-card__reason";
  reason.textContent = buildActionReason(task, slotMinutes, selectedDate);

  const actions = document.createElement("div");
  actions.className = "today-action-card__actions";
  if (task.status !== "進行中") actions.appendChild(makeActionButton("着手", () => handlers.onQuickSetTaskStatus?.(task.id, "進行中")));
  if (task.status !== "完了") actions.appendChild(makeActionButton("完了", () => handlers.onQuickSetTaskStatus?.(task.id, "完了")));
  actions.appendChild(makeActionButton("明日", () => handlers.onDeferTaskToTomorrow?.(task.id)));
  actions.appendChild(makeActionButton("編集", () => handlers.onEditTask?.(task.id)));

  card.appendChild(head);
  card.appendChild(meta);
  card.appendChild(reason);
  card.appendChild(actions);
  return card;
}

function createActionMetaBadge(text, variant = "") {
  const span = document.createElement("span");
  span.className = `item-badge${variant ? ` is-${variant}` : ""}`;
  span.textContent = text;
  return span;
}

function formatTaskDeadline(task) {
  return `${task.deadlineDate}${task.deadlineTime ? ` ${task.deadlineTime}` : ""}`;
}

function getDeadlineVariant(task, selectedDate) {
  if (!task.deadlineDate || task.status === "完了") return "";
  if (task.deadlineDate < selectedDate) return "danger";
  if (task.deadlineDate === selectedDate) return "warn";
  return "";
}

function buildActionReason(task, slotMinutes, selectedDate) {
  const reasons = [];
  if (task.deadlineDate) {
    if (task.deadlineDate < selectedDate) reasons.push("期限超過なので最優先で処理対象です");
    else if (task.deadlineDate === selectedDate) reasons.push("今日が締切です");
    else reasons.push(`直近の締切は ${formatTaskDeadline(task)} です`);
  }
  if (task.status === "進行中") reasons.push("すでに進行中なので、そのまま終わらせる候補です");
  if (task.protectTimeBlock) reasons.push("守るべき時間ブロックとして扱っています");
  if ((Number(task.estimate) || 60) <= slotMinutes) reasons.push(`いま見えている空き時間 ${slotMinutes}分 に収まりやすい見積です`);
  if (!reasons.length) reasons.push("重要度・優先度・空き時間のバランスから上位に来ています");
  return reasons[0];
}

function getLocalEventSyncLabel(item) {
  if (item.googleEventId && item.googleSyncStatus === "outdated") return "Google要更新";
  if (item.googleEventId) return "Google同期済";
  if (item.googleSyncStatus === "failed") return "Google同期失敗";
  if (item.googleSyncStatus === "pending") return "Google未接続";
  return "ローカルのみ";
}

function createListItem({ title, badges = [], detail = "", note, actions, itemClassName = "" }) {
  const tpl = $("listItemTemplate").content.cloneNode(true);
  const item = tpl.querySelector(".list-item");
  if (itemClassName) item.className += ` ${itemClassName}`;

  tpl.querySelector(".item-title").textContent = title;

  const meta = tpl.querySelector(".item-meta");
  meta.innerHTML = "";
  badges.forEach((badge) => {
    if (!badge) return;
    const span = document.createElement("span");
    span.className = `item-badge${badge.variant ? ` is-${badge.variant}` : ""}`;
    span.textContent = badge.text;
    meta.appendChild(span);
  });

  const detailEl = tpl.querySelector(".item-detail");
  if (detailEl) detailEl.textContent = detail || "";
  tpl.querySelector(".item-note").textContent = note || "";

  const actionWrap = tpl.querySelector(".list-actions");
  (actions || []).forEach((el) => actionWrap.appendChild(el));

  return tpl;
}

function makeBadge(text, variant = "") {
  return { text, variant };
}

function makeDeleteButton(onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mini-btn";
  button.textContent = "削除";
  button.addEventListener("click", onClick);
  return button;
}

function makeActionButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}
