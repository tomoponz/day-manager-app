import { state, saveState, normalizeOneOffEvent, normalizePlanningGranularity } from './state.js';
import { $ } from './utils.js';
import { formatDateInput, formatTimeOnly, isSelectedDateToday, roundToFiveMinutes } from './time.js';
import { renderAll, renderCurrentClock, renderCurrentState, renderAutoPlan, renderSummaries, renderTodayActionDeck, updateStateNote, loadConditionInputsForDate } from './render.js';
import { loadGoogleEventsForDate, hasValidGoogleToken } from './google-calendar.js';
import { showToast } from './ui-feedback.js';

export function closeStateUpdateMenu() {
  const menu = $('stateUpdateMenu');
  if (menu) menu.open = false;
}

export function refreshPlannerOutputs({ includeClock = false } = {}) {
  if (includeClock) renderCurrentClock();
  renderCurrentState();
  renderSummaries();
  renderAutoPlan();
  renderTodayActionDeck();
}

export function saveSettingsInputs() {
  state.settings.focusMinutesTarget = Math.max(0, Number($('focusMinutesTarget')?.value || 0));
  state.settings.bufferMinutes = Math.max(0, Number($('bufferMinutes')?.value || 0));
  state.settings.aiServiceName = String($('aiServiceName')?.value || state.settings?.aiServiceName || 'AI').trim() || 'AI';
  state.settings.aiServiceUrl = normalizeHttpUrl($('aiServiceUrl')?.value || state.settings?.aiServiceUrl || state.settings?.chatgptUrl || '');
  state.settings.aiPlanningDays = Math.min(14, Math.max(1, Number($('aiPlanningDays')?.value || state.settings?.aiPlanningDays || 1) || 1));
  state.settings.planningGranularityMinutes = normalizePlanningGranularity($('planningGranularityMinutes')?.value || state.settings?.planningGranularityMinutes || 10, 10);
  state.settings.chatgptUrl = normalizeHttpUrl($('chatgptUrl')?.value || state.settings?.chatgptUrl || state.settings?.aiServiceUrl || '');
  state.settings.geminiUrl = normalizeHttpUrl($('geminiUrl')?.value || state.settings?.geminiUrl || '');
  state.settings.campusPortalUrl = normalizeHttpUrl($('campusPortalUrl')?.value || state.settings?.campusPortalUrl || '');
  saveState();
  refreshPlannerOutputs();
}

export function normalizeHttpUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return /^https?:\/\//i.test(text) ? text : '';
}

export function openConfiguredExternalLink(url, label) {
  const normalized = normalizeHttpUrl(url);
  if (!normalized) {
    showToast(`${label} のURLが未設定です。`, { variant: 'warn' });
    return;
  }
  window.open(normalized, '_blank', 'noopener,noreferrer');
}

export async function onDateChanged() {
  const date = $('selectedDate')?.value || '';
  if (!date) return;
  loadConditionInputsForDate(date);
  const eventDateInput = document.querySelector("#eventForm input[name='date']");
  if (eventDateInput && !getFormValue('eventForm', 'editId')) eventDateInput.value = date;
  if (hasValidGoogleToken()) await loadGoogleEventsForDate(date, { silent: true });
  renderAll();
}

export function saveCurrentConditionInputs() {
  const date = $('selectedDate')?.value;
  if (!date) return;
  state.dayConditions[date] = {
    sleepHours: $('sleepHours')?.value || '',
    fatigue: $('fatigue')?.value || '',
    note: $('conditionNote')?.value.trim() || ''
  };
  saveState();
  refreshPlannerOutputs();
}

export function adjustFatigue(delta) {
  const current = Number($('fatigue')?.value || 0);
  const next = Math.max(0, Math.min(10, current + delta));
  if ($('fatigue')) $('fatigue').value = String(next);
  saveCurrentConditionInputs();
  if (delta < 0) updateStateNote('体力を下げたので、重いタスクの優先度を少し落として再設計します。');
  else updateStateNote('体力を更新しました。実行案を再計算します。');
  showToast(`体力を ${next} に更新しました。`, { variant: 'ok', duration: 1800 });
}

export function addUnexpectedThirtyMinutes() {
  if (!isSelectedDateToday($('selectedDate')?.value || '')) {
    showToast('ワンタップの想定外30分は、対象日が今日のときだけ使えます。', { variant: 'warn' });
    return;
  }
  const rounded = roundToFiveMinutes(new Date());
  const end = new Date(rounded.getTime() + 30 * 60 * 1000);
  state.oneOffEvents.push(normalizeOneOffEvent({
    id: crypto.randomUUID(),
    title: '想定外対応',
    date: formatDateInput(rounded),
    start: formatTimeOnly(rounded),
    end: formatTimeOnly(end),
    note: 'ワンタップ報告 / 自動追加',
    allDay: false,
    googleSyncStatus: 'local'
  }));
  saveState();
  updateStateNote('想定外30分を追加したので、残り時間を基準に再設計します。');
  renderAll();
  showToast('想定外30分を追加しました。', { variant: 'ok', duration: 2200 });
}

export function setPlannerMode(mode) {
  state.uiState.plannerMode = mode;
  saveState();
  if ($('plannerMode')) $('plannerMode').value = mode;
  refreshPlannerOutputs({ includeClock: true });
  generatePrompt();
}

export function onPlannerModeChanged() {
  state.uiState.plannerMode = $('plannerMode')?.value || 'auto';
  saveState();
  refreshPlannerOutputs({ includeClock: true });
}
