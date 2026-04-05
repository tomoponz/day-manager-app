import { state } from "./state.js";
import {
  hasValidGoogleToken,
  getCachedGoogleEvents,
  formatGoogleEventTime
} from "./google-calendar.js";
import { $ } from "./utils.js";
import { WEEKDAY_NAMES, getNowContext, formatDateInput } from "./time.js";
import { getTaskEffectiveStatus, sortTasksForDisplay } from "./task-utils.js";
import {
  getVisibleOneOffEvents,
  isCleanupCandidateEvent,
  collectKnownPlaceNames,
  resolvePlaceName,
  sortTravelRoutesForDisplay,
  getTravelMethodLabel,
  parseTimetableEntries,
  describeTimetableMode
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

export function configureListRenderHandlers(nextHandlers = {}) {
  Object.assign(handlers, nextHandlers);
}

function getTaskSelectedDate() {
  return $("selectedDate")?.value || formatDateInput(new Date());
}

function normalizeSearchText(value) {
  return String(value || "").trim().toLowerCase();
}

function getExecutionSearchQuery() {
  return normalizeSearchText(state.uiState?.listSearchQuery || "");
}

function matchesExecutionSearch(parts = []) {
  const query = getExecutionSearchQuery();
  if (!query) return true;
  const haystack = parts.map((part) => normalizeSearchText(part)).filter(Boolean).join(" ");
  return haystack.includes(query);
}

function renderSearchEmptyState(container) {
  renderEmptyState(container, {
    message: "検索条件に一致する項目がありません。語句を変えるか、検索をクリアしてください。"
  });
}

export function hydrateExecutionSearchUi() {
  const input = $("executionSearchInput");
  const clearButton = $("clearExecutionSearchBtn");
  const query = state.uiState?.listSearchQuery || "";
  if (input && input.value !== query) input.value = query;
  if (clearButton) clearButton.hidden = !query;
}

export function renderExecutionSearchMeta() {
  const meta = $("executionSearchMeta");
  if (!meta) return;

  const query = getExecutionSearchQuery();
  if (!query) {
    meta.textContent = "固定予定・単発予定・タスクをまとめて絞り込めます。";
    return;
  }

  const fixedItems = [...state.fixedSchedules].filter((item) => matchesExecutionSearch([
    item.title,
    item.note,
    resolvePlaceName(item.placeId, item.placeName),
    WEEKDAY_NAMES[item.weekday],
    item.start,
    item.end
  ]));

  const eventItems = [...getVisibleOneOffEvents(state.oneOffEvents)].filter((item) => matchesExecutionSearch([
    item.title,
    item.note,
    item.date,
    item.start,
    item.end,
    resolvePlaceName(item.placeId, item.placeName),
    getLocalEventSyncLabel(item)
  ]));

  const selectedDate = getTaskSelectedDate();
  const taskItems = sortTasksForDisplay(state.tasks, selectedDate).filter((item) => matchesExecutionSearch([
    item.title,
    item.category,
    item.note,
    item.deadlineDate,
    item.deadlineTime,
    item.priority,
    item.importance,
    getTaskEffectiveStatus(item, selectedDate)
  ]));

  meta.textContent = `検索中: 固定 ${fixedItems.length}件 / 単発 ${eventItems.length}件 / タスク ${taskItems.length}件`;
}

export function renderFixedSchedules() {
  const wrap = $("fixedList");
  if (!wrap) return;
  wrap.innerHTML = "";

  const sourceItems = [...state.fixedSchedules].sort(
    (a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start)
  );
  const items = sourceItems.filter((item) => matchesExecutionSearch([
    item.title,
    item.note,
    resolvePlaceName(item.placeId, item.placeName),
    WEEKDAY_NAMES[item.weekday],
    item.start,
    item.end
  ]));

  if (!sourceItems.length) {
    renderEmptyState(wrap, {
      message: "固定予定がまだありません。まずは授業や通学などの毎週予定を入れると判断が安定します。",
      primaryLabel: "＋ 固定予定を追加する",
      onPrimary: () => handlers.onCreateFixed?.()
    });
    return;
  }

  if (!items.length) {
    renderSearchEmptyState(wrap);
    return;
  }

  wrap.className = "list-wrap";
  items.forEach((item) => {
    const placeName = resolvePlaceName(item.placeId, item.placeName);
    wrap.appendChild(
      createListItem({
        title: item.title,
        badges: [
          makeBadge("毎週固定", "ok"),
          makeBadge(`${WEEKDAY_NAMES[item.weekday]}曜日`),
          makeBadge(`${item.start} - ${item.end}`, "blue"),
          placeName ? makeBadge(`場所:${placeName}`) : null
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
  if (!wrap) return;
  wrap.innerHTML = "";

  const sourceItems = [...getVisibleOneOffEvents(state.oneOffEvents)].sort((a, b) =>
    `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`)
  );
  const items = sourceItems.filter((item) => matchesExecutionSearch([
    item.title,
    item.note,
    item.date,
    item.start,
    item.end,
    resolvePlaceName(item.placeId, item.placeName),
    getLocalEventSyncLabel(item)
  ]));

  if (!sourceItems.length) {
    renderEmptyState(wrap, {
      message: "単発予定がまだありません。面談・外出・締切などを足すと、その日の重さが見えやすくなります。",
      primaryLabel: "＋ 単発予定を追加する",
      onPrimary: () => handlers.onCreateEvent?.()
    });
    return;
  }

  if (!items.length) {
    renderSearchEmptyState(wrap);
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

    const placeName = resolvePlaceName(item.placeId, item.placeName);
    wrap.appendChild(
      createListItem({
        title: item.title,
        badges: [
          makeBadge(item.date),
          makeBadge(timeLabel, item.allDay ? "ok" : "blue"),
          placeName ? makeBadge(`場所:${placeName}`) : null,
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
  if (!wrap) return;
  wrap.innerHTML = "";

  const selectedDate = getTaskSelectedDate();
  const sourceItems = sortTasksForDisplay(state.tasks, selectedDate);
  const items = sourceItems.filter((item) => matchesExecutionSearch([
    item.title,
    item.category,
    item.note,
    item.deadlineDate,
    item.deadlineTime,
    item.priority,
    item.importance,
    getTaskEffectiveStatus(item, selectedDate)
  ]));

  if (!sourceItems.length) {
    renderEmptyState(wrap, {
      message: "タスクがまだありません。1件だけでも入れると、今日の最優先候補を出せます。",
      primaryLabel: "＋ タスクを追加する",
      onPrimary: () => handlers.onCreateTask?.()
    });
    return;
  }

  if (!items.length) {
    renderSearchEmptyState(wrap);
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
    if (item.repeatDaily) detailParts.push("毎日継続");
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

export function updateKnownPlaceSuggestions() {
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
  if (!wrap) return;
  wrap.innerHTML = "";

  const date = $("selectedDate")?.value;
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

function getStudyLocationStatus(location, selectedDate, ctx) {
  const hoursSource = getStudyLocationHoursSource(location, selectedDate);
  const spec = parseStudyLocationHours(hoursSource);
  const checkedAtLabel = formatStudyLocationCheckedAt(hoursSource.checkedAt);
  const noteLabel = hoursSource.note || "";
  const sourceLabel = hoursSource.isChecked
    ? "確認済み"
    : hoursSource.isException
      ? "例外日"
      : "要確認";

  if (spec.type === "unset") {
    return { statusLabel: "時間未設定", variant: "", hoursLabel: "", remainingLabel: "", isChecked: Boolean(hoursSource.isChecked), sourceLabel, checkedAtLabel, noteLabel };
  }
  if (spec.type === "closed") {
    return { statusLabel: hoursSource?.isException && !hoursSource.isChecked ? "例外休館" : "休館", variant: "danger", hoursLabel: "休館", remainingLabel: "", isChecked: Boolean(hoursSource.isChecked), sourceLabel, checkedAtLabel, noteLabel };
  }
  if (spec.type === "custom") {
    return { statusLabel: "要確認", variant: "warn", hoursLabel: spec.raw, remainingLabel: "", isChecked: Boolean(hoursSource.isChecked), sourceLabel, checkedAtLabel, noteLabel };
  }

  const hoursLabel = `${spec.open} - ${spec.close}`;
  if (!ctx?.isToday || selectedDate !== formatDateInput(ctx.now || new Date())) {
    return { statusLabel: "利用可", variant: "ok", hoursLabel, remainingLabel: "", isChecked: Boolean(hoursSource.isChecked), sourceLabel, checkedAtLabel, noteLabel };
  }

  const nowMinutes = (ctx.now?.getHours?.() || 0) * 60 + (ctx.now?.getMinutes?.() || 0);
  const openMinutes = toMinutes(spec.open);
  const closeMinutes = toMinutes(spec.close);

  if (nowMinutes < openMinutes) {
    return { statusLabel: "開館前", variant: "warn", hoursLabel, remainingLabel: `あと ${formatMinutes(openMinutes - nowMinutes)} で開館`, isChecked: Boolean(hoursSource.isChecked), sourceLabel, checkedAtLabel, noteLabel };
  }
  if (nowMinutes >= closeMinutes) {
    return { statusLabel: "閉館後", variant: "danger", hoursLabel, remainingLabel: "", isChecked: Boolean(hoursSource.isChecked), sourceLabel, checkedAtLabel, noteLabel };
  }
  return { statusLabel: "営業中", variant: "ok", hoursLabel, remainingLabel: `残り ${formatMinutes(closeMinutes - nowMinutes)}`, isChecked: Boolean(hoursSource.isChecked), sourceLabel, checkedAtLabel, noteLabel };
}

function getStudyLocationHoursSource(location, selectedDate) {
  const check = getStudyLocationDateCheck(location, selectedDate);
  if (check) {
    if (check.status === "checked_closed") {
      return { value: "休館", isException: true, isChecked: true, checkedAt: check.checkedAt, note: check.note || "" };
    }
    if (check.overrideHours) {
      return { value: check.overrideHours, isException: true, isChecked: true, checkedAt: check.checkedAt, note: check.note || "" };
    }
    const scheduled = getScheduledStudyLocationHoursSource(location, selectedDate);
    return { ...scheduled, isChecked: true, checkedAt: check.checkedAt, note: check.note || scheduled.note || "" };
  }
  return getScheduledStudyLocationHoursSource(location, selectedDate);
}

function getStudyLocationDateCheck(location, selectedDate) {
  const source = location?.checksByDate && typeof location.checksByDate === "object" ? location.checksByDate : {};
  const raw = source?.[selectedDate];
  if (!raw || typeof raw !== "object") return null;
  return {
    status: String(raw.status || ""),
    overrideHours: String(raw.overrideHours || "").trim(),
    checkedAt: String(raw.checkedAt || ""),
    note: String(raw.note || "").trim()
  };
}

function getScheduledStudyLocationHoursSource(location, selectedDate) {
  const exceptionText = String(location?.exceptionsText || "");
  const lines = exceptionText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^(\d{4}-\d{2}-\d{2})[\s　]+(.+)$/);
    if (match && match[1] === selectedDate) {
      return { value: match[2].trim(), isException: true, isChecked: false, checkedAt: "", note: "" };
    }
  }
  const weekday = new Date(`${selectedDate}T00:00:00`).getDay();
  return { value: location?.weeklyHours?.[String(weekday)] || "", isException: false, isChecked: false, checkedAt: "", note: "" };
}

function parseStudyLocationHours(source) {
  const raw = String(source?.value || "").trim();
  if (!raw) return { type: "unset" };
  const compact = raw.replace(/[〜～‐‑‒–—―ー]/g, "-").replace(/\s+/g, "");
  if (/^(休館|closed)$/i.test(compact)) return { type: "closed" };
  const match = compact.match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
  if (!match) return { type: "custom", open: "", close: "", raw };
  return { type: "range", open: normalizeClockText(match[1]), close: normalizeClockText(match[2]) };
}

function normalizeClockText(value) {
  const [hour, minute] = String(value).split(":");
  return `${String(Number(hour)).padStart(2, "0")}:${minute}`;
}

function toMinutes(value) {
  const [hour, minute] = String(value).split(":").map(Number);
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
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function getStudyLocationKindLabel(kind) {
  return ({
    university_library: "大学図書館",
    pref_library: "県立図書館",
    city_library: "市立図書館",
    cafe: "カフェ",
    home: "自宅",
    other: "その他"
  })[kind] || "自習場所";
}

function buildStudyLocationExceptionNote(location, selectedDate) {
  const lines = String(location?.exceptionsText || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const hit = lines.find((line) => line.startsWith(`${selectedDate} `));
  if (hit) return `例外日: ${hit}`;
  return "";
}

function createListItem({ title, badges = [], detail = "", note, actions, itemClassName = "" }) {
  const template = $("listItemTemplate");
  if (!template) {
    const article = document.createElement("article");
    article.className = `list-item ${itemClassName}`.trim();
    article.textContent = title;
    return article;
  }
  const tpl = template.content.cloneNode(true);
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
  const noteEl = tpl.querySelector(".item-note");
  if (noteEl) noteEl.textContent = note || "";

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
