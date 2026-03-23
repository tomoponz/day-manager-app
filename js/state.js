export const STORAGE_KEY = "day-manager-v1";
export const GOOGLE_CONFIG_KEY = "day-manager-google-config-v1";

export const INITIAL_STATE = {
  fixedSchedules: [],
  oneOffEvents: [],
  tasks: [],
  dayConditions: {},
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
    const parsed = JSON.parse(raw);
    return {
      fixedSchedules: (parsed.fixedSchedules || []).map(normalizeFixedSchedule),
      oneOffEvents: (parsed.oneOffEvents || []).map(normalizeOneOffEvent),
      tasks: (parsed.tasks || []).map(normalizeTask),
      dayConditions: parsed.dayConditions || {},
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
