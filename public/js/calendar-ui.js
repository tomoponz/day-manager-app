
import { state, saveState } from "./state.js";
import { buildProtectedTimeBlocks } from "./planner.js";
import { $ } from "./utils.js";
import { addDays, formatDateInput } from "./time.js";
import {
  googleState,
  hasValidGoogleToken,
  loadGoogleEventsRange,
  syncLocalEventToGoogle,
  syncUpdatedLocalEventToGoogle,
  deleteGoogleEventById,
  getErrorMessage
} from "./google-calendar.js";
const calendarHandlers = {
  openEventFormForCreate: null,
  populateEventForm: null,
  populateFixedForm: null,
  deleteEvent: null
};

export function configureCalendarUiHandlers(nextHandlers = {}) {
  Object.assign(calendarHandlers, nextHandlers);
}
import { showToast } from "./ui-feedback.js";

let calendar = null;
let initialized = false;
let suppressSelectedDateSync = false;
let lastRangeKey = "";
let lastDetailKey = "";

export function initializeCalendarUi() {
  if (initialized) return;
  initialized = true;

  const mount = $("calendarView");
  if (!mount || !window.FullCalendar) return;

  calendar = new FullCalendar.Calendar(mount, {
    locale: "ja",
    initialView: "timeGridWeek",
    firstDay: 1,
    nowIndicator: true,
    navLinks: true,
    selectable: true,
    editable: true,
    selectMirror: true,
    dayMaxEvents: true,
    height: "auto",
    expandRows: true,
    slotMinTime: "06:00:00",
    slotMaxTime: "24:00:00",
    allDaySlot: true,
    businessHours: {
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: "08:30",
      endTime: "18:30"
    },
    headerToolbar: {
      left: "prev,next today refreshGoogleButton",
      center: "title",
      right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek"
    },
    customButtons: {
      refreshGoogleButton: {
        text: "Google再読込",
        click: async () => {
          if (!hasValidGoogleToken()) {
            showToast("先に Google に接続してください。", { variant: "warn" });
            return;
          }
          lastRangeKey = "";
          await preloadGoogleRangeForCurrentView({ force: true, silent: false });
          calendar.refetchEvents();
        }
      }
    },
    views: {
      dayGridMonth: { buttonText: "月" },
      timeGridWeek: { buttonText: "週" },
      timeGridDay: { buttonText: "日" },
      listWeek: { buttonText: "一覧" }
    },
    eventSources: [
      async (fetchInfo, successCallback, failureCallback) => {
        try {
          await preloadGoogleRange(fetchInfo.start, fetchInfo.end, { silent: true });
          successCallback(buildCalendarEvents(fetchInfo.start, fetchInfo.end));
        } catch (error) {
          failureCallback(error);
        }
      }
    ],
    dateClick(info) {
      setSelectedDateFromCalendar(info.dateStr);
    },
    select(info) {
      setSelectedDateFromCalendar(info.startStr.slice(0, 10));
      seedEventFormFromSelection(info);
      calendarHandlers.openEventFormForCreate?.();
      showToast("単発予定フォームに時間帯を入れました。", { variant: "ok", duration: 1800 });
      calendar.unselect();
    },
    eventClick(info) {
      info.jsEvent.preventDefault();
      const sourceType = info.event.extendedProps.sourceType;
      renderCalendarDetail(info.event);
      if (sourceType === 'local-oneoff') {
        calendarHandlers.populateEventForm?.(info.event.extendedProps.entityId);
      } else if (sourceType === 'fixed') {
        calendarHandlers.populateFixedForm?.(info.event.extendedProps.entityId);
      }
    },
    eventDrop: async (info) => {
      try {
        await applyLocalEventMove(info.event);
      } catch (error) {
        info.revert();
        showToast(`予定の移動に失敗しました: ${getErrorMessage(error)}`, { variant: "warn", duration: 2600 });
      }
    },
    eventResize: async (info) => {
      try {
        await applyLocalEventMove(info.event);
      } catch (error) {
        info.revert();
        showToast(`予定の更新に失敗しました: ${getErrorMessage(error)}`, { variant: "warn", duration: 2600 });
      }
    },
    eventAllow(dropInfo, draggedEvent) {
      return draggedEvent.extendedProps?.sourceType === "local-oneoff";
    },
    datesSet: async (info) => {
      renderCalendarViewMeta(info.view);
      await preloadGoogleRange(info.start, info.end, { silent: true });
      renderCalendarConnectionMeta();
      if (!suppressSelectedDateSync) {
        const currentDate = formatDateInput(calendar.getDate());
        const selectedDateInput = $("selectedDate");
        if (selectedDateInput && selectedDateInput.value !== currentDate) {
          suppressSelectedDateSync = true;
          selectedDateInput.value = currentDate;
          selectedDateInput.dispatchEvent(new Event("change", { bubbles: true }));
          suppressSelectedDateSync = false;
          return;
        }
      }
      calendar.refetchEvents();
    }
  });

  calendar.render();
  renderCalendarConnectionMeta();
  ensureCalendarLegendPills();
  bindCalendarHelpers();
}

