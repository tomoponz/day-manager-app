import { state, saveState, normalizeCourse, normalizeMaterial, normalizeAssessment } from "./state.js";
import { $ } from "./utils.js";
import { formatDateInput } from "./time.js";
import { showToast, confirmDialog } from "./ui-feedback.js";

const COURSE_RISK_LABELS = {
  low: "安定",
  medium: "要注意",
  high: "危険"
};

const MATERIAL_KIND_LABELS = {
  textbook: "教科書",
  handout: "配布資料",
  slides: "スライド",
  workbook: "問題集",
  video: "動画教材",
  other: "その他"
};

const ASSESSMENT_TYPE_LABELS = {
  exam: "試験",
  report: "レポート",
  presentation: "発表",
  quiz: "小テスト",
  homework: "宿題",
  other: "その他"
};

const ASSESSMENT_STATUS_LABELS = {
  todo: "未着手",
  doing: "進行中",
  done: "完了"
};

function on(id, event, handler) {
  $(id)?.addEventListener(event, handler);
}

export function initializeStudyManager() {
  bindStudyEvents();
  renderStudyManager();
}

export function renderStudyManager() {
  hydrateMaterialCourseOptions();
  hydrateAssessmentCourseOptions();
  renderStudyOverview();
  renderStudyRiskList();
  renderStudyFocusList();
  renderStudyDeadlineList();
  renderCourseList();
  renderMaterialList();
  renderAssessmentList();
}

function bindStudyEvents() {
  on("courseForm", "submit", onSubmitCourse);
  on("materialForm", "submit", onSubmitMaterial);
  on("assessmentForm", "submit", onSubmitAssessment);

  on("courseCancelBtn", "click", resetCourseForm);
  on("materialCancelBtn", "click", resetMaterialForm);
  on("assessmentCancelBtn", "click", resetAssessmentForm);
}

function hydrateMaterialCourseOptions(selectedCourseId = "") {
  const select = document.querySelector("#materialForm select[name='courseId']");
  hydrateCourseOptionsInto(select, selectedCourseId, "先に科目を追加");
}

function hydrateAssessmentCourseOptions(selectedCourseId = "") {
  const select = document.querySelector("#assessmentForm select[name='courseId']");
  hydrateCourseOptionsInto(select, selectedCourseId, "先に科目を追加");
}

function hydrateCourseOptionsInto(select, selectedCourseId = "", emptyLabel = "先に科目を追加") {
  if (!select) return;
  const previousValue = selectedCourseId || select.value || "";
  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = state.courses.length ? "科目を選択" : emptyLabel;
  select.appendChild(placeholder);

  state.courses.forEach((course) => {
    const option = document.createElement("option");
    option.value = course.id;
    option.textContent = course.title;
    if (course.id === previousValue) option.selected = true;
    select.appendChild(option);
  });
}

function renderStudyOverview() {
  const wrap = $("studyOverview");
  if (!wrap) return;

  const courses = state.courses || [];
  const materials = state.materials || [];
  const assessments = state.assessments || [];
  const highRiskCount = courses.filter((course) => course.riskStatus === "high").length;
  const reviewCount = materials.filter((material) => material.reviewNeeded).length;
  const lowUnderstandingCount = materials.filter((material) => Number(material.understanding || 0) > 0 && Number(material.understanding || 0) <= 4).length;
  const dueSoonCount = assessments.filter((item) => isAssessmentDueSoon(item)).length;
  const overdueCount = assessments.filter((item) => isAssessmentOverdue(item)).length;
  const focusCandidates = buildFocusCandidates().slice(0, 3);

  const lines = [];
  if (courses.length) lines.push(`科目 ${courses.length}件`);
  if (materials.length) lines.push(`教材 ${materials.length}件`);
  if (assessments.length) lines.push(`締切管理 ${assessments.length}件`);
  if (highRiskCount) lines.push(`危険科目 ${highRiskCount}件`);
  if (reviewCount) lines.push(`復習必要 ${reviewCount}件`);
  if (lowUnderstandingCount) lines.push(`理解度低め ${lowUnderstandingCount}件`);
  if (dueSoonCount) lines.push(`3日以内の締切 ${dueSoonCount}件`);
  if (overdueCount) lines.push(`期限超過 ${overdueCount}件`);
  if (focusCandidates.length) {
    focusCandidates.forEach((candidate) => {
      lines.push(`今日進める候補: ${candidate.courseTitle} / ${candidate.title}`);
    });
  }

  fillSummaryList(wrap, lines, "まだありません");
}

