import { $, debounce } from './utils.js';
import { generatePrompt, copyPrompt } from './prompt.js';
import { onConnectGoogle, onDisconnectGoogle, loadGoogleEventsForSelectedDate, importGoogleEventsToLocal } from './google-calendar.js';
import { refreshRecoveryUi } from './recovery.js';
import { state } from './state.js';
import { bindEditorDrawerUi, setToday, closeEditorDrawer, openEditorDrawer, toggleEventTimeInputs, openTravelRouteFormForCreate, resetFixedForm, resetEventForm, resetTaskForm, resetStudyLocationForm, resetTravelRouteForm } from './actions-editor.js';
import { saveSettingsInputs, onDateChanged, saveCurrentConditionInputs, adjustFatigue, addUnexpectedThirtyMinutes, setPlannerMode, onPlannerModeChanged, closeStateUpdateMenu, openConfiguredExternalLink, setExecutionSearchQuery, clearExecutionSearchQuery } from './actions-settings.js';
import { onSubmitFixedSchedule, onSubmitOneOffEvent, onSubmitTask, onSubmitStudyLocation, onSubmitTravelRoute, cleanupPastOneOffEvents, restoreDismissedOneOffEvents, handleQuickAdd, exportData, importData, restoreLastSnapshot } from './actions-operations.js';

export * from './actions-editor.js';
export * from './actions-settings.js';
export * from './actions-operations.js';

function on(id, event, handler) {
  $(id)?.addEventListener(event, handler);
}

export function bindEvents() {
  bindEditorDrawerUi();
  const debouncedSaveCurrentConditionInputs = debounce(saveCurrentConditionInputs, 400);

  on('fixedForm', 'submit', onSubmitFixedSchedule);
  on('eventForm', 'submit', onSubmitOneOffEvent);
  on('taskForm', 'submit', onSubmitTask);
  on('studyLocationForm', 'submit', onSubmitStudyLocation);
  on('travelRouteForm', 'submit', onSubmitTravelRoute);

  on('fixedCancelBtn', 'click', resetFixedForm);
  on('eventCancelBtn', 'click', resetEventForm);
  on('taskCancelBtn', 'click', resetTaskForm);
  on('studyLocationCancelBtn', 'click', resetStudyLocationForm);
  on('travelRouteCancelBtn', 'click', resetTravelRouteForm);

  on('selectedDate', 'change', onDateChanged);

  on('sleepHours', 'input', debouncedSaveCurrentConditionInputs);
  on('fatigue', 'input', debouncedSaveCurrentConditionInputs);
  on('conditionNote', 'input', debouncedSaveCurrentConditionInputs);

  on('plannerMode', 'change', onPlannerModeChanged);
  on('focusMinutesTarget', 'input', saveSettingsInputs);
  on('bufferMinutes', 'input', saveSettingsInputs);
  on('aiServiceName', 'input', saveSettingsInputs);
  on('aiServiceUrl', 'input', saveSettingsInputs);
  on('aiPlanningDays', 'input', saveSettingsInputs);
  on('planningGranularityMinutes', 'change', saveSettingsInputs);
  on('chatgptUrl', 'input', saveSettingsInputs);
  on('geminiUrl', 'input', saveSettingsInputs);
  on('campusPortalUrl', 'input', saveSettingsInputs);

  on('fatigueDownBtn', 'click', () => { adjustFatigue(-1); closeStateUpdateMenu(); });
  on('fatigueUpBtn', 'click', () => { adjustFatigue(1); closeStateUpdateMenu(); });
  on('unexpected30Btn', 'click', () => { addUnexpectedThirtyMinutes(); closeStateUpdateMenu(); });
  on('forceReplanBtn', 'click', () => { setPlannerMode('replan'); closeStateUpdateMenu(); });
  on('endDayBtn', 'click', () => { setPlannerMode('night'); closeStateUpdateMenu(); });

  on('generateBtn', 'click', generatePrompt);
  on('copyBtn', 'click', copyPrompt);

  on('executionSearchInput', 'input', (event) => setExecutionSearchQuery(event?.target?.value || ''));
  on('clearExecutionSearchBtn', 'click', () => clearExecutionSearchQuery());

  on('quickAddBtn', 'click', handleQuickAdd);
  $('quickAddInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleQuickAdd();
    }
  });

  document.querySelectorAll('[data-quick-example]').forEach((button) => {
    button.addEventListener('click', () => {
      const value = button.getAttribute('data-quick-example') || '';
      if ($('quickAddInput')) $('quickAddInput').value = value;
      $('quickAddInput')?.focus();
    });
  });

  on('exportBtn', 'click', exportData);
  on('importInput', 'change', importData);
  on('restoreBackupBtn', 'click', restoreLastSnapshot);

  on('connectGoogleBtn', 'click', onConnectGoogle);
  on('disconnectGoogleBtn', 'click', onDisconnectGoogle);
  on('reloadGoogleEventsBtn', 'click', async () => {
    await loadGoogleEventsForSelectedDate();
  });
  on('jumpToExecutionBtn', 'click', () => {
    window.workspaceNavApi?.activateSection?.('todayListSection', { userInitiated: true });
  });
  on('importGoogleToLocalBtn', 'click', () => {
    importGoogleEventsToLocal($('selectedDate')?.value || '');
  });

  on('openAiServiceLinkBtn', 'click', () => openConfiguredExternalLink($('aiServiceUrl')?.value || state.settings?.aiServiceUrl || state.settings?.chatgptUrl, $('aiServiceName')?.value || state.settings?.aiServiceName || 'AI'));
  on('openChatgptLinkBtn', 'click', () => openConfiguredExternalLink($('chatgptUrl')?.value || state.settings?.chatgptUrl, 'ChatGPT'));
  on('openGeminiLinkBtn', 'click', () => openConfiguredExternalLink($('geminiUrl')?.value || state.settings?.geminiUrl, 'Gemini'));
  on('openCampusPortalLinkBtn', 'click', () => openConfiguredExternalLink($('campusPortalUrl')?.value || state.settings?.campusPortalUrl, '大学ポータル'));
  on('cleanupOneOffEventsBtn', 'click', cleanupPastOneOffEvents);
  on('restoreDismissedOneOffEventsBtn', 'click', restoreDismissedOneOffEvents);
  on('openTravelRouteEditorBtn', 'click', openTravelRouteFormForCreate);

  on('eventAllDay', 'change', toggleEventTimeInputs);

  refreshRecoveryUi();
}
