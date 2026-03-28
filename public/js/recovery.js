import {
  state,
  saveState,
  INITIAL_STATE,
  STATE_SCHEMA_VERSION,
  normalizeFixedSchedule,
  normalizeOneOffEvent,
  normalizeTask,
  normalizeCourse,
  normalizeMaterial,
  normalizeAssessment,
  normalizeWeeklyPlans,
  normalizeMilestone,
  normalizePlanningDraft
} from "./state.js";
import { $ } from "./utils.js";

const RECOVERY_SNAPSHOT_KEY = "day-manager-last-snapshot-v1";

const REASON_LABELS = {
  "import-backup": "バックアップ読込前",
  "delete-fixed": "固定予定削除前",
  "delete-event": "単発予定削除前",
  "delete-task": "タスク削除前",
  "delete-google-event": "Google予定削除前",
  "delete-course": "科目削除前",
  "delete-material": "教材削除前",
  "delete-assessment": "締切削除前",
  "replace-planning-drafts": "AI提案上書き前",
  "clear-planning-drafts": "AI提案全削除前",
  "delete-planning-draft": "AI提案削除前",
  "apply-planning-draft-local": "AI提案反映前",
  "apply-planning-draft-google": "AI提案をGoogle反映する前",
  "apply-planning-drafts-local": "AI提案一括反映前",
  "apply-planning-drafts-google": "AI提案をGoogleへ一括反映する前"
};

export function normalizePersistedState(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("バックアップ形式が不正です。");
  }

  const schemaVersion = Number(parsed.schemaVersion || 0);
  if (Number.isFinite(schemaVersion) && schemaVersion > STATE_SCHEMA_VERSION) {
    throw new Error(`このデータは新しい形式 (v${schemaVersion}) です。現在のアプリでは読み込めません。`);
  }

  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    fixedSchedules: (parsed.fixedSchedules || []).map(normalizeFixedSchedule),
    oneOffEvents: (parsed.oneOffEvents || []).map(normalizeOneOffEvent),
    tasks: (parsed.tasks || []).map(normalizeTask),
    courses: (parsed.courses || []).map(normalizeCourse),
    materials: (parsed.materials || []).map(normalizeMaterial),
    assessments: (parsed.assessments || []).map(normalizeAssessment),
    dayConditions:
      parsed.dayConditions && typeof parsed.dayConditions === "object" && !Array.isArray(parsed.dayConditions)
        ? parsed.dayConditions
        : {},
    weeklyPlans: normalizeWeeklyPlans(parsed.weeklyPlans),
    milestones: (parsed.milestones || []).map(normalizeMilestone),
    planningDrafts: (parsed.planningDrafts || []).map(normalizePlanningDraft),
    settings: normalizeSettings(parsed.settings),
    uiState: normalizeUiState(parsed.uiState)
  };
}

export function applyPersistedState(normalized) {
  state.schemaVersion = STATE_SCHEMA_VERSION;
  state.fixedSchedules = normalized.fixedSchedules;
  state.oneOffEvents = normalized.oneOffEvents;
  state.tasks = normalized.tasks;
  state.courses = normalized.courses;
  state.materials = normalized.materials;
  state.assessments = normalized.assessments;
  state.dayConditions = normalized.dayConditions;
  state.weeklyPlans = normalized.weeklyPlans;
  state.milestones = normalized.milestones;
  state.planningDrafts = normalized.planningDrafts;
  state.settings = normalized.settings;
  state.uiState = normalized.uiState;
  saveState();
  return state;
}

export function captureRecoverySnapshot(reason = "manual") {
  try {
    const payload = {
      version: 1,
      capturedAt: new Date().toISOString(),
      reason,
      schemaVersion: STATE_SCHEMA_VERSION,
      state: JSON.parse(JSON.stringify({ ...state, schemaVersion: STATE_SCHEMA_VERSION }))
    };
    localStorage.setItem(RECOVERY_SNAPSHOT_KEY, JSON.stringify(payload));
    refreshRecoveryUi();
    return payload;
  } catch (error) {
    console.warn("Failed to capture recovery snapshot", error);
    return null;
  }
}

