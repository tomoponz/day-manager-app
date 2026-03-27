import { hydrateMaterialCourseOptions, hydrateAssessmentCourseOptions } from "./study-manager-shared.js";
import {
  renderStudyOverview,
  renderStudyRiskList,
  renderStudyFocusList,
  renderStudyDeadlineList,
  buildStudyPromptSection
} from "./study-manager-summary.js";
import {
  bindStudyEvents,
  renderCourseList,
  renderMaterialList,
  renderAssessmentList
} from "./study-manager-editor.js";

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

export { buildStudyPromptSection };