function renderStudyRiskList() {
  const wrap = $("studyRiskList");
  if (!wrap) return;

  const ranking = buildCourseRiskRanking().slice(0, 5);
  const lines = ranking.map((entry) => {
    const reasons = entry.reasons.length ? ` / 理由:${entry.reasons.join("・")}` : "";
    return `${entry.courseTitle} / リスク:${entry.levelLabel}${reasons}`;
  });
  fillSummaryList(wrap, lines, "まだありません");
}

function renderStudyFocusList() {
  const wrap = $("studyFocusList");
  if (!wrap) return;

  const lines = buildFocusCandidates()
    .slice(0, 4)
    .map((candidate) => {
      const course = state.courses.find((item) => item.id === candidate.courseId);
      const reasons = [];
      if (course?.riskStatus === "high") reasons.push("危険科目");
      if (candidate.reviewNeeded) reasons.push("復習必要");
      if (candidate.understanding !== "" && Number(candidate.understanding) <= 4) reasons.push("理解度低め");
      const reasonText = reasons.length ? ` / ${reasons.join("・")}` : "";
      const next = candidate.nextTarget ? ` / 次:${candidate.nextTarget}` : "";
      return `${candidate.courseTitle} / ${candidate.title}${reasonText}${next}`;
    });

  fillSummaryList(wrap, lines, "まだありません");
}

function renderStudyDeadlineList() {
  const wrap = $("studyDeadlineList");
  if (!wrap) return;
  wrap.innerHTML = "";

  const items = state.assessments
    .filter((assessment) => assessment.status !== "done")
    .filter((assessment) => isAssessmentOverdue(assessment) || isAssessmentDueSoon(assessment))
    .slice()
    .sort((a, b) => buildAssessmentSortKey(a).localeCompare(buildAssessmentSortKey(b)));

  if (!items.length) {
    wrap.className = "list-wrap empty";
    wrap.textContent = "期限超過や3日以内の締切はありません";
    return;
  }

  wrap.className = "list-wrap";
  items.slice(0, 6).forEach((assessment) => {
    const overdue = isAssessmentOverdue(assessment);
    const item = createListItem({
      title: `${getCourseTitle(assessment.courseId)} / ${assessment.title}`,
      badges: [
        makeBadge(ASSESSMENT_TYPE_LABELS[assessment.type] || "締切", "blue"),
        makeBadge(buildAssessmentDueText(assessment), overdue ? "danger" : "warn"),
        makeBadge(`状態:${ASSESSMENT_STATUS_LABELS[assessment.status] || "未着手"}`, assessment.status === "doing" ? "warn" : "")
      ],
      detail: overdue ? "期限を過ぎています。先に処理してください。" : "3日以内の締切です。今日の候補に入れるべきです。",
      note: assessment.note || ""
    });
    item.classList.add("study-deadline-item");
    const actions = item.querySelector('.list-actions');
    if (assessment.status !== 'doing') actions.appendChild(makeButton('着手', () => updateAssessmentStatus(assessment.id, 'doing')));
    if (assessment.status !== 'done') actions.appendChild(makeButton('完了', () => updateAssessmentStatus(assessment.id, 'done')));
    actions.appendChild(makeButton('編集', () => populateAssessmentForm(assessment.id)));
    wrap.appendChild(item);
  });
}

function renderCourseList() {
  const wrap = $("courseList");
  if (!wrap) return;
  wrap.innerHTML = "";

  if (!state.courses.length) {
    wrap.className = "list-wrap empty";
    wrap.textContent = "まだありません";
    return;
  }

  wrap.className = "list-wrap";

  state.courses
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title, "ja"))
    .forEach((course) => {
      const linkedMaterials = state.materials.filter((material) => material.courseId === course.id).length;
      const linkedAssessments = state.assessments.filter((assessment) => assessment.courseId === course.id).length;
      const riskEntry = buildCourseRiskRanking().find((entry) => entry.courseId === course.id);

      const item = createListItem({
        title: course.title,
        badges: [
          makeBadge(`危険度:${COURSE_RISK_LABELS[course.riskStatus] || "要注意"}`, course.riskStatus === "high" ? "danger" : course.riskStatus === "low" ? "ok" : "warn"),
          course.credits !== "" ? makeBadge(`単位:${course.credits}`) : null,
          course.instructor ? makeBadge(course.instructor, "blue") : null,
          makeBadge(`教材:${linkedMaterials}件`),
          makeBadge(`締切:${linkedAssessments}件`, linkedAssessments ? "warn" : ""),
          riskEntry ? makeBadge(`総合:${riskEntry.levelLabel}`, riskEntry.level === "high" ? "danger" : riskEntry.level === "medium" ? "warn" : "ok") : null
        ].filter(Boolean),
        detail: [
          course.scheduleMemo ? `授業情報: ${course.scheduleMemo}` : "",
          course.gradingMemo ? `評価: ${course.gradingMemo}` : ""
        ].filter(Boolean).join(" / "),
        note: course.note || ""
      });

      const actions = item.querySelector(".list-actions");
      actions.appendChild(makeButton("編集", () => populateCourseForm(course.id)));
      actions.appendChild(makeDeleteButton(() => deleteCourse(course.id)));
      wrap.appendChild(item);
    });
}