function bindCalendarHelpers() {
  const selectedDateInput = $("selectedDate");
  selectedDateInput?.addEventListener("change", () => {
    renderCalendarConnectionMeta();
  });
}

export function refreshCalendarUi() {
  if (!calendar) return;
  const selectedDate = $("selectedDate")?.value || formatDateInput(new Date());
  const currentDate = formatDateInput(calendar.getDate());
  if (currentDate !== selectedDate && !suppressSelectedDateSync) {
    suppressSelectedDateSync = true;
    calendar.gotoDate(selectedDate);
    suppressSelectedDateSync = false;
  }
  calendar.refetchEvents();
  renderCalendarConnectionMeta();
  ensureCalendarLegendPills();
}

export function resizeCalendarUi() {
  if (!calendar) return;
  calendar.updateSize();
}

export function renderCalendarConnectionMeta() {
  const target = $("calendarConnectionMeta");
  if (!target) return;
  if (!hasValidGoogleToken()) {
    target.textContent = "Google未接続 / ローカル予定のみ表示";
    return;
  }
  const syncText = googleState.lastBackgroundSyncAt
    ? ` / 最終同期 ${new Date(googleState.lastBackgroundSyncAt).toLocaleString("ja-JP")}`
    : "";
  target.textContent = `Google接続中${googleState.email ? ` (${googleState.email})` : ""}${syncText}`;
}

function renderCalendarViewMeta(view) {
  const target = $("calendarViewMeta");
  if (!target || !view) return;
  const map = {
    dayGridMonth: "月表示",
    timeGridWeek: "週表示",
    timeGridDay: "日表示",
    listWeek: "週一覧"
  };
  target.textContent = map[view.type] || view.type;
}

async function preloadGoogleRangeForCurrentView(options = {}) {
  if (!calendar) return [];
  const view = calendar.view;
  return preloadGoogleRange(view.activeStart, view.activeEnd, options);
}

async function preloadGoogleRange(start, endExclusive, { force = false, silent = true } = {}) {
  if (!hasValidGoogleToken()) return [];
  const startDate = formatDateInput(start);
  const inclusiveEndDate = formatDateInput(new Date(endExclusive.getTime() - 1));
  const key = `${startDate}:${inclusiveEndDate}`;
  if (!force && lastRangeKey === key) return [];

  const loading = $("calendarLoadingHint");
  if (loading) loading.textContent = "表示範囲の Google 予定を読み込み中…";
  await loadGoogleEventsRange(startDate, inclusiveEndDate, { silent, skipRerender: true });
  lastRangeKey = key;
  if (loading) loading.textContent = "表示範囲の Google 予定を読み込みながら描画します。";
  return [];
}

function buildCalendarEvents(fetchStart, fetchEndExclusive) {
  const startDate = formatDateInput(fetchStart);
  const endDate = formatDateInput(new Date(fetchEndExclusive.getTime() - 1));
  return [
    ...buildProtectedRuleEvents(startDate, endDate),
    ...buildFixedScheduleEvents(startDate, endDate),
    ...buildLocalOneOffEvents(startDate, endDate),
    ...buildGoogleEvents(startDate, endDate),
    ...buildPlanningDraftEvents(startDate, endDate)
  ];
}

function buildFixedScheduleEvents(startDate, endDate) {
  const results = [];
  for (const dateStr of enumerateDateRange(startDate, endDate)) {
    const weekday = new Date(`${dateStr}T00:00:00`).getDay();
    for (const item of state.fixedSchedules) {
      if (Number(item.weekday) !== weekday) continue;
      if (!item.start || !item.end) continue;
      results.push({
        id: `fixed:${item.id}:${dateStr}`,
        title: item.title,
        start: `${dateStr}T${item.start}:00`,
        end: `${dateStr}T${item.end}:00`,
        classNames: ["fc-day-manager-fixed"],
        editable: false,
        extendedProps: {
          sourceType: "fixed",
          entityId: item.id,
          note: item.note || "",
          dateStr
        }
      });
    }
  }
  return results;
}

