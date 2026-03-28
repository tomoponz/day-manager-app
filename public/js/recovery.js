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
    settings: {
      focusMinutesTarget: Math.max(
        0,
        Number(parsed.settings?.focusMinutesTarget ?? INITIAL_STATE.settings.focusMinutesTarget)
      ),
      bufferMinutes: Math.max(
        0,
        Number(parsed.settings?.bufferMinutes ?? INITIAL_STATE.settings.bufferMinutes)
      )
    },
    uiState: {
      plannerMode: parsed.uiState?.plannerMode || INITIAL_STATE.uiState.plannerMode
    }
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
    normalized
  };
}

export function refreshRecoveryUi() {
  const button = $("restoreBackupBtn");
  const status = $("recoveryStatusText");
  const meta = getRecoverySnapshotMeta();

  if (button) button.disabled = !meta;
  if (status) {
    status.textContent = meta
      ? `直前退避: ${formatRecoveryDate(meta.capturedAt)} / ${resolveReasonLabel(meta.reason)}`
      : "自動退避はまだありません。削除や読込の直前に自動退避されます。";
  }
}

function resolveReasonLabel(reason) {
  return REASON_LABELS[reason] || reason || "不明";
}

function formatRecoveryDate(value) {
  if (!value) return "時刻不明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ja-JP");
}