function renderMaterialList() {
  const wrap = $("materialList");
  if (!wrap) return;
  wrap.innerHTML = "";

  if (!state.materials.length) {
    wrap.className = "list-wrap empty";
    wrap.textContent = "まだありません";
    return;
  }

  wrap.className = "list-wrap";

  state.materials
    .slice()
    .sort((a, b) => {
      const courseDiff = getCourseTitle(a.courseId).localeCompare(getCourseTitle(b.courseId), "ja");
      if (courseDiff !== 0) return courseDiff;
      return a.title.localeCompare(b.title, "ja");
    })
    .forEach((material) => {
      const progressText = buildProgressText(material);
      const understandingText = material.understanding === "" ? "理解度:未入力" : `理解度:${material.understanding}/10`;
      const item = createListItem({
        title: `${getCourseTitle(material.courseId)} / ${material.title}`,
        badges: [
          makeBadge(MATERIAL_KIND_LABELS[material.kind] || "教材", "blue"),
          makeBadge(progressText, "ok"),
          makeBadge(understandingText, Number(material.understanding || 0) > 0 && Number(material.understanding || 0) <= 4 ? "warn" : ""),
          material.reviewNeeded ? makeBadge("復習必要", "danger") : null
        ].filter(Boolean),
        detail: material.nextTarget ? `次にやる場所: ${material.nextTarget}` : "",
        note: material.note || ""
      });

      const main = item.querySelector(".list-main");
      const progress = document.createElement("progress");
      progress.max = Number(material.totalUnits || 0) || 1;
      progress.value = Math.min(Number(material.currentUnits || 0) || 0, progress.max);
      progress.style.width = "100%";
      progress.style.marginTop = "0.45rem";
      main.appendChild(progress);

      const actions = item.querySelector(".list-actions");
      actions.appendChild(makeButton("+1", () => advanceMaterial(material.id, 1)));
      actions.appendChild(makeButton("+5", () => advanceMaterial(material.id, 5)));
      actions.appendChild(makeButton("編集", () => populateMaterialForm(material.id)));
      actions.appendChild(makeDeleteButton(() => deleteMaterial(material.id)));
      wrap.appendChild(item);
    });
}

function renderAssessmentList() {
  const wrap = $("assessmentList");
  if (!wrap) return;
  wrap.innerHTML = "";

  if (!state.assessments.length) {
    wrap.className = "list-wrap empty";
    wrap.textContent = "まだありません";
    return;
  }

  wrap.className = "list-wrap";

  state.assessments
    .slice()
    .sort((a, b) => buildAssessmentSortKey(a).localeCompare(buildAssessmentSortKey(b)))
    .forEach((assessment) => {
      const dueText = buildAssessmentDueText(assessment);
      const item = createListItem({
        title: `${getCourseTitle(assessment.courseId)} / ${assessment.title}`,
        badges: [
          makeBadge(ASSESSMENT_TYPE_LABELS[assessment.type] || "締切", "blue"),
          makeBadge(dueText, isAssessmentOverdue(assessment) ? "danger" : isAssessmentDueSoon(assessment) ? "warn" : ""),
          makeBadge(`状態:${ASSESSMENT_STATUS_LABELS[assessment.status] || "未着手"}`, assessment.status === "done" ? "ok" : assessment.status === "doing" ? "warn" : ""),
          assessment.weight !== "" ? makeBadge(`配点:${assessment.weight}%`) : null,
          makeBadge(`重要度:${assessment.importance}`, assessment.importance === "高" ? "danger" : assessment.importance === "中" ? "warn" : "")
        ].filter(Boolean),
        detail: assessment.note || "",
        note: ""
      });

      const actions = item.querySelector(".list-actions");
      if (assessment.status !== "doing") actions.appendChild(makeButton("着手", () => updateAssessmentStatus(assessment.id, "doing")));
      if (assessment.status !== "done") actions.appendChild(makeButton("完了", () => updateAssessmentStatus(assessment.id, "done")));
      actions.appendChild(makeButton("編集", () => populateAssessmentForm(assessment.id)));
      actions.appendChild(makeDeleteButton(() => deleteAssessment(assessment.id)));
      wrap.appendChild(item);
    });
}