function buildLocalOneOffEvents(startDate, endDate) {
  return state.oneOffEvents
    .filter((item) => item.date >= startDate && item.date <= endDate)
    .map((item) => {
      const classNames = ["fc-day-manager-local"];
      if (item.googleEventId) classNames.push("fc-day-manager-linked");
      return {
        id: `local-oneoff:${item.id}`,
        title: item.title,
        start: item.allDay ? item.date : `${item.date}T${item.start || "00:00"}:00`,
        end: item.allDay
          ? addDays(item.date, 1)
          : `${item.date}T${item.end || item.start || "00:00"}:00`,
        allDay: Boolean(item.allDay),
        editable: true,
        classNames,
        extendedProps: {
          sourceType: "local-oneoff",
          entityId: item.id,
          note: item.note || "",
          googleEventId: item.googleEventId || "",
          syncStatus: item.googleSyncStatus || "local"
        }
      };
    });
}

function buildProtectedRuleEvents(startDate, endDate) {
  const results = [];
  for (const dateStr of enumerateDateRange(startDate, endDate)) {
    const schedules = getSchedulesForDateForCalendar(dateStr);
    const blocks = buildProtectedTimeBlocks(dateStr, schedules);
    for (const block of blocks) {
      if (!block.start || !block.end) continue;
      results.push({
        id: `protected:${block.kind}:${dateStr}:${block.start}:${block.end}`,
        title: block.title,
        start: `${dateStr}T${block.start}:00`,
        end: `${dateStr}T${block.end}:00`,
        display: "background",
        overlap: false,
        classNames: [
          "fc-day-manager-protected",
          `fc-day-manager-protected-${block.kind}`
        ],
        editable: false,
        extendedProps: {
          sourceType: "protected",
          entityId: block.id,
          protectedKind: block.kind,
          note: block.note || "",
          protectedTitle: block.title,
          dateStr
        }
      });
    }
  }
  return results;
}

function buildPlanningDraftEvents(startDate, endDate) {
  return (state.planningDrafts || [])
    .filter((item) => ["draft", "failed"].includes(item.status))
    .filter((item) => item.targetDate && item.targetDate >= startDate && item.targetDate <= endDate)
    .map((item) => ({
      id: `draft:${item.id}`,
      title: item.title,
      start: item.allDay ? item.targetDate : `${item.targetDate}T${item.start || "00:00"}:00`,
      end: item.allDay ? addDays(item.targetDate, 1) : `${item.targetDate}T${item.end || item.start || "00:00"}:00`,
      allDay: Boolean(item.allDay),
      editable: false,
      classNames: ["fc-day-manager-draft", item.status === "failed" ? "fc-day-manager-draft-failed" : ""].filter(Boolean),
      extendedProps: {
        sourceType: "draft",
        entityId: item.id,
        note: buildDraftCalendarNote(item),
        draftStatus: item.status || "draft",
        draftReason: item.reason || ""
      }
    }));
}

function buildDraftCalendarNote(item) {
  const parts = [];
  if (item.note) parts.push(item.note);
  if (item.reason) parts.push(`AI理由: ${item.reason}`);
  parts.push(item.status === "failed" ? "追加失敗 / 再確認してから反映してください。" : "AI提案候補 / AI・連携から反映できます。");
  return parts.join(" / ");
}

function getSchedulesForDateForCalendar(dateStr) {
  if (!dateStr) return [];
  const dateObj = new Date(`${dateStr}T00:00:00`);
  const weekday = dateObj.getDay();

  const fixed = state.fixedSchedules
    .filter((item) => Number(item.weekday) === weekday)
    .map((item) => ({ ...item, type: "fixed", date: dateStr, allDay: false }));

  const oneOff = state.oneOffEvents
    .filter((item) => item.date === dateStr)
    .map((item) => ({ ...item, type: "event" }));

  const syncedIds = new Set(oneOff.map((item) => item.googleEventId).filter(Boolean));
  const googleSchedules = (googleState.eventsByDate?.[dateStr] || [])
    .filter((event) => !syncedIds.has(event.id))
    .map((event) => mapGoogleEventToSchedule(event, dateStr));

  return [...fixed, ...oneOff, ...googleSchedules].sort(compareCalendarSchedule);
}

