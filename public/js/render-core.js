import { state } from "./state.js";
import { hasValidGoogleToken } from "./google-calendar.js";
import { $ } from "./utils.js";
import { WEEKDAY_NAMES, getNowContext, formatDateInput } from "./time.js";
import { getTaskEffectiveStatus, sortTasksForDisplay } from "./task-utils.js";
import {
  getSchedulesForDate,
  getUpcomingTasks,
  getPendingTasks,
  buildAutoPlan,
  computeRuleAwareFreeSlots,
  splitSchedulesByNow,
  buildCurrentStateLines,
  buildRiskAlerts,
  buildCutCandidates,
  buildTimelineStatusLines,
  formatScheduleLine,
  scoreTask
} from "./planner.js";
import { refreshCalendarUi, renderCalendarConnectionMeta } from "./calendar-ui.js";
import { describeProtectedBlock, buildRuleModeLabel } from "./scheduling-rules.js";
import { buildMovementPlanLines } from "./travel.js";
import {
  configureListRenderHandlers,
  hydrateExecutionSearchUi,
  renderExecutionSearchMeta,
  renderFixedSchedules,
  renderOneOffEvents,
  renderTasks,
  renderStudyLocations,
  renderTravelRoutes,
  updateKnownPlaceSuggestions,
  renderGoogleEventList,
  buildStudyLocationSummaryLines
} from "./render-lists.js";

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
  onDismissEvent: null,
  onRestoreDismissedEvents: null,
  onCleanupPastEvents: null,
  onCreateEvent: null,
  onQuickSetTaskStatus: null,
  onDeferTaskToTomorrow: null,
  onEditTask: null,
  onDeleteTask: null,
  onCreateTask: null,
  onEditStudyLocation: null,
  onDeleteStudyLocation: null,
  onCreateStudyLocation: null,
  onEditTravelRoute: null,
  onDeleteTravelRoute: null,
  onCreateTravelRoute: null,
  onOpenStudyLocationSourceUrl: null,
  onMarkStudyLocationCheckedOpen: null,
  onMarkStudyLocationCheckedClosed: null,
  onMarkStudyLocationCheckedShortened: null,
  onClearStudyLocationDateCheck: null,
  onDeleteGoogleEvent: null
};

export function configureRenderHandlers(nextHandlers = {}) {
  Object.assign(handlers, nextHandlers);
  configureListRenderHandlers(nextHandlers);
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
  if ($("aiServiceName")) {
    $("aiServiceName").value = state.settings?.aiServiceName || "AI";
  }
  if ($("aiServiceUrl")) {
    $("aiServiceUrl").value = state.settings?.aiServiceUrl || state.settings?.chatgptUrl || "";
  }
  if ($("aiPlanningDays")) {
    $("aiPlanningDays").value = String(state.settings?.aiPlanningDays || 1);
  }
  if ($("planningGranularityMinutes")) {
    $("planningGranularityMinutes").value = String(state.settings?.planningGranularityMinutes || 10);
  }
  if ($("chatgptUrl")) {
    $("chatgptUrl").value = state.settings?.chatgptUrl || "";
  }
  if ($("geminiUrl")) {
    $("geminiUrl").value = state.settings?.geminiUrl || "";
  }
  if ($("campusPortalUrl")) {
    $("campusPortalUrl").value = state.settings?.campusPortalUrl || "";
  }
  syncExternalLinkButtons();
  hydrateExecutionSearchUi();
}

function syncExternalLinkButtons() {
  const mappings = [
    ["openAiServiceLinkBtn", state.settings?.aiServiceUrl || state.settings?.chatgptUrl],
    ["openChatgptLinkBtn", state.settings?.chatgptUrl],
    ["openGeminiLinkBtn", state.settings?.geminiUrl],
    ["openCampusPortalLinkBtn", state.settings?.campusPortalUrl]
  ];
  mappings.forEach(([id, url]) => {
    const button = $(id);
    if (!button) return;
    const normalized = String(url || "").trim();
    button.disabled = !/^https?:\/\//i.test(normalized);
    button.title = normalized || "URL未設定";
  });
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
  const topbarDate = $("topbarDateMount");
  if (topbarDate) topbarDate.textContent = $("selectedDate")?.value || formatDateInput(ctx.selectedDate);
  const topbarClock = $("topbarClockMount");
  if (topbarClock) {
    topbarClock.textContent = ctx.now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  }
  updateActiveModeChip(ctx);
}

export function renderAll() {
  renderCurrentClock();
  hydrateSettingsInputs();
  renderExecutionSearchMeta();
  renderFixedSchedules();
  renderOneOffEvents();
  renderTasks();
  renderStudyLocations();
  renderTravelRoutes();
  updateKnownPlaceSuggestions();
  renderGoogleEventList();
  renderCurrentState();
  renderSummaries();
  renderAutoPlan();
  renderTodayActionDeck();
  updateGoogleConnectionBadge();
  renderCalendarConnectionMeta();
  refreshCalendarUi();
}

