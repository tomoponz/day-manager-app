import { state, saveState, normalizeCourse, normalizeAssessment } from "./state.js";
import { showToast } from "./ui-feedback.js";
import { $ } from "./utils.js";

const MANABA_LAST_IMPORTED_KEY = "day-manager-manaba-last-imported-v1";
const DONE_PATTERNS = ["提出済", "採点済", "終了", "受付終了", "closed", "complete"];

export async function initializeManaba({ renderStudyManager = () => {} } = {}) {
  bindUi({ renderStudyManager });
  await refreshManaba({ renderStudyManager, silent: true });
}

function bindUi({ renderStudyManager }) {
  $("manabaShowTokenBtn")?.addEventListener("click", async () => {
    await showManabaToken();
  });

  $("manabaCopyTokenBtn")?.addEventListener("click", async () => {
    const token = await ensureManabaToken({ silent: false });
    if (!token) return;
    await navigator.clipboard.writeText(token);
    showToast("manaba 同期トークンをコピーしました。", { variant: "ok", duration: 1800 });
  });

  $("manabaRefreshBtn")?.addEventListener("click", async () => {
    const button = $("manabaRefreshBtn");
    if (button) button.disabled = true;
    try {
      await refreshManaba({ renderStudyManager, silent: false, forceImport: true });
    } finally {
      if (button) button.disabled = false;
    }
  });
}

async function refreshManaba({ renderStudyManager, silent = false, forceImport = false } = {}) {
  await ensureManabaToken({ silent: true });

  let payload = null;
  try {
    payload = await fetchJson("/api/manaba/data");
  } catch (error) {
    handleManabaError(error, { silent });
    return null;
  }

  const snapshot = payload?.data || null;
  updateManabaSnapshotUi(snapshot);

  if (!snapshot) {
    if (!silent) {
      showToast("まだ manaba から届いた未提出課題データがありません。", { variant: "warn" });
    }
    return null;
  }

  if (!forceImport && !shouldImportSnapshot(snapshot)) {
    return snapshot;
  }

  const result = mergeManabaSnapshot(snapshot);
  rememberImportedSnapshot(snapshot);

  if (result.changed) {
    saveState();
    renderStudyManager?.();
  }

  if (!silent) {
    if (result.changed) {
      showToast(`manaba 同期: 追加 ${result.added} / 更新 ${result.updated} / 非表示 ${result.hidden}`, { variant: "ok", duration: 2600 });
    } else {
      showToast("manaba の最新スナップショットはすでに反映済みです。", { variant: "info", duration: 2200 });
    }
  }

  return snapshot;
}

async function showManabaToken() {
  await ensureManabaToken({ silent: false, reveal: true });
}

async function ensureManabaToken({ silent = true, reveal = false } = {}) {
  const tokenEl = $("manabaTokenDisplay");
  if (tokenEl && reveal) tokenEl.value = "取得中…";

  try {
    const payload = await fetchJson("/api/manaba/token");
    const token = String(payload?.token || "").trim();
    if (!token) throw new Error("トークンが空です。");
    if (tokenEl && reveal) tokenEl.value = token;
    if (tokenEl && !reveal && !tokenEl.value) tokenEl.value = maskToken(token);
    updateManabaConnectionBadge("利用可");
    updateManabaStatusBox("Google 接続済みです。Tampermonkey に Worker URL とトークンを設定してください。", "ok");
    return token;
  } catch (error) {
    if (tokenEl && reveal) tokenEl.value = "";
    updateManabaConnectionBadge("要接続");
    updateManabaStatusBox(error?.message || "Googleで接続するとトークンを発行できます。", "warn");
    if (!silent) handleManabaError(error, { silent: false });
    return "";
  }
}

