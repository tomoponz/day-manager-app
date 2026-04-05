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
  computeRuleAwareFreeSlots,
  buildProtectedTimeBlocks,
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
import {
  getVisibleOneOffEvents,
  isCleanupCandidateEvent,
  collectKnownPlaceNames,
  buildMovementPlanLines,
  sortTravelRoutesForDisplay,
  getTravelMethodLabel,
  parseTimetableEntries,
  describeTimetableMode,
  resolvePlaceName
} from "./travel.js";

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
}



function getTaskSelectedDate() {
  return $("selectedDate")?.value || formatDateInput(new Date());
}

function isTaskCompletedOnDate(task, dateStr = getTaskSelectedDate()) {
  return Boolean(task.repeatDaily && Array.isArray(task.completedDates) && task.completedDates.includes(dateStr));
}

function getTaskEffectiveStatus(task, dateStr = getTaskSelectedDate()) {
  if (isTaskCompletedOnDate(task, dateStr)) return "完了";
  if (task.repeatDaily && task.status === "完了") return "未着手";
  return task.status || "未着手";
}

function sortTasksForDisplay(items = [], dateStr = getTaskSelectedDate()) {
  const priorityOrder = { 高: 0, 中: 1, 低: 2 };
  const statusRank = { 未着手: 0, 進行中: 1, 完了: 2 };
  const importanceRank = { 必須: 0, できれば: 1, 後回し: 2 };

  return [...items].sort((a, b) => {
    const statusA = getTaskEffectiveStatus(a, dateStr);
    const statusB = getTaskEffectiveStatus(b, dateStr);
    if (statusRank[statusA] !== statusRank[statusB]) {
      return statusRank[statusA] - statusRank[statusB];
    }
    if (importanceRank[a.importance] !== importanceRank[b.importance]) {
      return importanceRank[a.importance] - importanceRank[b.importance];
    }
    const deadlineA = `${a.deadlineDate || "9999-99-99"} ${a.deadlineTime || "99:99"}`;
    const deadlineB = `${b.deadlineDate || "9999-99-99"} ${b.deadlineTime || "99:99"}`;
    if (deadlineA !== deadlineB) return deadlineA.localeCompare(deadlineB);
    return (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99);
  });
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
  renderTodayHub();
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
          makeBadge(`${item.start} - ${item.end}`, "blue"),
          resolvePlaceName(item.placeId, item.placeName) ? makeBadge(`場所:${resolvePlaceName(item.placeId, item.placeName)}`) : null
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

  const items = [...getVisibleOneOffEvents(state.oneOffEvents)].sort((a, b) =>
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

    if (isCleanupCandidateEvent(item)) {
      actions.push(makeActionButton("片付ける", () => handlers.onDismissEvent?.(item.id)));
    }
    actions.push(makeDeleteButton(() => handlers.onDeleteEvent?.(item.id)));

    wrap.appendChild(
      createListItem({
        title: item.title,
        badges: [
          makeBadge(item.date),
          makeBadge(timeLabel, item.allDay ? "ok" : "blue"),
          resolvePlaceName(item.placeId, item.placeName) ? makeBadge(`場所:${resolvePlaceName(item.placeId, item.placeName)}`) : null,
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

  const selectedDate = getTaskSelectedDate();
  const items = sortTasksForDisplay(state.tasks, selectedDate);

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
      if (status === getTaskEffectiveStatus(item, selectedDate)) option.selected = true;
      statusSelect.appendChild(option);
    });

    statusSelect.addEventListener("change", () => handlers.onQuickSetTaskStatus?.(item.id, statusSelect.value));
    actions.push(statusSelect);

    const effectiveStatus = getTaskEffectiveStatus(item, selectedDate);

    if (effectiveStatus !== "進行中") {
      actions.push(makeActionButton("着手", () => handlers.onQuickSetTaskStatus?.(item.id, "進行中")));
    }
    if (effectiveStatus !== "完了") {
      actions.push(makeActionButton(item.repeatDaily ? "今日完了" : "完了", () => handlers.onQuickSetTaskStatus?.(item.id, "完了")));
    }

    actions.push(makeActionButton("明日", () => handlers.onDeferTaskToTomorrow?.(item.id)));
    actions.push(makeActionButton("編集", () => handlers.onEditTask?.(item.id)));
    actions.push(makeDeleteButton(() => handlers.onDeleteTask?.(item.id)));

    const deadlineText = item.deadlineDate
      ? `${item.deadlineDate}${item.deadlineTime ? ` ${item.deadlineTime}` : ""}`
      : item.repeatDaily
        ? "毎日継続"
        : "締切未設定";

    const itemClasses = ["task-item"];
    let deadlineVariant = "";

    if (item.priority === "高") itemClasses.push("priority-high");
    else if (item.priority === "中") itemClasses.push("priority-medium");
    else itemClasses.push("priority-low");

    if (effectiveStatus === "完了") itemClasses.push("is-completed");

    if (item.deadlineDate) {
      const overdue =
        item.deadlineDate < today ||
        (item.deadlineDate === today && item.deadlineTime && item.deadlineTime < currentTime && effectiveStatus !== "完了");
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
    if (item.repeatDaily) detailParts.push('毎日継続');
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
            `状態:${effectiveStatus}`,
            effectiveStatus === "完了" ? "ok" : effectiveStatus === "進行中" ? "warn" : ""
          ),
          makeBadge(`締切:${deadlineText}`, deadlineVariant),
          makeBadge(`見積:${item.estimate || "?"}分`),
          ...(item.repeatDaily ? [makeBadge("毎日", "blue")] : []),
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

export function renderStudyLocations() {
  const wrap = $("studyLocationList");
  if (!wrap) return;
  wrap.innerHTML = "";

  const items = sortStudyLocationsForDisplay(state.studyLocations || []);
  if (!items.length) {
    renderEmptyState(wrap, {
      message: "自習場所がまだありません。大学図書館や県立図書館の開館時間を入れると、今日どこで勉強するか判断しやすくなります。",
      primaryLabel: "＋ 自習場所を追加する",
      onPrimary: () => handlers.onCreateStudyLocation?.()
    });
    return;
  }

  const selectedDate = $("selectedDate")?.value || formatDateInput(new Date());
  const ctx = getNowContext(selectedDate, state.uiState?.plannerMode || "auto");
  wrap.className = "list-wrap";

  items.forEach((item) => {
    const status = getStudyLocationStatus(item, selectedDate, ctx);
    const detailParts = [];
    if (status.hoursLabel) detailParts.push(`開館: ${status.hoursLabel}`);
    if (Number.isFinite(Number(item.travelMinutes)) && String(item.travelMinutes) !== "") {
      detailParts.push(`移動: ${item.travelMinutes}分`);
    }
    if (status.checkedAtLabel) detailParts.push(`確認: ${status.checkedAtLabel}`);

    const actions = [];
    if (item.sourceUrl) actions.push(makeActionButton("公式", () => handlers.onOpenStudyLocationSourceUrl?.(item.id)));
    actions.push(makeActionButton("確認済", () => handlers.onMarkStudyLocationCheckedOpen?.(item.id)));
    actions.push(makeActionButton("休館", () => handlers.onMarkStudyLocationCheckedClosed?.(item.id)));
    actions.push(makeActionButton("短縮", () => handlers.onMarkStudyLocationCheckedShortened?.(item.id)));
    if (status.isChecked) actions.push(makeActionButton("解除", () => handlers.onClearStudyLocationDateCheck?.(item.id)));
    actions.push(makeActionButton("編集", () => handlers.onEditStudyLocation?.(item.id)));
    actions.push(makeDeleteButton(() => handlers.onDeleteStudyLocation?.(item.id)));

    wrap.appendChild(createListItem({
      title: item.name,
      badges: [
        makeBadge(getStudyLocationKindLabel(item.kind)),
        makeBadge(status.statusLabel, status.variant),
        makeBadge(status.sourceLabel, status.isChecked ? "ok" : status.sourceLabel === "要確認" ? "warn" : ""),
        ...(item.isPreferred ? [makeBadge("優先候補", "ok")] : [])
      ],
      detail: detailParts.join(" / "),
      note: status.noteLabel || item.memo || buildStudyLocationExceptionNote(item, selectedDate),
      actions,
      itemClassName: "study-location-item"
    }));
  });
}

export function renderTravelRoutes() {
  const wrap = $("travelRouteList");
  if (!wrap) return;
  wrap.innerHTML = "";

  const items = sortTravelRoutesForDisplay(state.travelRoutes || []);
  if (!items.length) {
    renderEmptyState(wrap, {
      message: "場所どうしの移動時間やJR時刻表がまだありません。ルートを1本入れると、移動メモをAIに渡せます。",
      primaryLabel: "＋ 移動ルートを追加する",
      onPrimary: () => handlers.onCreateTravelRoute?.()
    });
    return;
  }

  wrap.className = "list-wrap";
  items.forEach((item) => {
    const departures = parseTimetableEntries(item.timetableText);
    const timetableLabel = departures.length ? `${describeTimetableMode(item)} / ${departures.length}本` : "時刻表なし";
    wrap.appendChild(
      createListItem({
        title: `${resolvePlaceName(item.fromPlaceId, item.fromPlace)} → ${resolvePlaceName(item.toPlaceId, item.toPlace)}`,
        badges: [
          makeBadge(getTravelMethodLabel(item.method), "blue"),
          item.durationMinutes !== "" ? makeBadge(`${item.durationMinutes}分`, "ok") : null,
          makeBadge(timetableLabel)
        ],
        detail: item.note || "",
        note: departures.length ? `時刻表: ${departures.slice(0, 6).join(" / ")}${departures.length > 6 ? " / ..." : ""}` : "",
        actions: [
          makeActionButton("編集", () => handlers.onEditTravelRoute?.(item.id)),
          makeDeleteButton(() => handlers.onDeleteTravelRoute?.(item.id))
        ],
        itemClassName: "travel-route-item"
      })
    );
  });
}

function updateKnownPlaceSuggestions() {
  const datalist = $("knownPlaceNames");
  if (!datalist) return;
  datalist.innerHTML = "";
  collectKnownPlaceNames().forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    datalist.appendChild(option);
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
      ? sortTasksForDisplay(pending).slice(0, 8).map((task) => `${task.title} / ${task.category || "分類なし"} / ${task.status}`)
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

function getLifecycleLabel(status) {
  return ({ active: "表示中", completed: "完了", hidden: "非表示", archived: "アーカイブ" })[status] || status || "表示中";
}

export function renderTodayHub() {
  const wrap = $("todayHubSummary");
  if (!wrap) return;

  const selectedDate = $("selectedDate")?.value;
  if (!selectedDate) {
    fillSummary(wrap, []);
    return;
  }

  const ctx = getNowContext(selectedDate, state.uiState?.plannerMode || "auto");
  const schedules = getSchedulesForDate(selectedDate);
  const split = splitSchedulesByNow(schedules, ctx);
  const nextSchedule = split.current[0] || split.upcoming[0] || null;
  const pending = sortTasksForDisplay(getPendingTasks(selectedDate, ctx), selectedDate).slice(0, 2);
  const movementLines = buildMovementPlanLines(selectedDate, schedules).slice(0, 2);
  const cleanupCount = getVisibleOneOffEvents(state.oneOffEvents).filter((item) => isCleanupCandidateEvent(item)).length;
  const draftCount = (state.planningDrafts || []).filter((item) => item.status === "draft" || item.status === "failed").length;

  const lines = [];
  if (nextSchedule) lines.push(`次: ${formatScheduleLine(nextSchedule)}`);
  pending.forEach((task, index) => lines.push(`優先${index + 1}: ${task.title}${task.deadlineDate ? ` / 締切:${task.deadlineDate}${task.deadlineTime ? ` ${task.deadlineTime}` : ''}` : ''}`));
  movementLines.forEach((line) => lines.push(`移動: ${line}`));
  if (cleanupCount) lines.push(`片付け候補: ${cleanupCount}件`);
  if (draftCount) lines.push(`AI提案: ${draftCount}件`);

  fillSummary(wrap, lines.slice(0, 6));
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

function getLocalEventSyncLabel(item) {
  if (item.googleEventId && item.googleSyncStatus === "outdated") return "Google要更新";
  if (item.googleEventId) return "Google同期済";
  if (item.googleSyncStatus === "failed") return "Google同期失敗";
  if (item.googleSyncStatus === "pending") return "Google未接続";
  return "ローカルのみ";
}

function sortStudyLocationsForDisplay(items = []) {
  return [...items].sort((a, b) => {
    if (Boolean(a.isPreferred) !== Boolean(b.isPreferred)) return Number(Boolean(b.isPreferred)) - Number(Boolean(a.isPreferred));
    const travelA = a.travelMinutes === "" ? 9999 : Number(a.travelMinutes || 9999);
    const travelB = b.travelMinutes === "" ? 9999 : Number(b.travelMinutes || 9999);
    if (travelA !== travelB) return travelA - travelB;
    return String(a.name || "").localeCompare(String(b.name || ""), "ja");
  });
}

function buildStudyLocationSummaryLines(selectedDate, ctx) {
  const items = sortStudyLocationsForDisplay(state.studyLocations || []);
  if (!items.length) return [];

  const rank = { '営業中': 0, '開館前': 1, '利用可': 2, '要確認': 3, '時間未設定': 4, '閉館後': 5, '休館': 6, '例外休館': 6 };
  return items
    .map((item) => ({ item, status: getStudyLocationStatus(item, selectedDate, ctx) }))
    .sort((a, b) => {
      const rankDiff = (rank[a.status.statusLabel] ?? 99) - (rank[b.status.statusLabel] ?? 99);
      if (rankDiff !== 0) return rankDiff;
      if (Boolean(a.status.isChecked) !== Boolean(b.status.isChecked)) return Number(Boolean(b.status.isChecked)) - Number(Boolean(a.status.isChecked));
      if (Boolean(a.item.isPreferred) !== Boolean(b.item.isPreferred)) return Number(Boolean(b.item.isPreferred)) - Number(Boolean(a.item.isPreferred));
      const travelA = a.item.travelMinutes === '' ? 9999 : Number(a.item.travelMinutes || 9999);
      const travelB = b.item.travelMinutes === '' ? 9999 : Number(b.item.travelMinutes || 9999);
      return travelA - travelB;
    })
    .slice(0, 6)
    .map(({ item, status }) => {
      const parts = [item.name, status.sourceLabel, status.statusLabel];
      if (status.hoursLabel) parts.push(status.hoursLabel);
      if (status.remainingLabel) parts.push(status.remainingLabel);
      if (String(item.travelMinutes || '').trim()) parts.push(`移動${item.travelMinutes}分`);
      return parts.join(' / ');
    });
}

function getStudyLocationStatus(location, selectedDate, ctx) {
  const hoursSource = getStudyLocationHoursSource(location, selectedDate);
  const spec = parseStudyLocationHours(hoursSource);
  const checkedAtLabel = formatStudyLocationCheckedAt(hoursSource.checkedAt);
  const noteLabel = hoursSource.note || '';
  const sourceLabel = hoursSource.isChecked
    ? '確認済み'
    : hoursSource.isException
      ? '例外日'
      : '要確認';

  if (spec.type === 'unset') {
    return { statusLabel: '時間未設定', variant: '', hoursLabel: '', remainingLabel: '', isChecked: Boolean(hoursSource.isChecked), sourceLabel, checkedAtLabel, noteLabel };
  }
  if (spec.type === 'closed') {
    return { statusLabel: hoursSource?.isException && !hoursSource.isChecked ? '例外休館' : '休館', variant: 'danger', hoursLabel: '休館', remainingLabel: '', isChecked: Boolean(hoursSource.isChecked), sourceLabel, checkedAtLabel, noteLabel };
  }
  if (spec.type === 'custom') {
    return { statusLabel: '要確認', variant: 'warn', hoursLabel: spec.raw, remainingLabel: '', isChecked: Boolean(hoursSource.isChecked), sourceLabel, checkedAtLabel, noteLabel };
  }

  const hoursLabel = `${spec.open} - ${spec.close}`;
  if (!ctx?.isToday || selectedDate !== formatDateInput(ctx.now || new Date())) {
    return { statusLabel: '利用可', variant: 'ok', hoursLabel, remainingLabel: '', isChecked: Boolean(hoursSource.isChecked), sourceLabel, checkedAtLabel, noteLabel };
  }

  const nowMinutes = (ctx.now?.getHours?.() || 0) * 60 + (ctx.now?.getMinutes?.() || 0);
  const openMinutes = toMinutes(spec.open);
  const closeMinutes = toMinutes(spec.close);

  if (nowMinutes < openMinutes) {
    return { statusLabel: '開館前', variant: 'warn', hoursLabel, remainingLabel: `あと ${formatMinutes(openMinutes - nowMinutes)} で開館`, isChecked: Boolean(hoursSource.isChecked), sourceLabel, checkedAtLabel, noteLabel };
  }
  if (nowMinutes >= closeMinutes) {
    return { statusLabel: '閉館後', variant: 'danger', hoursLabel, remainingLabel: '', isChecked: Boolean(hoursSource.isChecked), sourceLabel, checkedAtLabel, noteLabel };
  }
  return { statusLabel: '営業中', variant: 'ok', hoursLabel, remainingLabel: `残り ${formatMinutes(closeMinutes - nowMinutes)}`, isChecked: Boolean(hoursSource.isChecked), sourceLabel, checkedAtLabel, noteLabel };
}

function getStudyLocationHoursSource(location, selectedDate) {
  const check = getStudyLocationDateCheck(location, selectedDate);
  if (check) {
    if (check.status === 'checked_closed') {
      return { value: '休館', isException: true, isChecked: true, checkedAt: check.checkedAt, note: check.note || '' };
    }
    if (check.overrideHours) {
      return { value: check.overrideHours, isException: true, isChecked: true, checkedAt: check.checkedAt, note: check.note || '' };
    }
    const scheduled = getScheduledStudyLocationHoursSource(location, selectedDate);
    return { ...scheduled, isChecked: true, checkedAt: check.checkedAt, note: check.note || scheduled.note || '' };
  }
  return getScheduledStudyLocationHoursSource(location, selectedDate);
}

function getStudyLocationDateCheck(location, selectedDate) {
  const source = location?.checksByDate && typeof location.checksByDate === 'object' ? location.checksByDate : {};
  const raw = source?.[selectedDate];
  if (!raw || typeof raw !== 'object') return null;
  return {
    status: String(raw.status || ''),
    overrideHours: String(raw.overrideHours || '').trim(),
    checkedAt: String(raw.checkedAt || ''),
    note: String(raw.note || '').trim()
  };
}

function getScheduledStudyLocationHoursSource(location, selectedDate) {
  const exceptionText = String(location?.exceptionsText || '');
  const lines = exceptionText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^(\d{4}-\d{2}-\d{2})[\s　]+(.+)$/);
    if (match && match[1] === selectedDate) {
      return { value: match[2].trim(), isException: true, isChecked: false, checkedAt: '', note: '' };
    }
  }
  const weekday = new Date(`${selectedDate}T00:00:00`).getDay();
  return { value: location?.weeklyHours?.[String(weekday)] || '', isException: false, isChecked: false, checkedAt: '', note: '' };
}

function parseStudyLocationHours(source) {
  const raw = String(source?.value || '').trim();
  if (!raw) return { type: 'unset' };
  const compact = raw.replace(/[〜～‐‑‒–—―ー]/g, '-').replace(/\s+/g, '');
  if (/^(休館|closed)$/i.test(compact)) return { type: 'closed' };
  const match = compact.match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
  if (!match) return { type: 'custom', open: '', close: '', raw };
  return { type: 'range', open: normalizeClockText(match[1]), close: normalizeClockText(match[2]) };
}

function normalizeClockText(value) {
  const [hour, minute] = String(value).split(':');
  return `${String(Number(hour)).padStart(2, '0')}:${minute}`;
}

function toMinutes(value) {
  const [hour, minute] = String(value).split(':').map(Number);
  return hour * 60 + minute;
}

function formatMinutes(minutes) {
  const safe = Math.max(0, Number(minutes || 0));
  const hour = Math.floor(safe / 60);
  const minute = safe % 60;
  if (!hour) return `${minute}分`;
  if (!minute) return `${hour}時間`;
  return `${hour}時間${minute}分`;
}

function formatStudyLocationCheckedAt(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function getStudyLocationKindLabel(kind) {
  return ({
    university_library: '大学図書館',
    pref_library: '県立図書館',
    city_library: '市立図書館',
    cafe: 'カフェ',
    home: '自宅',
    other: 'その他'
  })[kind] || '自習場所';
}

function buildStudyLocationExceptionNote(location, selectedDate) {
  const lines = String(location?.exceptionsText || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const hit = lines.find((line) => line.startsWith(`${selectedDate} `));
  if (hit) return `例外日: ${hit}`;
  return '';
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