export function renderCurrentState() {
  const date = $("selectedDate").value;
  const ctx = getNowContext(date, state.uiState?.plannerMode || "auto");
  const schedules = getSchedulesForDate(date);
  const split = splitSchedulesByNow(schedules, ctx);
  const fatigue = Number(state.dayConditions?.[date]?.fatigue ?? $("fatigue")?.value ?? 5);
  const risks = buildRiskAlerts(date, ctx, schedules, fatigue);
  const cuts = buildCutCandidates(date, ctx, fatigue);
  const { protectedBlocks, freeSlots } = computeRuleAwareFreeSlots(date, schedules, ctx);

  fillSummary($("currentStateSummary"), buildCurrentStateLines(date, ctx, split, freeSlots, protectedBlocks));
  fillSummary($("riskSummary"), risks);
  fillSummary($("cutSummary"), cuts);

  const ruleLabel = buildRuleModeLabel(date, protectedBlocks);
  const note = ctx.isToday
    ? `${ctx.effectiveModeLabel}として、現在時刻以降の残り時間を優先して評価しています。 ${ruleLabel}`
    : `対象日は今日ではないので、現在時刻は参考情報として扱い、日全体の計画を出します。 ${ruleLabel}`;
  updateStateNote(note);
}

export function renderSummaries() {
  const selectedDate = $("selectedDate").value;
  const ctx = getNowContext(selectedDate, state.uiState?.plannerMode || "auto");
  const schedules = getSchedulesForDate(selectedDate);
  const deadlines = getUpcomingTasks(selectedDate, 48, ctx);
  const pending = getPendingTasks(selectedDate, ctx);
  const { protectedBlocks, freeSlots } = computeRuleAwareFreeSlots(selectedDate, schedules, ctx);

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
    pending.length
      ? sortTasksForDisplay(pending, selectedDate).slice(0, 8).map((task) => `${task.title} / ${task.category || "分類なし"} / ${task.status}`)
      : []
  );
  fillSummary($("freeTimeSummary"), buildFreeTimeSummaryLines(protectedBlocks, freeSlots));
  fillSummary($("studyLocationSummary"), buildStudyLocationSummaryLines(selectedDate, ctx));
  fillSummary($("movementPlanSummary"), buildMovementPlanLines(selectedDate, schedules));

  const split = splitSchedulesByNow(schedules, ctx);
  fillSummary($("immediateScheduleSummary"), buildTimelineStatusLines(split).slice(0, 5));
}

export function renderAutoPlan() {
  const date = $("selectedDate").value;
  const fatigue = Number(state.dayConditions?.[date]?.fatigue ?? $("fatigue")?.value ?? 5);
  const plan = buildAutoPlan(date, null, false, fatigue);

  fillSummary($("autoTopThree"), plan.topThree);
  fillSummary($("autoTimeline"), plan.timeline);
  const protectedTail = plan.protectedSummary?.length ? ` / 時間防衛: ${plan.protectedSummary.join(" / ")}` : "";
  $("autoPlanNote").textContent = `${plan.note} / 集中ブロック: ${plan.focusSummary}${protectedTail}`;
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
  const { freeSlots } = computeRuleAwareFreeSlots(selectedDate, schedules, ctx);
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

function buildFreeTimeSummaryLines(protectedBlocks, freeSlots) {
  const lines = [];
  (protectedBlocks || []).forEach((block) => {
    lines.push(`守る / ${describeProtectedBlock(block)}`);
  });
  (freeSlots || []).forEach((slot) => {
    lines.push(`空き / ${slot.start} - ${slot.end} (${slot.minutes}分)`);
  });
  return lines.slice(0, 8);
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

function createTodayActionCard(task, score, slotMinutes, selectedDate) {
  const card = document.createElement("article");
  const effectiveStatus = getTaskEffectiveStatus(task, selectedDate);
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
    createActionMetaBadge(`状態:${effectiveStatus}`, effectiveStatus === "完了" ? "ok" : effectiveStatus === "進行中" ? "warn" : ""),
    createActionMetaBadge(`重要度:${task.importance}`, task.importance === "必須" ? "warn" : ""),
    createActionMetaBadge(`優先度:${task.priority}`, task.priority === "高" ? "danger" : task.priority === "中" ? "warn" : "blue"),
    createActionMetaBadge(`見積:${task.estimate || "?"}分`, "blue"),
    task.repeatDaily ? createActionMetaBadge("毎日", "blue") : null,
    task.deadlineDate ? createActionMetaBadge(`締切:${formatTaskDeadline(task)}`, getDeadlineVariant(task, selectedDate)) : null,
    task.protectTimeBlock ? createActionMetaBadge("保護", "ok") : null
  ].filter(Boolean).forEach((badge) => meta.appendChild(badge));

  const reason = document.createElement("p");
  reason.className = "today-action-card__reason";
  reason.textContent = buildActionReason(task, slotMinutes, selectedDate);

  const actions = document.createElement("div");
  actions.className = "today-action-card__actions";
  if (effectiveStatus !== "進行中") actions.appendChild(makeActionButton("着手", () => handlers.onQuickSetTaskStatus?.(task.id, "進行中")));
  if (effectiveStatus !== "完了") actions.appendChild(makeActionButton(task.repeatDaily ? "今日完了" : "完了", () => handlers.onQuickSetTaskStatus?.(task.id, "完了")));
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
  if (!task.deadlineDate || getTaskEffectiveStatus(task, selectedDate) === "完了") return "";
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
  if (task.repeatDaily) reasons.push(`毎日継続したいタスクです${task.estimate ? `（目安 ${task.estimate}分）` : ""}`);
  if (getTaskEffectiveStatus(task, selectedDate) === "進行中") reasons.push("すでに進行中なので、そのまま終わらせる候補です");
  if (task.protectTimeBlock) reasons.push("守るべき時間ブロックとして扱っています");
  if ((Number(task.estimate) || 60) <= slotMinutes) reasons.push(`いま見えている空き時間 ${slotMinutes}分 に収まりやすい見積です`);
  if (!reasons.length) reasons.push("重要度・優先度・空き時間のバランスから上位に来ています");
  return reasons[0];
}

function makeActionButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}