function compareCalendarSchedule(a, b) {
  const allDayRankA = a.allDay ? 0 : 1;
  const allDayRankB = b.allDay ? 0 : 1;
  if (allDayRankA !== allDayRankB) return allDayRankA - allDayRankB;
  const aKey = `${a.start || "99:99"}${a.title}`;
  const bKey = `${b.start || "99:99"}${b.title}`;
  return aKey.localeCompare(bKey);
}

function buildGoogleEvents(startDate, endDate) {
  const linkedIds = new Set(state.oneOffEvents.map((item) => item.googleEventId).filter(Boolean));
  const results = [];
  for (const dateKey of Object.keys(googleState.eventsByDate || {})) {
    if (dateKey < startDate || dateKey > endDate) continue;
    for (const event of googleState.eventsByDate[dateKey] || []) {
      if (!event?.id || linkedIds.has(event.id)) continue;
      const allDay = Boolean(event.start?.date && !event.start?.dateTime);
      results.push({
        id: `google:${event.id}`,
        title: event.summary || "Google予定",
        start: allDay ? event.start?.date : event.start?.dateTime,
        end: allDay ? event.end?.date : event.end?.dateTime,
        allDay,
        editable: false,
        classNames: ["fc-day-manager-google"],
        extendedProps: {
          sourceType: "google",
          entityId: event.id,
          note: event.description || "",
          googleRaw: event
        }
      });
    }
  }
  return results;
}