async function onSubmitCourse(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const editingId = String(data.get("editId") || "");
  const payload = normalizeCourse({
    id: editingId || crypto.randomUUID(),
    title: String(data.get("title") || "").trim(),
    instructor: String(data.get("instructor") || "").trim(),
    credits: String(data.get("credits") || "").trim(),
    scheduleMemo: String(data.get("scheduleMemo") || "").trim(),
    gradingMemo: String(data.get("gradingMemo") || "").trim(),
    riskStatus: String(data.get("riskStatus") || "medium"),
    note: String(data.get("note") || "").trim()
  });

  if (!payload.title) {
    showToast("科目名を入力してください。", { variant: "warn" });
    return;
  }

  if (editingId) {
    const target = state.courses.find((course) => course.id === editingId);
    if (!target) return;
    Object.assign(target, payload);
    showToast("科目を更新しました。", { variant: "ok", duration: 1800 });
  } else {
    state.courses.push(payload);
    showToast("科目を追加しました。", { variant: "ok", duration: 1800 });
  }

  saveState();
  resetCourseForm();
  renderStudyManager();
}

async function onSubmitMaterial(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const editingId = String(data.get("editId") || "");
  const payload = normalizeMaterial({
    id: editingId || crypto.randomUUID(),
    courseId: String(data.get("courseId") || ""),
    title: String(data.get("title") || "").trim(),
    kind: String(data.get("kind") || "textbook"),
    totalUnits: String(data.get("totalUnits") || "").trim(),
    currentUnits: String(data.get("currentUnits") || "").trim(),
    unitLabel: String(data.get("unitLabel") || "").trim() || "p",
    understanding: String(data.get("understanding") || "").trim(),
    nextTarget: String(data.get("nextTarget") || "").trim(),
    reviewNeeded: Boolean(data.get("reviewNeeded")),
    note: String(data.get("note") || "").trim()
  });

  if (!payload.courseId) {
    showToast("先に科目を選んでください。", { variant: "warn" });
    return;
  }
  if (!payload.title) {
    showToast("教材名を入力してください。", { variant: "warn" });
    return;
  }

  if (payload.totalUnits !== "" && payload.currentUnits !== "" && Number(payload.currentUnits) > Number(payload.totalUnits)) {
    payload.currentUnits = payload.totalUnits;
  }

  if (editingId) {
    const target = state.materials.find((material) => material.id === editingId);
    if (!target) return;
    Object.assign(target, payload);
    showToast("教材を更新しました。", { variant: "ok", duration: 1800 });
  } else {
    state.materials.push(payload);
    showToast("教材を追加しました。", { variant: "ok", duration: 1800 });
  }

  saveState();
  resetMaterialForm();
  renderStudyManager();
}

async function onSubmitAssessment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const editingId = String(data.get("editId") || "");
  const payload = normalizeAssessment({
    id: editingId || crypto.randomUUID(),
    courseId: String(data.get("courseId") || ""),
    title: String(data.get("title") || "").trim(),
    type: String(data.get("type") || "report"),
    dueDate: String(data.get("dueDate") || ""),
    dueTime: String(data.get("dueTime") || ""),
    weight: String(data.get("weight") || "").trim(),
    importance: String(data.get("importance") || "高"),
    status: String(data.get("status") || "todo"),
    note: String(data.get("note") || "").trim()
  });

  if (!payload.courseId) {
    showToast("科目を選んでください。", { variant: "warn" });
    return;
  }
  if (!payload.title || !payload.dueDate) {
    showToast("締切名と締切日を入力してください。", { variant: "warn" });
    return;
  }

  if (editingId) {
    const target = state.assessments.find((assessment) => assessment.id === editingId);
    if (!target) return;
    Object.assign(target, payload);
    showToast("締切を更新しました。", { variant: "ok", duration: 1800 });
  } else {
    state.assessments.push(payload);
    showToast("締切を追加しました。", { variant: "ok", duration: 1800 });
  }

  saveState();
  resetAssessmentForm();
  renderStudyManager();
}

function resetCourseForm() {
  const form = $("courseForm");
  if (!form) return;
  form.reset();
  form.elements.editId.value = "";
  const submit = $("courseSubmitBtn");
  if (submit) submit.textContent = "科目を追加";
  const cancel = $("courseCancelBtn");
  if (cancel) cancel.hidden = true;
  const panel = $("courseFormPanel");
  if (panel) panel.open = false;
}

