import { hydrateMaterialCourseOptions, hydrateAssessmentCourseOptions } from "./study-manager-shared.js";
import {
  renderStudyOverview,
  renderStudyRiskList,
  buildStudyPromptSection
} from "./study-manager-summary.js";
import {
  bindStudyEvents,
  configureStudyManagerEditor,
  renderCourseList,
  renderMaterialList,
  renderAssessmentList
} from "./study-manager-editor.js";

export function initializeStudyManager() {
  configureStudyManagerEditor({ onStateChanged: renderStudyManager });
  bindStudyEvents();
  renderStudyManager();
}

export function renderStudyManager() {
  hydrateMaterialCourseOptions();
  hydrateAssessmentCourseOptions();
  renderStudyOverview();
  renderStudyRiskList();
  renderCourseList();
  renderMaterialList();
  renderAssessmentList();
}

export { buildStudyPromptSection };
