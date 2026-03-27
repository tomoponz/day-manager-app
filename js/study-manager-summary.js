import { state } from "./state.js";
import { $ } from "./utils.js";
import {
  COURSE_RISK_LABELS,
  MATERIAL_KIND_LABELS,
  ASSESSMENT_TYPE_LABELS,
  ASSESSMENT_STATUS_LABELS,
  buildFocusCandidates,
  buildCourseRiskRanking,
  getCourseTitle,
  calculateFocusScore,
  buildProgressText,
  buildAssessmentSortKey,
  buildAssessmentDueText,
  isAssessmentDueSoon,
  isAssessmentOverdue,
  fillSummaryList,
  createListItem,
  makeBadge,
  makeButton,
  riskRank
} from "./study-manager-shared.js";
import { updateAssessmentStatus, populateAssessmentForm } from "./study-manager-editor.js";

export function renderStudyOverview() {
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

export function renderStudyRiskList() {
  const wrap = $("studyRiskList");
  if (!wrap) return;

  const ranking = buildCourseRiskRanking().slice(0, 5);
  const lines = ranking.map((entry) => {
    const reasons = entry.reasons.length ? ` / 理由:${entry.reasons.join("・")}` : "";
    return `${entry.courseTitle} / リスク:${entry.levelLabel}${reasons}`;
  });
  fillSummaryList(wrap, lines, "まだありません");
}

export function renderStudyFocusList() {
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

export function renderStudyDeadlineList() {
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
    const actions = item.querySelector(".list-actions");
    if (assessment.status !== "doing") actions.appendChild(makeButton("着手", () => updateAssessmentStatus(assessment.id, "doing")));
    if (assessment.status !== "done") actions.appendChild(makeButton("完了", () => updateAssessmentStatus(assessment.id, "done")));
    actions.appendChild(makeButton("編集", () => populateAssessmentForm(assessment.id)));
    wrap.appendChild(item);
  });
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