function resetMaterialForm() {
  const form = $("materialForm");
  if (!form) return;
  const currentCourseId = form.elements.courseId.value || "";
  form.reset();
  form.elements.editId.value = "";
  hydrateMaterialCourseOptions(currentCourseId);
  form.elements.kind.value = "textbook";
  form.elements.unitLabel.value = "p";
  const submit = $("materialSubmitBtn");
  if (submit) submit.textContent = "教材を追加";
  const cancel = $("materialCancelBtn");
  if (cancel) cancel.hidden = true;
  const panel = $("materialFormPanel");
  if (panel) panel.open = false;
}

function resetAssessmentForm() {
  const form = $("assessmentForm");
  if (!form) return;
  const currentCourseId = form.elements.courseId.value || "";
  form.reset();
  form.elements.editId.value = "";
  hydrateAssessmentCourseOptions(currentCourseId);
  form.elements.type.value = "report";
  form.elements.importance.value = "高";
  form.elements.status.value = "todo";
  const submit = $("assessmentSubmitBtn");
  if (submit) submit.textContent = "締切を追加";
  const cancel = $("assessmentCancelBtn");
  if (cancel) cancel.hidden = true;
  const panel = $("assessmentFormPanel");
  if (panel) panel.open = false;
}

function populateCourseForm(id) {
  const course = state.courses.find((item) => item.id === id);
  if (!course) return;
  const form = $("courseForm");
  if (!form) return;
  const adminPanel = $("studyCourseAdminPanel");
  if (adminPanel) adminPanel.open = true;

  form.elements.editId.value = course.id;
  form.elements.title.value = course.title;
  form.elements.instructor.value = course.instructor;
  form.elements.credits.value = course.credits;
  form.elements.scheduleMemo.value = course.scheduleMemo;
  form.elements.gradingMemo.value = course.gradingMemo;
  form.elements.riskStatus.value = course.riskStatus;
  form.elements.note.value = course.note;

  const submit = $("courseSubmitBtn");
  if (submit) submit.textContent = "科目を更新";
  const cancel = $("courseCancelBtn");
  if (cancel) cancel.hidden = false;
  const panel = $("courseFormPanel");
  if (panel) panel.open = true;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function populateMaterialForm(id) {
  const material = state.materials.find((item) => item.id === id);
  if (!material) return;
  const form = $("materialForm");
  if (!form) return;
  const adminPanel = $("studyMaterialAdminPanel");
  if (adminPanel) adminPanel.open = true;

  form.elements.editId.value = material.id;
  hydrateMaterialCourseOptions(material.courseId);
  form.elements.courseId.value = material.courseId;
  form.elements.title.value = material.title;
  form.elements.kind.value = material.kind;
  form.elements.totalUnits.value = material.totalUnits;
  form.elements.currentUnits.value = material.currentUnits;
  form.elements.unitLabel.value = material.unitLabel;
  form.elements.understanding.value = material.understanding;
  form.elements.nextTarget.value = material.nextTarget;
  form.elements.reviewNeeded.checked = Boolean(material.reviewNeeded);
  form.elements.note.value = material.note;

  const submit = $("materialSubmitBtn");
  if (submit) submit.textContent = "教材を更新";
  const cancel = $("materialCancelBtn");
  if (cancel) cancel.hidden = false;
  const panel = $("materialFormPanel");
  if (panel) panel.open = true;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function populateAssessmentForm(id) {
  const assessment = state.assessments.find((item) => item.id === id);
  if (!assessment) return;
  const form = $("assessmentForm");
  if (!form) return;
  const adminPanel = $("studyAssessmentAdminPanel");
  if (adminPanel) adminPanel.open = true;

  form.elements.editId.value = assessment.id;
  hydrateAssessmentCourseOptions(assessment.courseId);
  form.elements.courseId.value = assessment.courseId;
  form.elements.title.value = assessment.title;
  form.elements.type.value = assessment.type;
  form.elements.dueDate.value = assessment.dueDate;
  form.elements.dueTime.value = assessment.dueTime;
  form.elements.weight.value = assessment.weight;
  form.elements.importance.value = assessment.importance;
  form.elements.status.value = assessment.status;
  form.elements.note.value = assessment.note;

  const submit = $("assessmentSubmitBtn");
  if (submit) submit.textContent = "締切を更新";
  const cancel = $("assessmentCancelBtn");
  if (cancel) cancel.hidden = false;
  const panel = $("assessmentFormPanel");
  if (panel) panel.open = true;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function deleteCourse(id) {
  const course = state.courses.find((item) => item.id === id);
  if (!course) return;

  const linkedMaterials = state.materials.filter((item) => item.courseId === id).length;
  const linkedAssessments = state.assessments.filter((item) => item.courseId === id).length;
  const ok = await confirmDialog({
    title: "科目を削除",
    message: `「${course.title}」を削除すると、教材 ${linkedMaterials} 件と締切 ${linkedAssessments} 件も削除されます。続けますか？`,
    confirmText: "削除",
    danger: true
  });
  if (!ok) return;

  state.courses = state.courses.filter((item) => item.id !== id);
  state.materials = state.materials.filter((item) => item.courseId !== id);
  state.assessments = state.assessments.filter((item) => item.courseId !== id);
  saveState();
  renderStudyManager();
  showToast("科目を削除しました。", { variant: "ok", duration: 1800 });
}

async function deleteMaterial(id) {
  const material = state.materials.find((item) => item.id === id);
  if (!material) return;

  const ok = await confirmDialog({
    title: "教材を削除",
    message: `「${material.title}」を削除します。続けますか？`,
    confirmText: "削除",
    danger: true
  });
  if (!ok) return;

  state.materials = state.materials.filter((item) => item.id !== id);
  saveState();
  renderStudyManager();
  showToast("教材を削除しました。", { variant: "ok", duration: 1800 });
}

async function deleteAssessment(id) {
  const assessment = state.assessments.find((item) => item.id === id);
  if (!assessment) return;

  const ok = await confirmDialog({
    title: "締切を削除",
    message: `「${assessment.title}」を削除します。続けますか？`,
    confirmText: "削除",
    danger: true
  });
  if (!ok) return;

  state.assessments = state.assessments.filter((item) => item.id !== id);
  saveState();
  renderStudyManager();
  showToast("締切を削除しました。", { variant: "ok", duration: 1800 });
}

function advanceMaterial(id, amount) {
  const material = state.materials.find((item) => item.id === id);
  if (!material) return;

  const current = Number(material.currentUnits || 0);
  const total = material.totalUnits === "" ? "" : Number(material.totalUnits || 0);
  const next = total === "" ? current + amount : Math.min(current + amount, total);
  material.currentUnits = next;

  if (total !== "" && next >= total) {
    material.reviewNeeded = false;
  }

  saveState();
  renderStudyManager();
  showToast(`進度を ${amount}${material.unitLabel || "p"} 進めました。`, { variant: "ok", duration: 1600 });
}

function updateAssessmentStatus(id, status) {
  const assessment = state.assessments.find((item) => item.id === id);
  if (!assessment) return;
  assessment.status = status;
  saveState();
  renderStudyManager();
  showToast(`締切状態を「${ASSESSMENT_STATUS_LABELS[status] || status}」に変更しました。`, { variant: "ok", duration: 1600 });
}

function getCourseTitle(courseId) {
  return state.courses.find((course) => course.id === courseId)?.title || "未分類";
}

function buildProgressText(material) {
  const unitLabel = material.unitLabel || "p";
  const current = material.currentUnits === "" ? "?" : material.currentUnits;
  const total = material.totalUnits === "" ? "?" : material.totalUnits;
  return `進度:${current}/${total}${unitLabel}`;
}

function buildFocusCandidates() {
  return state.materials
    .map((material) => ({
      ...material,
      courseTitle: getCourseTitle(material.courseId),
      focusScore: calculateFocusScore(material)
    }))
    .sort((a, b) => b.focusScore - a.focusScore);
}

function calculateFocusScore(material) {
  const course = state.courses.find((item) => item.id === material.courseId);
  const relatedAssessments = state.assessments.filter((item) => item.courseId === material.courseId && item.status !== "done");
  const dueSoonScore = relatedAssessments.reduce((sum, item) => sum + getAssessmentUrgencyScore(item), 0);

  const courseRiskScore = course?.riskStatus === "high" ? 25 : course?.riskStatus === "medium" ? 12 : 0;
  const reviewScore = material.reviewNeeded ? 35 : 0;
  const understanding = material.understanding === "" ? 6 : Number(material.understanding);
  const understandingScore = Math.max(0, 10 - understanding) * 4;
  let progressScore = 0;
  if (material.totalUnits !== "" && Number(material.totalUnits) > 0) {
    const ratio = Number(material.currentUnits || 0) / Number(material.totalUnits);
    progressScore = Math.max(0, 1 - ratio) * 20;
  }
  return courseRiskScore + reviewScore + understandingScore + progressScore + dueSoonScore;
}

function buildCourseRiskRanking() {
  return state.courses
    .map((course) => {
      const materials = state.materials.filter((item) => item.courseId === course.id);
      const assessments = state.assessments.filter((item) => item.courseId === course.id && item.status !== "done");
      const reasons = [];
      let score = course.riskStatus === "high" ? 45 : course.riskStatus === "medium" ? 25 : 10;

      if (course.riskStatus === "high") reasons.push("手動で危険指定");

      const lowUnderstandingCount = materials.filter((item) => item.understanding !== "" && Number(item.understanding) <= 4).length;
      if (lowUnderstandingCount) {
        score += lowUnderstandingCount * 8;
        reasons.push(`理解度低め ${lowUnderstandingCount}件`);
      }

      const reviewCount = materials.filter((item) => item.reviewNeeded).length;
      if (reviewCount) {
        score += reviewCount * 12;
        reasons.push(`復習必要 ${reviewCount}件`);
      }

      const dueSoonCount = assessments.filter((item) => isAssessmentDueSoon(item)).length;
      const overdueCount = assessments.filter((item) => isAssessmentOverdue(item)).length;
      if (dueSoonCount) {
        score += dueSoonCount * 14;
        reasons.push(`3日以内の締切 ${dueSoonCount}件`);
      }
      if (overdueCount) {
        score += overdueCount * 20;
        reasons.push(`期限超過 ${overdueCount}件`);
      }

      score += assessments.reduce((sum, item) => sum + getAssessmentUrgencyScore(item), 0);

      const level = score >= 85 ? "high" : score >= 45 ? "medium" : "low";
      const levelLabel = level === "high" ? "危険" : level === "medium" ? "要注意" : "安定";

      return {
        courseId: course.id,
        courseTitle: course.title,
        score: Math.round(score),
        level,
        levelLabel,
        reasons
      };
    })
    .sort((a, b) => b.score - a.score);
}

function getAssessmentUrgencyScore(assessment) {
  const dayDiff = getAssessmentDayDiff(assessment);
  const importanceScore = assessment.importance === "高" ? 18 : assessment.importance === "中" ? 10 : 4;
  const typeScore = assessment.type === "exam" ? 14 : assessment.type === "report" ? 10 : assessment.type === "presentation" ? 8 : 4;

  if (dayDiff === null) return importanceScore + typeScore;
  if (dayDiff < 0) return 28 + importanceScore + typeScore;
  if (dayDiff <= 1) return 24 + importanceScore + typeScore;
  if (dayDiff <= 3) return 16 + importanceScore + typeScore;
  if (dayDiff <= 7) return 8 + importanceScore + typeScore;
  return importanceScore + typeScore;
}

function getAssessmentDayDiff(assessment) {
  if (!assessment.dueDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${assessment.dueDate}T00:00:00`);
  return Math.floor((due.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function isAssessmentDueSoon(assessment) {
  if (assessment.status === "done") return false;
  const diff = getAssessmentDayDiff(assessment);
  return diff !== null && diff >= 0 && diff <= 3;
}

function isAssessmentOverdue(assessment) {
  if (assessment.status === "done") return false;
  const diff = getAssessmentDayDiff(assessment);
  return diff !== null && diff < 0;
}

function buildAssessmentSortKey(assessment) {
  return `${assessment.dueDate || "9999-12-31"} ${assessment.dueTime || "99:99"} ${getCourseTitle(assessment.courseId)} ${assessment.title}`;
}

function buildAssessmentDueText(assessment) {
  const time = assessment.dueTime ? ` ${assessment.dueTime}` : "";
  return `締切:${assessment.dueDate || "未設定"}${time}`;
}

function fillSummaryList(container, lines, emptyText) {
  container.innerHTML = "";
  if (!lines.length) {
    container.className = "summary-list empty";
    container.textContent = emptyText;
    return;
  }

  container.className = "summary-list";
  lines.forEach((line) => {
    const chip = document.createElement("div");
    chip.className = "summary-chip";
    chip.textContent = line;
    container.appendChild(chip);
  });
}

function createListItem({ title, badges = [], detail = "", note = "" }) {
  const item = document.createElement("article");
  item.className = "list-item";

  const main = document.createElement("div");
  main.className = "list-main";

  const titleEl = document.createElement("strong");
  titleEl.className = "item-title";
  titleEl.textContent = title;
  main.appendChild(titleEl);

  const meta = document.createElement("div");
  meta.className = "item-meta";
  badges.forEach((badge) => {
    const span = document.createElement("span");
    span.className = `item-badge${badge.variant ? ` is-${badge.variant}` : ""}`;
    span.textContent = badge.text;
    meta.appendChild(span);
  });
  main.appendChild(meta);

  const detailEl = document.createElement("p");
  detailEl.className = "item-detail";
  detailEl.textContent = detail;
  main.appendChild(detailEl);

  const noteEl = document.createElement("p");
  noteEl.className = "item-note";
  noteEl.textContent = note;
  main.appendChild(noteEl);

  const actions = document.createElement("div");
  actions.className = "list-actions";

  item.appendChild(main);
  item.appendChild(actions);

  return item;
}

function makeBadge(text, variant = "") {
  return { text, variant };
}

function makeButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function makeDeleteButton(onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mini-btn";
  button.textContent = "削除";
  button.addEventListener("click", onClick);
  return button;
}

export function buildStudyPromptSection() {
  const riskRanking = buildCourseRiskRanking();
  const courseLines = state.courses.length
    ? state.courses
      .slice()
      .sort((a, b) => {
        const riskDiff = riskRank(a.riskStatus) - riskRank(b.riskStatus);
        if (riskDiff !== 0) return riskDiff;
        return a.title.localeCompare(b.title, "ja");
      })
      .map((course) => {
        const linkedCount = state.materials.filter((material) => material.courseId === course.id).length;
        const linkedAssessments = state.assessments.filter((assessment) => assessment.courseId === course.id && assessment.status !== "done").length;
        const credits = course.credits === "" ? "未入力" : String(course.credits);
        return `- ${course.title} / 単位:${credits} / 危険度:${COURSE_RISK_LABELS[course.riskStatus] || "要注意"} / 教材:${linkedCount}件 / 未完了締切:${linkedAssessments}件 / 評価:${course.gradingMemo || "未入力"}${course.note ? ` / ${course.note}` : ""}`;
      })
    : ["- なし"];

  const materialLines = state.materials.length
    ? state.materials
      .slice()
      .sort((a, b) => calculateFocusScore(b) - calculateFocusScore(a))
      .slice(0, 8)
      .map((material) => {
        const understanding = material.understanding === "" ? "未入力" : `${material.understanding}/10`;
        return `- ${getCourseTitle(material.courseId)} / ${material.title} / ${MATERIAL_KIND_LABELS[material.kind] || "教材"} / ${buildProgressText(material)} / 理解度:${understanding}${material.reviewNeeded ? " / 復習必要" : ""}${material.nextTarget ? ` / 次:${material.nextTarget}` : ""}`;
      })
    : ["- なし"];

  const focusLines = buildFocusCandidates().length
    ? buildFocusCandidates()
      .slice(0, 5)
      .map((material) => {
        const reason = [];
        const course = state.courses.find((courseItem) => courseItem.id === material.courseId);
        if (course?.riskStatus === "high") reason.push("危険科目");
        if (material.reviewNeeded) reason.push("復習必要");
        if (material.understanding !== "" && Number(material.understanding) <= 4) reason.push("理解度低め");
        return `- ${material.courseTitle} / ${material.title}${reason.length ? ` / 理由:${reason.join("・")}` : ""}${material.nextTarget ? ` / 次:${material.nextTarget}` : ""}`;
      })
    : ["- なし"];

  const riskLines = riskRanking.length
    ? riskRanking.slice(0, 5).map((entry) => `- ${entry.courseTitle} / 総合危険度:${entry.levelLabel} / スコア:${entry.score}${entry.reasons.length ? ` / 理由:${entry.reasons.join("・")}` : ""}`)
    : ["- なし"];

  const deadlineLines = state.assessments.length
    ? state.assessments
      .filter((assessment) => assessment.status !== "done")
      .slice()
      .sort((a, b) => buildAssessmentSortKey(a).localeCompare(buildAssessmentSortKey(b)))
      .slice(0, 8)
      .map((assessment) => `- ${getCourseTitle(assessment.courseId)} / ${assessment.title} / ${ASSESSMENT_TYPE_LABELS[assessment.type] || "締切"} / ${buildAssessmentDueText(assessment)} / 状態:${ASSESSMENT_STATUS_LABELS[assessment.status] || "未着手"} / 重要度:${assessment.importance}${assessment.weight !== "" ? ` / 配点:${assessment.weight}%` : ""}${assessment.note ? ` / ${assessment.note}` : ""}`)
    : ["- なし"];

  return { courseLines, materialLines, focusLines, riskLines, deadlineLines };
}

function riskRank(status) {
  if (status === "high") return 0;
  if (status === "medium") return 1;
  return 2;
}