function mergeManabaSnapshot(snapshot) {
  const now = new Date().toISOString();
  const courseMap = new Map(state.courses.map((course) => [course.id, course]));
  const seenAssessmentKeys = new Set();
  let added = 0;
  let updated = 0;
  let hidden = 0;
  let changed = false;

  const courses = Array.isArray(snapshot?.courses) ? snapshot.courses : [];

  for (const sourceCourse of courses) {
    const normalizedCourseTitle = normalizeTitle(sourceCourse?.title || sourceCourse?.name || "");
    if (!normalizedCourseTitle) continue;

    const courseExternalId = String(sourceCourse?.externalId || sourceCourse?.url || `course:${normalizedCourseTitle}`).trim();
    let course = findCourseRecord({ title: normalizedCourseTitle, externalId: courseExternalId });

    if (!course) {
      course = normalizeCourse({
        id: crypto.randomUUID(),
        title: normalizedCourseTitle,
        source: "manaba",
        externalId: courseExternalId,
        sourceUrl: sourceCourse?.url || "",
        coursePortalUrl: sourceCourse?.url || "",
        riskStatus: "medium"
      });
      state.courses.push(course);
      courseMap.set(course.id, course);
      changed = true;
    } else {
      const prevCourseJson = JSON.stringify(course);
      course.source = "manaba";
      if (!course.externalId) course.externalId = courseExternalId;
      if (!course.sourceUrl && sourceCourse?.url) course.sourceUrl = sourceCourse.url;
      if (!course.coursePortalUrl && sourceCourse?.url) course.coursePortalUrl = sourceCourse.url;
      if (!course.title && normalizedCourseTitle) course.title = normalizedCourseTitle;
      if (JSON.stringify(course) !== prevCourseJson) changed = true;
    }

    const assignments = Array.isArray(sourceCourse?.assignments) ? sourceCourse.assignments : [];
    for (const sourceAssessment of assignments) {
      if (isProbablySubmitted(sourceAssessment?.status)) continue;

      const title = normalizeTitle(sourceAssessment?.title || "");
      if (!title) continue;

      const dueDate = normalizeDate(sourceAssessment?.dueDate || "");
      const dueTime = normalizeTime(sourceAssessment?.dueTime || "");
      const externalUrl = String(sourceAssessment?.url || "").trim();
      const externalId = String(
        sourceAssessment?.externalId ||
        externalUrl ||
        `${courseExternalId}::${title}::${dueDate}::${dueTime}`
      ).trim();
      const sourceKey = buildSourceKey({ externalId, externalUrl, courseId: course.id, title, dueDate, dueTime });
      seenAssessmentKeys.add(sourceKey);

      const existing = findAssessmentRecord({ externalId, externalUrl, courseId: course.id, title, dueDate, dueTime });
      const nextType = guessAssessmentType(sourceAssessment?.type || title);

      if (!existing) {
        state.assessments.push(normalizeAssessment({
          id: crypto.randomUUID(),
          courseId: course.id,
          title,
          type: nextType,
          dueDate,
          dueTime,
          importance: guessImportance(sourceAssessment?.status),
          status: "todo",
          note: "",
          source: "manaba",
          externalId,
          externalUrl,
          sourceStatus: String(sourceAssessment?.status || "").trim(),
          sourceCourseName: normalizedCourseTitle,
          sourceUpdatedAt: String(sourceAssessment?.updatedAt || snapshot?.scrapedAt || snapshot?.receivedAt || "").trim(),
          importedAt: now,
          hiddenAt: ""
        }));
        added += 1;
        changed = true;
        continue;
      }

      const previousSerialized = JSON.stringify(existing);
      const preservedStatus = existing.status || "todo";
      Object.assign(existing, normalizeAssessment({
        ...existing,
        courseId: course.id,
        title,
        type: nextType,
        dueDate,
        dueTime,
        importance: existing.importance || guessImportance(sourceAssessment?.status),
        status: preservedStatus,
        source: "manaba",
        externalId,
        externalUrl,
        sourceStatus: String(sourceAssessment?.status || "").trim(),
        sourceCourseName: normalizedCourseTitle,
        sourceUpdatedAt: String(sourceAssessment?.updatedAt || snapshot?.scrapedAt || snapshot?.receivedAt || "").trim(),
        importedAt: existing.importedAt || now,
        hiddenAt: ""
      }));
      if (JSON.stringify(existing) !== previousSerialized) {
        updated += 1;
        changed = true;
      }
    }
  }

  for (const assessment of state.assessments) {
    if (assessment.source !== "manaba") continue;
    const key = buildSourceKey(assessment);
    if (seenAssessmentKeys.has(key)) {
      if (assessment.hiddenAt) {
        assessment.hiddenAt = "";
        changed = true;
      }
      continue;
    }
    if (!assessment.hiddenAt) {
      assessment.hiddenAt = now;
      hidden += 1;
      changed = true;
    }
  }

  return { added, updated, hidden, changed };
}

function findCourseRecord({ title, externalId }) {
  return state.courses.find((course) => {
    if (externalId && course.source === "manaba" && String(course.externalId || "") === externalId) return true;
    return normalizeTitle(course.title) === normalizeTitle(title);
  }) || null;
}

