export const STORAGE_KEY = "day-manager-v1";
export const GOOGLE_CONFIG_KEY = "day-manager-google-config-v1";
export const STATE_SCHEMA_VERSION = 2;

export const INITIAL_STATE = {
  schemaVersion: STATE_SCHEMA_VERSION,
  fixedSchedules: [],
  oneOffEvents: [],
  tasks: [],
  courses: [],
  materials: [],
  assessments: [],
  dayConditions: {},
  weeklyPlans: {},
  milestones: [],
  planningDrafts: [],
  settings: {
    focusMinutesTarget: 180,
    bufferMinutes: 10
  },
  uiState: {
    plannerMode: "auto"
  }
};

export const state = loadState();

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(INITIAL_STATE);
    const parsed = migrateParsedState(JSON.parse(raw));
    return {
      schemaVersion: STATE_SCHEMA_VERSION,
      fixedSchedules: (parsed.fixedSchedules || []).map(normalizeFixedSchedule),
      oneOffEvents: (parsed.oneOffEvents || []).map(normalizeOneOffEvent),
      tasks: (parsed.tasks || []).map(normalizeTask),
      courses: (parsed.courses || []).map(normalizeCourse),
      materials: (parsed.materials || []).map(normalizeMaterial),
      assessments: (parsed.assessments || []).map(normalizeAssessment),
      dayConditions: parsed.dayConditions || {},
      weeklyPlans: normalizeWeeklyPlans(parsed.weeklyPlans),
      milestones: (parsed.milestones || []).map(normalizeMilestone),
      planningDrafts: (parsed.planningDrafts || []).map(normalizePlanningDraft),
      settings: {
        focusMinutesTarget: Number(parsed.settings?.focusMinutesTarget ?? INITIAL_STATE.settings.focusMinutesTarget),
        bufferMinutes: Number(parsed.settings?.bufferMinutes ?? INITIAL_STATE.settings.bufferMinutes)
      },
      uiState: {
        plannerMode: parsed.uiState?.plannerMode || "auto"
      }
    };
  } catch {
    return structuredClone(INITIAL_STATE);
  }
}

export function saveState() {
  state.schemaVersion = STATE_SCHEMA_VERSION;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function loadGoogleConfig() {
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

export function saveGoogleConfig(config) {
  localStorage.setItem(GOOGLE_CONFIG_KEY, JSON.stringify(config));
}

export function normalizeFixedSchedule(item) {
  return {
    id: item.id || crypto.randomUUID(),
    title: item.title || "",
    weekday: Number(item.weekday ?? 0),
    start: item.start || "",
    end: item.end || "",
    note: item.note || ""
  };
}

export function normalizeOneOffEvent(item) {
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

export function normalizeTask(item) {
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
    status: item.status || "未着手",
    deferUntilDate: item.deferUntilDate || "",
    protectTimeBlock: Boolean(item.protectTimeBlock)
  };
}

function normalizeOptionalNumber(value) {
  if (value === "" || value === null || typeof value === "undefined") return "";
  const number = Number(value);
  return Number.isFinite(number) ? number : "";
}

export function normalizeCourse(item) {
  return {
    id: item.id || crypto.randomUUID(),
    title: item.title || "",
    instructor: item.instructor || "",
    credits: normalizeOptionalNumber(item.credits),
    scheduleMemo: item.scheduleMemo || "",
    gradingMemo: item.gradingMemo || "",
    riskStatus: item.riskStatus || "medium",
    note: item.note || ""
  };
}

export function normalizeMaterial(item) {
  return {
    id: item.id || crypto.randomUUID(),
    courseId: item.courseId || "",
    title: item.title || "",
    kind: item.kind || "textbook",
    totalUnits: normalizeOptionalNumber(item.totalUnits),
    currentUnits: normalizeOptionalNumber(item.currentUnits),
    unitLabel: item.unitLabel || "p",
    understanding: normalizeOptionalNumber(item.understanding),
    nextTarget: item.nextTarget || "",
    reviewNeeded: Boolean(item.reviewNeeded),
    note: item.note || ""
  };
}

export function normalizeAssessment(item) {
  return {
    id: item.id || crypto.randomUUID(),
    courseId: item.courseId || "",
    title: item.title || "",
    type: item.type || "report",
    dueDate: item.dueDate || "",
    dueTime: item.dueTime || "",
    weight: normalizeOptionalNumber(item.weight),
    importance: item.importance || "高",
    status: normalizeAssessmentStatus(item.status),
    note: item.note || ""
  };
}

export function normalizeWeeklyPlans(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  return Object.fromEntries(
    Object.entries(source)
      .filter(([weekKey]) => Boolean(weekKey))
      .map(([weekKey, value]) => [weekKey, normalizeWeeklyPlan({ weekKey, ...(value || {}) })])
  );
}

export function normalizeWeeklyPlan(item) {
  return {
    weekKey: item.weekKey || "",
    focus: Array.isArray(item.focus) ? item.focus.map((line) => String(line).trim()).filter(Boolean) : [],
    notes: item.notes || "",
    draftBlocks: Array.isArray(item.draftBlocks) ? item.draftBlocks.map(normalizeDraftBlock) : [],
    generatedAt: item.generatedAt || ""
  };
}

export function normalizeDraftBlock(item) {
  return {
    id: item.id || crypto.randomUUID(),
    title: item.title || "",
    date: item.date || "",
    start: item.start || "",
    end: item.end || "",
    allDay: Boolean(item.allDay),
    note: item.note || "",
    source: item.source || "manual",
    locked: Boolean(item.locked),
    taskId: item.taskId || ""
  };
}

export function normalizeMilestone(item) {
  return {
    id: item.id || crypto.randomUUID(),
    title: item.title || "",
    type: item.type || "milestone",
    date: item.date || "",
    startDate: item.startDate || "",
    endDate: item.endDate || "",
    scope: item.scope || "year",
    note: item.note || "",
    status: item.status || "planned"
  };
}

export function normalizePlanningDraft(item) {
  return {
    id: item.id || crypto.randomUUID(),
    draftType: item.draftType || "calendar-event",
    title: item.title || "",
    targetDate: item.targetDate || "",
    targetWeekKey: item.targetWeekKey || "",
    start: item.start || "",
    end: item.end || "",
    allDay: Boolean(item.allDay),
    note: item.note || "",
    reason: item.reason || "",
    status: item.status || "draft",
    source: item.source || "ai",
    createdAt: item.createdAt || ""
  };
}

function migrateParsedState(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return structuredClone(INITIAL_STATE);
  }

  const next = { ...parsed };
  next.schemaVersion = STATE_SCHEMA_VERSION;
  next.assessments = Array.isArray(parsed.assessments)
    ? parsed.assessments.map((item) => ({ ...item, status: normalizeAssessmentStatus(item?.status) }))
    : [];
  return next;
}

function normalizeAssessmentStatus(status) {
  const raw = String(status || "").trim().toLowerCase();
  if (!raw) return "todo";

  if (["todo", "未着手", "not_started", "not-started", "pending"].includes(raw)) {
    return "todo";
  }
  if (["doing", "進行中", "in_progress", "in-progress", "started"].includes(raw)) {
    return "doing";
  }
  if (["done", "完了", "completed", "complete", "finished"].includes(raw)) {
    return "done";
  }
  return "todo";
}
