import { state, saveState, normalizeCourse, normalizeMaterial } from "./state.js";
import { $ } from "./utils.js";
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

function on(id, event, handler) {
  $(id)?.addEventListener(event, handler);
}

export function initializeStudyManager() {
  bindStudyEvents();
  renderStudyManager();
}

export function renderStudyManager() {
  hydrateMaterialCourseOptions();
  renderStudyOverview();
  renderCourseList();
  renderMaterialList();
}

function bindStudyEvents() {
  on("courseForm", "submit", onSubmitCourse);
  on("materialForm", "submit", onSubmitMaterial);

  on("courseCancelBtn", "click", resetCourseForm);
  on("materialCancelBtn", "click", resetMaterialForm);
}

function hydrateMaterialCourseOptions(selectedCourseId = "") {
  const select = document.querySelector("#materialForm select[name='courseId']");
  if (!select) return;

  const previousValue = selectedCourseId || select.value || "";
  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = state.courses.length ? "科目を選択" : "先に科目を追加";
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
  const highRiskCount = courses.filter((course) => course.riskStatus === "high").length;
  const reviewCount = materials.filter((material) => material.reviewNeeded).length;
  const lowUnderstandingCount = materials.filter((material) => Number(material.understanding || 0) > 0 && Number(material.understanding || 0) <= 4).length;
  const focusCandidates = buildFocusCandidates().slice(0, 3);

  const lines = [];
  if (courses.length) lines.push(`科目 ${courses.length}件`);
  if (materials.length) lines.push(`教材 ${materials.length}件`);
  if (highRiskCount) lines.push(`危険科目 ${highRiskCount}件`);
  if (reviewCount) lines.push(`復習必要 ${reviewCount}件`);
  if (lowUnderstandingCount) lines.push(`理解度低め ${lowUnderstandingCount}件`);
  if (focusCandidates.length) {
    focusCandidates.forEach((candidate) => {
      lines.push(`今日進める候補: ${candidate.courseTitle} / ${candidate.title}`);
    });
  }

  fillSummaryList(wrap, lines, "まだありません");
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
      const item = createListItem({
        title: course.title,
        badges: [
          makeBadge(`危険度:${COURSE_RISK_LABELS[course.riskStatus] || "要注意"}`, course.riskStatus === "high" ? "danger" : course.riskStatus === "low" ? "ok" : "warn"),
          course.credits !== "" ? makeBadge(`単位:${course.credits}`) : null,
          course.instructor ? makeBadge(course.instructor, "blue") : null
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

function populateCourseForm(id) {
  const course = state.courses.find((item) => item.id === id);
  if (!course) return;
  const form = $("courseForm");
  if (!form) return;

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

async function deleteCourse(id) {
  const course = state.courses.find((item) => item.id === id);
  if (!course) return;

  const linkedMaterials = state.materials.filter((item) => item.courseId === id).length;
  const ok = await confirmDialog({
    title: "科目を削除",
    message: linkedMaterials
      ? `「${course.title}」を削除すると、紐づく教材 ${linkedMaterials} 件も削除されます。続けますか？`
      : `「${course.title}」を削除します。続けますか？`,
    confirmText: "削除",
    danger: true
  });
  if (!ok) return;

  state.courses = state.courses.filter((item) => item.id !== id);
  state.materials = state.materials.filter((item) => item.courseId !== id);
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
  const courseRiskScore = course?.riskStatus === "high" ? 25 : course?.riskStatus === "medium" ? 12 : 0;
  const reviewScore = material.reviewNeeded ? 35 : 0;
  const understanding = material.understanding === "" ? 6 : Number(material.understanding);
  const understandingScore = Math.max(0, 10 - understanding) * 4;
  let progressScore = 0;
  if (material.totalUnits !== "" && Number(material.totalUnits) > 0) {
    const ratio = Number(material.currentUnits || 0) / Number(material.totalUnits);
    progressScore = Math.max(0, 1 - ratio) * 20;
  }
  return courseRiskScore + reviewScore + understandingScore + progressScore;
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
        const credits = course.credits === "" ? "未入力" : String(course.credits);
        return `- ${course.title} / 単位:${credits} / 危険度:${COURSE_RISK_LABELS[course.riskStatus] || "要注意"} / 教材:${linkedCount}件 / 評価:${course.gradingMemo || "未入力"}${course.note ? ` / ${course.note}` : ""}`;
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

  return { courseLines, materialLines, focusLines };
}

function riskRank(status) {
  if (status === "high") return 0;
  if (status === "medium") return 1;
  return 2;
}
