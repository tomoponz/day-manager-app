import { state } from "./state.js";
import { $ } from "./utils.js";

export const COURSE_RISK_LABELS = {
  low: "安定",
  medium: "要注意",
  high: "危険"
};

export const MATERIAL_KIND_LABELS = {
  textbook: "教科書",
  handout: "配布資料",
  slides: "スライド",
  workbook: "問題集",
  video: "動画教材",
  other: "その他"
};

export const ASSESSMENT_TYPE_LABELS = {
  exam: "試験",
  report: "レポート",
  presentation: "発表",
  quiz: "小テスト",
  homework: "宿題",
  other: "その他"
};

export const ASSESSMENT_STATUS_LABELS = {
  todo: "未着手",
  doing: "進行中",
  done: "完了"
};

export function on(id, event, handler) {
  $(id)?.addEventListener(event, handler);
}

export function hydrateMaterialCourseOptions(selectedCourseId = "") {
  const select = document.querySelector("#materialForm select[name='courseId']");
  hydrateCourseOptionsInto(select, selectedCourseId, "先に科目を追加");
}

export function hydrateAssessmentCourseOptions(selectedCourseId = "") {
  const select = document.querySelector("#assessmentForm select[name='courseId']");
  hydrateCourseOptionsInto(select, selectedCourseId, "先に科目を追加");
}

export function hydrateCourseOptionsInto(select, selectedCourseId = "", emptyLabel = "先に科目を追加") {
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

export function getCourseTitle(courseId) {
  return state.courses.find((course) => course.id === courseId)?.title || "未分類";
}

export function buildProgressText(material) {
  const unitLabel = material.unitLabel || "p";
  const current = material.currentUnits === "" ? "?" : material.currentUnits;
  const total = material.totalUnits === "" ? "?" : material.totalUnits;
  return `進度:${current}/${total}${unitLabel}`;
}

export function buildFocusCandidates() {
  return state.materials
    .map((material) => ({
      ...material,
      courseTitle: getCourseTitle(material.courseId),
      focusScore: calculateFocusScore(material)
    }))
    .sort((a, b) => b.focusScore - a.focusScore);
}

export function calculateFocusScore(material) {
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

export function buildCourseRiskRanking() {
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

export function getAssessmentUrgencyScore(assessment) {
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

export function getAssessmentDayDiff(assessment) {
  if (!assessment.dueDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${assessment.dueDate}T00:00:00`);
  return Math.floor((due.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

export function isAssessmentDueSoon(assessment) {
  if (assessment.status === "done") return false;
  const diff = getAssessmentDayDiff(assessment);
  return diff !== null && diff >= 0 && diff <= 3;
}

export function isAssessmentOverdue(assessment) {
  if (assessment.status === "done") return false;
  const diff = getAssessmentDayDiff(assessment);
  return diff !== null && diff < 0;
}

export function buildAssessmentSortKey(assessment) {
  return `${assessment.dueDate || "9999-12-31"} ${assessment.dueTime || "99:99"} ${getCourseTitle(assessment.courseId)} ${assessment.title}`;
}

export function buildAssessmentDueText(assessment) {
  const time = assessment.dueTime ? ` ${assessment.dueTime}` : "";
  return `締切:${assessment.dueDate || "未設定"}${time}`;
}

export function fillSummaryList(container, lines, emptyText) {
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

export function createListItem({ title, badges = [], detail = "", note = "" }) {
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

export function makeBadge(text, variant = "") {
  return { text, variant };
}

export function makeButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

export function makeDeleteButton(onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mini-btn";
  button.textContent = "削除";
  button.addEventListener("click", onClick);
  return button;
}

export function riskRank(status) {
  if (status === "high") return 0;
  if (status === "medium") return 1;
  return 2;
}