function enumerateDateRange(startDate, endDate) {
  const result = [];
  const cursor = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  while (cursor <= end) {
    result.push(formatDateInput(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function setSelectedDateFromCalendar(dateStr) {
  const selectedDateInput = $("selectedDate");
  if (!selectedDateInput) return;
  if (selectedDateInput.value === dateStr) return;
  suppressSelectedDateSync = true;
  selectedDateInput.value = dateStr;
  selectedDateInput.dispatchEvent(new Event("change", { bubbles: true }));
  suppressSelectedDateSync = false;
}

function seedEventFormFromSelection(selection) {
  const form = $("eventForm");
  if (!form) return;
  form.elements.date.value = selection.startStr.slice(0, 10);
  const allDay = Boolean(selection.allDay);
  form.elements.allDay.checked = allDay;
  if (allDay) {
    form.elements.start.value = "";
    form.elements.end.value = "";
  } else {
    form.elements.start.value = toTimeValue(selection.start);
    form.elements.end.value = toTimeValue(selection.end || new Date(selection.start.getTime() + 60 * 60 * 1000));
  }
}

function toTimeValue(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

async function applyLocalEventMove(fcEvent) {
  if (fcEvent.extendedProps?.sourceType !== "local-oneoff") return;
  const entityId = fcEvent.extendedProps.entityId;
  const item = state.oneOffEvents.find((entry) => entry.id === entityId);
  if (!item) return;

  item.allDay = Boolean(fcEvent.allDay);
  item.date = formatDateInput(fcEvent.start);
  if (fcEvent.allDay) {
    item.start = "";
    item.end = "";
  } else {
    item.start = toTimeValue(fcEvent.start);
    item.end = fcEvent.end ? toTimeValue(fcEvent.end) : toTimeValue(new Date(fcEvent.start.getTime() + 60 * 60 * 1000));
  }

  if (item.googleEventId) {
    item.googleSyncStatus = "outdated";
  }

  saveState();
  if (item.googleEventId && hasValidGoogleToken()) {
    try {
      await syncUpdatedLocalEventToGoogle(item.id);
    } catch {}
  }
  renderCalendarDetail(fcEvent);
  showToast("予定の日時を更新しました。", { variant: "ok", duration: 1800 });
}

function ensureCalendarLegendPills() {
  const row = document.querySelector(".calendar-legend-row");
  if (!row) return;

  const defs = [
    ["legend-pill-lunch", "昼休み候補"],
    ["legend-pill-break", "休憩候補"],
    ["legend-pill-focus", "集中時間候補"],
    ["legend-pill-draft", "AI提案候補"]
  ];

  defs.forEach(([className, label]) => {
    if (row.querySelector(`.${className}`)) return;
    const pill = document.createElement("span");
    pill.className = `legend-pill ${className}`;
    pill.textContent = label;
    row.appendChild(pill);
  });
}

function renderCalendarDetail(fcEvent) {
  const detail = $("calendarDetail");
  if (!detail || !fcEvent) return;
  const sourceType = fcEvent.extendedProps?.sourceType || "unknown";
  const key = `${sourceType}:${fcEvent.id}`;
  lastDetailKey = key;

  const note = fcEvent.extendedProps?.note || "";
  const timeText = fcEvent.allDay
    ? "終日"
    : `${fcEvent.start ? fcEvent.start.toLocaleString("ja-JP") : ""}${fcEvent.end ? ` 〜 ${fcEvent.end.toLocaleString("ja-JP")}` : ""}`;
  const editorHint = (sourceType === "local-oneoff" || sourceType === "fixed")
    ? '<p class="calendar-detail-hint">この予定は右側の編集パネルでそのまま更新できます。</p>'
    : "";

  detail.className = "calendar-detail";
  detail.innerHTML = `
    <div class="calendar-detail-head">
      <strong>${escapeHtml(fcEvent.title || "無題")}</strong>
      <span class="calendar-detail-source source-${escapeHtml(sourceType)}">${getSourceLabel(sourceType)}</span>
    </div>
    <div class="calendar-detail-meta">${escapeHtml(timeText || "時刻情報なし")}</div>
    <div class="calendar-detail-note">${note ? escapeHtml(note) : "補足はありません。"}</div>
    ${editorHint}
    <div class="calendar-detail-actions" id="calendarDetailActions"></div>
  `;

  const actions = $("calendarDetailActions");
  if (!actions) return;

  if (sourceType === "local-oneoff") {
    actions.appendChild(makeActionButton("編集パネルで開く", () => calendarHandlers.populateEventForm?.(fcEvent.extendedProps.entityId), "primary"));
    actions.appendChild(makeActionButton("削除", async () => {
      await calendarHandlers.deleteEvent?.(fcEvent.extendedProps.entityId);
      detail.className = "calendar-detail empty";
      detail.textContent = "予定をクリックすると詳細を表示します。";
    }));
    if (fcEvent.extendedProps.googleEventId) {
      actions.appendChild(makeActionButton("Google更新", async () => {
        await syncUpdatedLocalEventToGoogle(fcEvent.extendedProps.entityId);
      }));
    } else if (hasValidGoogleToken()) {
      actions.appendChild(makeActionButton("Google追加", async () => {
        await syncLocalEventToGoogle(fcEvent.extendedProps.entityId);
      }));
    }
    return;
  }

  if (sourceType === "fixed") {
    actions.appendChild(makeActionButton("編集パネルで開く", () => calendarHandlers.populateFixedForm?.(fcEvent.extendedProps.entityId), "primary"));
    return;
  }

  if (sourceType === "google") {
    actions.appendChild(makeActionButton("この日を表示", () => setSelectedDateFromCalendar((fcEvent.startStr || "").slice(0, 10)), "primary"));
    actions.appendChild(makeActionButton("Googleから削除", async () => {
      await deleteGoogleEventById(fcEvent.extendedProps.entityId, { removeLocalMirror: false, silent: false });
      detail.className = "calendar-detail empty";
      detail.textContent = "予定をクリックすると詳細を表示します。";
      calendar?.refetchEvents();
    }));
    return;
  }

  if (sourceType === "draft") {
    actions.appendChild(makeActionButton("この日を表示", () => setSelectedDateFromCalendar((fcEvent.startStr || "").slice(0, 10)), "primary"));
    actions.appendChild(makeActionButton("AI・連携を開く", () => {
      document.getElementById("assistToolsPanel")?.setAttribute("open", "");
      window.workspaceNavApi?.openUtilityPanel?.("assistToolsPanel");
    }));
    return;
  }

  if (sourceType === "protected") {
    actions.appendChild(makeActionButton("この日を表示", () => setSelectedDateFromCalendar((fcEvent.startStr || "").slice(0, 10)), "primary"));
  }
}

function getSourceLabel(sourceType) {
  return {
    "local-oneoff": "ローカル単発予定",
    fixed: "固定予定",
    google: "Google予定",
    draft: "AI提案候補",
    protected: "時間防衛候補"
  }[sourceType] || sourceType;
}

function makeActionButton(label, handler, variant = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (variant) button.className = variant;
  button.addEventListener("click", handler);
  return button;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