function findAssessmentRecord({ externalId, externalUrl, courseId, title, dueDate, dueTime }) {
  return state.assessments.find((assessment) => {
    if (assessment.source === "manaba" && externalId && String(assessment.externalId || "") === externalId) return true;
    if (assessment.source === "manaba" && externalUrl && String(assessment.externalUrl || "") === externalUrl) return true;
    return String(assessment.courseId || "") === String(courseId || "")
      && normalizeTitle(assessment.title) === normalizeTitle(title)
      && normalizeDate(assessment.dueDate) === normalizeDate(dueDate)
      && normalizeTime(assessment.dueTime) === normalizeTime(dueTime);
  }) || null;
}

function buildSourceKey(item) {
  const externalId = String(item?.externalId || "").trim();
  const externalUrl = String(item?.externalUrl || "").trim();
  if (externalId) return `id:${externalId}`;
  if (externalUrl) return `url:${externalUrl}`;
  return `fallback:${item?.courseId || ""}::${normalizeTitle(item?.title || "")}::${normalizeDate(item?.dueDate || "")}::${normalizeTime(item?.dueTime || "")}`;
}

function shouldImportSnapshot(snapshot) {
  const nextMarker = buildSnapshotMarker(snapshot);
  const currentMarker = localStorage.getItem(MANABA_LAST_IMPORTED_KEY) || "";
  return nextMarker && nextMarker !== currentMarker;
}

function rememberImportedSnapshot(snapshot) {
  const marker = buildSnapshotMarker(snapshot);
  if (!marker) return;
  localStorage.setItem(MANABA_LAST_IMPORTED_KEY, marker);
}

function buildSnapshotMarker(snapshot) {
  return String(snapshot?.receivedAt || snapshot?.scrapedAt || "").trim();
}

function updateManabaSnapshotUi(snapshot) {
  if (!snapshot) {
    updateManabaSyncStatus("まだ manaba から同期されていません。", "warn");
    return;
  }

  const courseCount = Array.isArray(snapshot?.courses) ? snapshot.courses.length : 0;
  const assignmentCount = (Array.isArray(snapshot?.courses) ? snapshot.courses : []).reduce((sum, course) => {
    return sum + (Array.isArray(course?.assignments) ? course.assignments.filter((item) => !isProbablySubmitted(item?.status)).length : 0);
  }, 0);
  const scrapedAt = formatDateTime(snapshot?.scrapedAt || snapshot?.receivedAt || "");
  updateManabaSyncStatus(`最終取得: ${scrapedAt} / 科目 ${courseCount} 件 / 未提出 ${assignmentCount} 件`, "ok");
}

function updateManabaConnectionBadge(text) {
  const badge = $("manabaConnectionBadge");
  if (badge) badge.textContent = text;
}

function updateManabaStatusBox(message, level = "") {
  const box = $("manabaStatusBox");
  if (!box) return;
  box.textContent = message;
  box.dataset.level = level;
}

function updateManabaSyncStatus(message, level = "") {
  const box = $("manabaSyncStatus");
  if (!box) return;
  box.textContent = message;
  box.dataset.level = level;
}

function handleManabaError(error, { silent = false } = {}) {
  const message = error?.message || "manaba 連携でエラーが発生しました。";
  if (!silent) {
    showToast(message, { variant: "warn" });
  }
  if (error?.status === 401) {
    updateManabaConnectionBadge("要接続");
    updateManabaStatusBox("Googleで接続すると manaba 連携トークンを発行できます。", "warn");
  }
}

async function fetchJson(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      message = payload?.error || payload?.message || message;
    } catch {}
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
}

function normalizeTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? text : "";
}

function normalizeTime(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{2}):(\d{2})$/);
  return match ? text : "";
}

function isProbablySubmitted(status) {
  const text = String(status || "").trim();
  if (!text) return false;
  return DONE_PATTERNS.some((pattern) => text.includes(pattern));
}

function guessAssessmentType(value) {
  const text = String(value || "");
  if (/試験|期末|中間/.test(text)) return "exam";
  if (/小テスト|クイズ|テスト/.test(text)) return "quiz";
  if (/発表|プレゼン/.test(text)) return "presentation";
  if (/宿題/.test(text)) return "homework";
  if (/レポート|報告/.test(text)) return "report";
  return "report";
}

function guessImportance(status) {
  const text = String(status || "");
  if (/本日|今日|期限切れ|締切/.test(text)) return "高";
  return "高";
}

function formatDateTime(value) {
  const text = String(value || "").trim();
  if (!text) return "不明";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo"
  }).format(date);
}

function maskToken(token) {
  if (token.length <= 10) return token;
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}