export function getRecoverySnapshotMeta() {
  try {
    const raw = localStorage.getItem(RECOVERY_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      capturedAt: parsed.capturedAt || "",
      reason: parsed.reason || "",
      schemaVersion: Number(parsed.schemaVersion || parsed.state?.schemaVersion || 0)
    };
  } catch {
    return null;
  }
}

export function restoreRecoverySnapshot() {
  const raw = localStorage.getItem(RECOVERY_SNAPSHOT_KEY);
  if (!raw) throw new Error("復元できる自動退避がありません。");

  const parsed = JSON.parse(raw);
  const normalized = normalizePersistedState(parsed.state || parsed);
  applyPersistedState(normalized);
  refreshRecoveryUi();
  return {
    meta: getRecoverySnapshotMeta(),
    state
  };
}

export function refreshRecoveryUi() {
  const button = $("restoreBackupBtn");
  const note = $("recoveryStatusNote");
  const meta = getRecoverySnapshotMeta();

  if (button) {
    button.disabled = !meta;
  }

  if (!note) return;
  if (!meta) {
    note.textContent = "復元用の自動退避はまだありません。";
    return;
  }

  const label = REASON_LABELS[meta.reason] || meta.reason || "直前状態";
  const time = meta.capturedAt
    ? new Date(meta.capturedAt).toLocaleString("ja-JP")
    : "時刻不明";
  note.textContent = `${label} / ${time}`;
}

function normalizeSettings(settings) {
  return {
    focusMinutesTarget: normalizeNumberWithFallback(settings?.focusMinutesTarget, INITIAL_STATE.settings.focusMinutesTarget),
    bufferMinutes: normalizeNumberWithFallback(settings?.bufferMinutes, INITIAL_STATE.settings.bufferMinutes),
    protectLunch: normalizeBooleanWithFallback(settings?.protectLunch, INITIAL_STATE.settings.protectLunch),
    lunchWindowStart: normalizeTimeValue(settings?.lunchWindowStart, INITIAL_STATE.settings.lunchWindowStart),
    lunchWindowEnd: normalizeTimeValue(settings?.lunchWindowEnd, INITIAL_STATE.settings.lunchWindowEnd),
    lunchMinutes: normalizeNumberWithFallback(settings?.lunchMinutes, INITIAL_STATE.settings.lunchMinutes),
    breakAfterEvent: normalizeBooleanWithFallback(settings?.breakAfterEvent, INITIAL_STATE.settings.breakAfterEvent),
    breakMinutes: normalizeNumberWithFallback(settings?.breakMinutes, INITIAL_STATE.settings.breakMinutes),
    protectFocusBlock: normalizeBooleanWithFallback(settings?.protectFocusBlock, INITIAL_STATE.settings.protectFocusBlock),
    focusBlockMinutes: normalizeNumberWithFallback(settings?.focusBlockMinutes, INITIAL_STATE.settings.focusBlockMinutes),
    aiDraftOnly: normalizeBooleanWithFallback(settings?.aiDraftOnly, INITIAL_STATE.settings.aiDraftOnly),
    confirmBeforeGoogleApply: normalizeBooleanWithFallback(settings?.confirmBeforeGoogleApply, INITIAL_STATE.settings.confirmBeforeGoogleApply)
  };
}

function normalizeUiState(uiState) {
  return {
    plannerMode: uiState?.plannerMode || INITIAL_STATE.uiState.plannerMode,
    onboardingCompleted: normalizeBooleanWithFallback(uiState?.onboardingCompleted, INITIAL_STATE.uiState.onboardingCompleted),
    onboardingStep: normalizeOnboardingStep(uiState?.onboardingStep)
  };
}

function normalizeNumberWithFallback(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeBooleanWithFallback(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeTimeValue(value, fallback) {
  const text = String(value || "").trim();
  return /^\d{2}:\d{2}$/.test(text) ? text : fallback;
}

function normalizeOnboardingStep(value) {
  const number = Number(value);
  if (!Number.isInteger(number)) return INITIAL_STATE.uiState.onboardingStep;
  return Math.min(3, Math.max(1, number));
}
