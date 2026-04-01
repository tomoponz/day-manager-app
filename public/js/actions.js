import { state, saveState, STATE_SCHEMA_VERSION, normalizeOneOffEvent, normalizeFixedSchedule, normalizeTask, normalizeStudyLocation, normalizeCourse, normalizeMaterial, normalizeAssessment, normalizeWeeklyPlans, normalizeMilestone, normalizePlanningDraft } from './state.js';
import { $, debounce, getFormValue } from './utils.js';
import { addDays, formatDateInput, formatTimeOnly, isSelectedDateToday, isValidTimeRange, roundToFiveMinutes } from './time.js';
import { renderAll, renderCurrentClock, renderCurrentState, renderAutoPlan, renderSummaries, renderTodayActionDeck, updateStateNote, loadConditionInputsForDate, hydrateSettingsInputs } from './render.js';
import { renderStudyManager } from './study-manager.js';
import {
  loadGoogleEventsForDate,
  hasValidGoogleToken,
  upsertGoogleEventFromLocal,
  syncLocalEventToGoogle,
  syncUpdatedLocalEventToGoogle,
  deleteLocalEvent,
  deleteGoogleEventById,
  onConnectGoogle,
  onDisconnectGoogle,
  loadGoogleEventsForSelectedDate,
  importGoogleEventsToLocal
} from './google-calendar.js';
import { generatePrompt, copyPrompt } from './prompt.js';
import { parseQuickAddInput } from './quick-add.js';
import { showToast, confirmDialog } from './ui-feedback.js';
import {
  normalizePersistedState,
  applyPersistedState,
  captureRecoverySnapshot,
  restoreRecoverySnapshot,
  refreshRecoveryUi
} from './recovery.js';

function on(id, event, handler) {
  $(id)?.addEventListener(event, handler);
}

export function setToday() {
  const today = formatDateInput(new Date());
  if ($('selectedDate')) $('selectedDate').value = today;
  if ($('selectedDate')) loadConditionInputsForDate(today);
  const eventDateInput = document.querySelector("#eventForm input[name='date']");
  if (eventDateInput) eventDateInput.value = today;
  hydrateSettingsInputs();
}

function setPanelOpen(panelId, isOpen) {
  const panel = $(panelId);
  if (panel) panel.open = isOpen;
}

const EDITOR_DRAWER_CONFIG = {
  fixed: {
    panelId: 'fixedFormPanel',
    title: '固定予定を追加・編集',
    eyebrow: 'Recurring schedule',
    description: '毎週くり返す授業・通学・食事などを、カレンダーを見ながらその場で更新します。'
  },
  event: {
    panelId: 'eventFormPanel',
    title: '単発予定を追加・編集',
    eyebrow: 'One-off event',
    description: '面談・締切・外出など、その日だけの予定をスクロールせずに追加します。'
  },
  task: {
    panelId: 'taskFormPanel',
    title: 'タスクを追加・編集',
    eyebrow: 'Task editor',
    description: '課題・復習・生活タスクを、今日の文脈を見たまま処理します。'
  }
};

let editorDrawerBound = false;
let lastEditorTrigger = null;

function getEditorKeyByPanelId(panelId) {
  return Object.entries(EDITOR_DRAWER_CONFIG).find(([, config]) => config.panelId === panelId)?.[0] || null;
}

function updateEditorDrawerHeader(editorKey) {
  const config = EDITOR_DRAWER_CONFIG[editorKey];
  if (!config) return;
  if ($('plannerEditorTitle')) $('plannerEditorTitle').textContent = config.title;
  if ($('plannerEditorEyebrow')) $('plannerEditorEyebrow').textContent = config.eyebrow;
  if ($('plannerEditorDescription')) $('plannerEditorDescription').textContent = config.description;
  document.querySelectorAll('[data-editor-target]').forEach((button) => {
    const active = button.getAttribute('data-editor-target') === editorKey;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function updateEditorDrawerCards(editorKey = '') {
  const body = $('plannerEditorBody');
  if (body) {
    if (editorKey) body.setAttribute('data-active-editor', editorKey);
    else body.removeAttribute('data-active-editor');
  }
  document.querySelectorAll('[data-editor-card]').forEach((card) => {
    const active = !!editorKey && card.getAttribute('data-editor-card') === editorKey;
    card.classList.toggle('is-active', active);
    card.setAttribute('aria-hidden', String(!active));
  });
}

function bindEditorDrawerUi() {
  if (editorDrawerBound) return;
  editorDrawerBound = true;

  document.querySelectorAll('[data-open-editor-target]').forEach((button) => {
    button.addEventListener('click', () => {
      const editorKey = button.getAttribute('data-open-editor-target');
      if (!editorKey) return;
      if (editorKey === 'fixed') {
        openFixedFormForCreate();
        lastEditorTrigger = button;
        return;
      }
      if (editorKey === 'event') {
        openEventFormForCreate();
        lastEditorTrigger = button;
        return;
      }
      if (editorKey === 'task') {
        openTaskFormForCreate();
        lastEditorTrigger = button;
        return;
      }
      openEditorDrawer(editorKey, { returnFocusEl: button });
    });
  });

  document.querySelectorAll('[data-editor-target]').forEach((button) => {
    button.addEventListener('click', () => {
      const editorKey = button.getAttribute('data-editor-target');
      if (editorKey) openEditorDrawer(editorKey, { returnFocusEl: lastEditorTrigger || document.activeElement });
    });
  });

  document.querySelectorAll('[data-close-editor-drawer]').forEach((button) => {
    button.addEventListener('click', closeEditorDrawer);
  });

  document.addEventListener('keydown', (event) => {
    const shell = $('plannerEditorShell');
    if (event.key === 'Escape' && shell?.classList.contains('is-open')) {
      event.preventDefault();
      closeEditorDrawer();
    }
  });
}

export function closeEditorDrawer() {
  const shell = $('plannerEditorShell');
  if (shell) {
    shell.classList.remove('is-open');
    shell.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('editor-drawer-open');
  Object.values(EDITOR_DRAWER_CONFIG).forEach(({ panelId }) => setPanelOpen(panelId, false));
  updateEditorDrawerCards('');
  if (lastEditorTrigger instanceof HTMLElement) {
    window.setTimeout(() => lastEditorTrigger?.focus?.(), 0);
  }
}

export function openEditorDrawer(editorKey, options = {}) {
  bindEditorDrawerUi();
  const config = EDITOR_DRAWER_CONFIG[editorKey];
  const shell = $('plannerEditorShell');
  if (!config) return;

  const fallbackFocus = options.returnFocusEl || document.activeElement;
  if (fallbackFocus instanceof HTMLElement) {
    lastEditorTrigger = fallbackFocus;
  }

  const settingsPanel = $('appSettingsPanel');
  if (settingsPanel && !shell) {
    settingsPanel.open = true;
  }

  updateEditorDrawerHeader(editorKey);
  updateEditorDrawerCards(editorKey);
  Object.entries(EDITOR_DRAWER_CONFIG).forEach(([key, { panelId }]) => setPanelOpen(panelId, key === editorKey));

  if (shell) {
    shell.classList.add('is-open');
    shell.setAttribute('aria-hidden', 'false');
    document.body.classList.add('editor-drawer-open');
  }

  const panel = $(config.panelId);
  const form = panel?.querySelector('form');
  const focusSelector = options.focusSelector || 'input, select, textarea';
  requestAnimationFrame(() => {
    const focusTarget = form?.querySelector(focusSelector) || panel?.querySelector(focusSelector) || panel;
    focusTarget?.focus();
    if (focusTarget instanceof HTMLInputElement && ['text', 'search', 'url', 'tel', 'email', 'password'].includes(focusTarget.type)) {
      focusTarget.select();
    }
    if (!shell) {
      panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}

function focusFormPanel(panelId, form, focusSelector = 'input, select, textarea') {
  const editorKey = getEditorKeyByPanelId(panelId);
  if (!editorKey) return;
  openEditorDrawer(editorKey, { focusSelector });
}

function closeStateUpdateMenu() {
  const menu = $('stateUpdateMenu');
  if (menu) menu.open = false;
}


function refreshPlannerOutputs({ includeClock = false } = {}) {
  if (includeClock) renderCurrentClock();
  renderCurrentState();
  renderSummaries();
  renderAutoPlan();
  renderTodayActionDeck();
}

export function bindEvents() {
  bindEditorDrawerUi();
  const debouncedSaveCurrentConditionInputs = debounce(saveCurrentConditionInputs, 400);

  on('fixedForm', 'submit', onSubmitFixedSchedule);
  on('eventForm', 'submit', onSubmitOneOffEvent);
  on('taskForm', 'submit', onSubmitTask);
  on('studyLocationForm', 'submit', onSubmitStudyLocation);

  on('fixedCancelBtn', 'click', resetFixedForm);
  on('eventCancelBtn', 'click', resetEventForm);
  on('taskCancelBtn', 'click', resetTaskForm);
  on('studyLocationCancelBtn', 'click', resetStudyLocationForm);

  on('selectedDate', 'change', onDateChanged);

  on('sleepHours', 'input', debouncedSaveCurrentConditionInputs);
  on('fatigue', 'input', debouncedSaveCurrentConditionInputs);
  on('conditionNote', 'input', debouncedSaveCurrentConditionInputs);

  on('plannerMode', 'change', onPlannerModeChanged);
  on('focusMinutesTarget', 'input', saveSettingsInputs);
  on('bufferMinutes', 'input', saveSettingsInputs);
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

  on('openChatgptLinkBtn', 'click', () => openConfiguredExternalLink($('chatgptUrl')?.value || state.settings?.chatgptUrl, 'ChatGPT'));
  on('openGeminiLinkBtn', 'click', () => openConfiguredExternalLink($('geminiUrl')?.value || state.settings?.geminiUrl, 'Gemini'));
  on('openCampusPortalLinkBtn', 'click', () => openConfiguredExternalLink($('campusPortalUrl')?.value || state.settings?.campusPortalUrl, '大学ポータル'));

  on('eventAllDay', 'change', toggleEventTimeInputs);

  refreshRecoveryUi();
}


export function saveSettingsInputs() {
  state.settings.focusMinutesTarget = Math.max(0, Number($('focusMinutesTarget')?.value || 0));
  state.settings.bufferMinutes = Math.max(0, Number($('bufferMinutes')?.value || 0));
  state.settings.chatgptUrl = normalizeHttpUrl($('chatgptUrl')?.value || state.settings?.chatgptUrl || '');
  state.settings.geminiUrl = normalizeHttpUrl($('geminiUrl')?.value || state.settings?.geminiUrl || '');
  state.settings.campusPortalUrl = normalizeHttpUrl($('campusPortalUrl')?.value || state.settings?.campusPortalUrl || '');
  saveState();
  refreshPlannerOutputs();
}

function normalizeHttpUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return /^https?:\/\//i.test(text) ? text : '';
}

function openConfiguredExternalLink(url, label) {
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

export async function onSubmitFixedSchedule(e) {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const payload = normalizeFixedSchedule({
    id: String(fd.get('editId') || '') || crypto.randomUUID(),
    title: String(fd.get('title')).trim(),
    weekday: Number(fd.get('weekday')),
    start: String(fd.get('start')),
    end: String(fd.get('end')),
    note: String(fd.get('note')).trim()
  });
  if (!payload.title) {
    showToast('タイトルを入力してください。', { variant: 'warn' });
    return;
  }
  if (!isValidTimeRange(payload.start, payload.end)) {
    showToast('固定予定は開始時刻より後の終了時刻を設定してください。', { variant: 'warn' });
    return;
  }
  const editingId = String(fd.get('editId') || '');
  if (editingId) {
    const target = state.fixedSchedules.find((item) => item.id === editingId);
    if (!target) return;
    Object.assign(target, payload);
    showToast('固定予定を更新しました。', { variant: 'ok', duration: 2200 });
  } else {
    state.fixedSchedules.push(payload);
    showToast('固定予定を追加しました。', { variant: 'ok', duration: 2200 });
  }
  saveState();
  resetFixedForm();
  renderAll();
}

export async function onSubmitOneOffEvent(e) {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const editingId = String(fd.get('editId') || '');
  const allDay = Boolean(fd.get('allDay'));
  const payload = normalizeOneOffEvent({
    id: editingId || crypto.randomUUID(),
    title: String(fd.get('title')).trim(),
    date: String(fd.get('date')),
    start: allDay ? '' : String(fd.get('start') || ''),
    end: allDay ? '' : String(fd.get('end') || ''),
    note: String(fd.get('note')).trim(),
    allDay
  });
  if (!payload.title || !payload.date) {
    showToast('タイトルと日付を入力してください。', { variant: 'warn' });
    return;
  }
  if (!payload.allDay && payload.start && payload.end && !isValidTimeRange(payload.start, payload.end)) {
    showToast('単発予定は開始時刻より後の終了時刻を設定してください。', { variant: 'warn' });
    return;
  }
  const shouldSyncToGoogle = Boolean(fd.get('syncToGoogle'));
  let target = editingId ? state.oneOffEvents.find((item) => item.id === editingId) : null;
  if (target) {
    Object.assign(target, payload);
    if (target.googleEventId) {
      if (hasValidGoogleToken()) {
        try {
          await upsertGoogleEventFromLocal(target);
          target.googleSyncStatus = 'synced';
        } catch {
          target.googleSyncStatus = 'outdated';
        }
      } else {
        target.googleSyncStatus = 'outdated';
      }
    } else if (shouldSyncToGoogle && hasValidGoogleToken()) {
      await tryCreateGoogleForLocalEvent(target);
    } else if (shouldSyncToGoogle) {
      target.googleSyncStatus = 'pending';
    }
    showToast('単発予定を更新しました。', { variant: 'ok', duration: 2200 });
  } else {
    target = payload;
    if (shouldSyncToGoogle && hasValidGoogleToken()) await tryCreateGoogleForLocalEvent(target);
    else if (shouldSyncToGoogle) target.googleSyncStatus = 'pending';
    state.oneOffEvents.push(target);
    showToast('単発予定を追加しました。', { variant: 'ok', duration: 2200 });
  }
  saveState();
  resetEventForm();
  renderAll();
  if (hasValidGoogleToken() && $('selectedDate')?.value === payload.date) await loadGoogleEventsForDate(payload.date, { silent: true });
}

async function tryCreateGoogleForLocalEvent(localEvent) {
  try {
    const created = await upsertGoogleEventFromLocal(localEvent);
    localEvent.googleEventId = created.id;
    localEvent.googleSyncStatus = 'synced';
  } catch {
    localEvent.googleSyncStatus = 'failed';
  }
}

export function onSubmitTask(e) {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const editingId = String(fd.get('editId') || '');
  const payload = normalizeTask({
    id: editingId || crypto.randomUUID(),
    title: String(fd.get('title')).trim(),
    category: String(fd.get('category')).trim(),
    deadlineDate: String(fd.get('deadlineDate') || ''),
    deadlineTime: String(fd.get('deadlineTime') || ''),
    estimate: String(fd.get('estimate') || ''),
    priority: String(fd.get('priority') || '中'),
    importance: String(fd.get('importance') || 'できれば'),
    note: String(fd.get('note')).trim(),
    status: String(fd.get('status') || '未着手'),
    deferUntilDate: String(fd.get('deferUntilDate') || ''),
    protectTimeBlock: Boolean(fd.get('protectTimeBlock'))
  });
  if (!payload.title) {
    showToast('タスク名を入力してください。', { variant: 'warn' });
    return;
  }
  if (editingId) {
    const target = state.tasks.find((item) => item.id === editingId);
    if (!target) return;
    Object.assign(target, payload);
    showToast('タスクを更新しました。', { variant: 'ok', duration: 2200 });
  } else {
    state.tasks.push(payload);
    showToast('タスクを追加しました。', { variant: 'ok', duration: 2200 });
  }
  saveState();
  resetTaskForm();
  renderAll();
}

export function onSubmitStudyLocation(e) {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const editingId = String(fd.get('editId') || '');
  const weeklyHours = Object.fromEntries(
    Array.from({ length: 7 }, (_, weekday) => [String(weekday), String(fd.get(`weekly${weekday}`) || '').trim()])
  );

  const payload = normalizeStudyLocation({
    id: editingId || crypto.randomUUID(),
    name: String(fd.get('name') || '').trim(),
    kind: String(fd.get('kind') || '').trim(),
    sourceUrl: String(fd.get('sourceUrl') || '').trim(),
    travelMinutes: String(fd.get('travelMinutes') || '').trim(),
    weeklyHours,
    exceptionsText: String(fd.get('exceptionsText') || '').trim(),
    memo: String(fd.get('memo') || '').trim(),
    isPreferred: Boolean(fd.get('isPreferred'))
  });

  if (!payload.name) {
    showToast('自習場所名を入力してください。', { variant: 'warn' });
    return;
  }

  if (editingId) {
    const target = state.studyLocations.find((item) => item.id === editingId);
    if (!target) return;
    Object.assign(target, payload);
    showToast('自習場所を更新しました。', { variant: 'ok', duration: 2200 });
  } else {
    state.studyLocations.push(payload);
    showToast('自習場所を追加しました。', { variant: 'ok', duration: 2200 });
  }

  saveState();
  resetStudyLocationForm();
  renderAll();
}

export function handleQuickAdd() {
  const input = $('quickAddInput')?.value || '';
  const resultBox = $('quickAddResult');
  const parsed = parseQuickAddInput(input, $('selectedDate')?.value || formatDateInput(new Date()));
  if (!parsed.ok) {
    if (resultBox) resultBox.textContent = parsed.error;
    showToast(parsed.error, { variant: 'warn' });
    return;
  }

  if (parsed.type === 'task') {
    state.tasks.push(normalizeTask({ id: crypto.randomUUID(), ...parsed.value }));
  } else {
    state.oneOffEvents.push(normalizeOneOffEvent({ id: crypto.randomUUID(), googleSyncStatus: 'local', ...parsed.value }));
  }

  saveState();
  renderAll();
  if (resultBox) resultBox.textContent = `追加しました: ${parsed.preview}`;
  if ($('quickAddInput')) $('quickAddInput').value = '';
  showToast(`追加しました: ${parsed.preview}`, { variant: 'ok', duration: 2200 });
}

export function resetFixedForm() {
  const form = $('fixedForm');
  if (!form) return;
  form.reset();
  form.elements.editId.value = '';
  if ($('fixedSubmitBtn')) $('fixedSubmitBtn').textContent = '固定予定を追加';
  if ($('fixedCancelBtn')) $('fixedCancelBtn').hidden = true;
  closeEditorDrawer();
}

export function resetEventForm() {
  const form = $('eventForm');
  if (!form) return;
  form.reset();
  form.elements.editId.value = '';
  if ($('eventSubmitBtn')) $('eventSubmitBtn').textContent = '単発予定を追加';
  if ($('eventCancelBtn')) $('eventCancelBtn').hidden = true;
  form.elements.date.value = $('selectedDate')?.value || '';
  if ($('syncEventToGoogle')) $('syncEventToGoogle').checked = true;
  if ($('eventAllDay')) $('eventAllDay').checked = false;
  toggleEventTimeInputs();
  closeEditorDrawer();
}

export function openStudyLocationFormForCreate() {
  resetStudyLocationForm({ keepPanelOpen: true });
  const form = $('studyLocationForm');
  const appSettingsPanel = $('appSettingsPanel');
  const formPanel = $('studyLocationFormPanel');
  if (appSettingsPanel) appSettingsPanel.open = true;
  if (formPanel) formPanel.open = true;
  window.workspaceNavApi?.openUtilityPanel?.('appSettingsPanel');
  requestAnimationFrame(() => form?.querySelector("input[name='name']")?.focus());
}

export function resetStudyLocationForm(options = {}) {
  const form = $('studyLocationForm');
  if (!form) return;
  form.reset();
  form.elements.editId.value = '';
  for (let weekday = 0; weekday < 7; weekday += 1) {
    if (form.elements[`weekly${weekday}`]) form.elements[`weekly${weekday}`].value = '';
  }
  form.elements.exceptionsText.value = '';
  form.elements.memo.value = '';
  form.elements.isPreferred.checked = false;
  if ($('studyLocationSubmitBtn')) $('studyLocationSubmitBtn').textContent = '自習場所を追加';
  if ($('studyLocationCancelBtn')) $('studyLocationCancelBtn').hidden = true;
  if (!options.keepPanelOpen) {
    const formPanel = $('studyLocationFormPanel');
    if (formPanel) formPanel.open = false;
  }
}

export function resetTaskForm() {
  const form = $('taskForm');
  if (!form) return;
  form.reset();
  form.elements.editId.value = '';
  form.elements.priority.value = '中';
  form.elements.importance.value = 'できれば';
  form.elements.status.value = '未着手';
  form.elements.deferUntilDate.value = '';
  form.elements.protectTimeBlock.checked = false;
  if ($('taskSubmitBtn')) $('taskSubmitBtn').textContent = 'タスクを追加';
  if ($('taskCancelBtn')) $('taskCancelBtn').hidden = true;
  closeEditorDrawer();
}

export function toggleEventTimeInputs() {
  const form = $('eventForm');
  if (!form) return;
  const allDay = form.elements.allDay.checked;
  form.elements.start.disabled = allDay;
  form.elements.end.disabled = allDay;
  if (allDay) {
    form.elements.start.value = '';
    form.elements.end.value = '';
  }
}

export function openFixedFormForCreate() {
  resetFixedForm();
  const form = $('fixedForm');
  if (!form) return;
  focusFormPanel('fixedFormPanel', form, "input[name='title']");
}

export function openEventFormForCreate() {
  resetEventForm();
  const form = $('eventForm');
  if (!form) return;
  focusFormPanel('eventFormPanel', form, "input[name='title']");
}

export function openTaskFormForCreate() {
  resetTaskForm();
  const form = $('taskForm');
  if (!form) return;
  focusFormPanel('taskFormPanel', form, "input[name='title']");
}

export function populateFixedForm(id) {
  const item = state.fixedSchedules.find((entry) => entry.id === id);
  if (!item) return;
  const form = $('fixedForm');
  if (!form) return;
  form.elements.editId.value = item.id;
  form.elements.title.value = item.title;
  form.elements.weekday.value = String(item.weekday);
  form.elements.start.value = item.start;
  form.elements.end.value = item.end;
  form.elements.note.value = item.note;
  if ($('fixedSubmitBtn')) $('fixedSubmitBtn').textContent = '固定予定を更新';
  if ($('fixedCancelBtn')) $('fixedCancelBtn').hidden = false;
  focusFormPanel('fixedFormPanel', form, "input[name='title']");
}

export function duplicateFixedSchedule(id) {
  const item = state.fixedSchedules.find((entry) => entry.id === id);
  if (!item) return;
  state.fixedSchedules.push({ ...item, id: crypto.randomUUID(), title: `${item.title} (複製)` });
  saveState();
  renderAll();
  showToast('固定予定を複製しました。', { variant: 'ok', duration: 2200 });
}

export async function deleteFixedSchedule(id) {
  const item = state.fixedSchedules.find((entry) => entry.id === id);
  if (!item) return;
  const index = state.fixedSchedules.findIndex((entry) => entry.id === id);
  captureRecoverySnapshot('delete-fixed');
  state.fixedSchedules = state.fixedSchedules.filter((entry) => entry.id !== id);
  saveState();
  renderAll();
  showToast('固定予定を削除しました。', {
    variant: 'ok',
    duration: 5000,
    actionLabel: '元に戻す',
    onAction: () => {
      state.fixedSchedules.splice(index, 0, item);
      saveState();
      renderAll();
      showToast('固定予定を元に戻しました。', { variant: 'ok', duration: 1800 });
    }
  });
}

export function populateEventForm(id) {
  const item = state.oneOffEvents.find((entry) => entry.id === id);
  if (!item) return;
  const form = $('eventForm');
  if (!form) return;
  form.elements.editId.value = item.id;
  form.elements.title.value = item.title;
  form.elements.date.value = item.date;
  form.elements.allDay.checked = Boolean(item.allDay);
  form.elements.start.value = item.start;
  form.elements.end.value = item.end;
  form.elements.note.value = item.note;
  if ($('syncEventToGoogle')) $('syncEventToGoogle').checked = item.googleSyncStatus !== 'local';
  toggleEventTimeInputs();
  if ($('eventSubmitBtn')) $('eventSubmitBtn').textContent = '単発予定を更新';
  if ($('eventCancelBtn')) $('eventCancelBtn').hidden = false;
  focusFormPanel('eventFormPanel', form, "input[name='title']");
}

export function duplicateOneOffEvent(id) {
  const item = state.oneOffEvents.find((entry) => entry.id === id);
  if (!item) return;
  state.oneOffEvents.push({ ...item, id: crypto.randomUUID(), title: `${item.title} (複製)`, googleEventId: '', googleSyncStatus: 'local' });
  saveState();
  renderAll();
  showToast('単発予定を複製しました。', { variant: 'ok', duration: 2200 });
}

export async function deleteEvent(id) {
  captureRecoverySnapshot('delete-event');
  await deleteLocalEvent(id);
}
export async function syncEvent(id) { await syncLocalEventToGoogle(id); }
export async function syncUpdatedEvent(id) { await syncUpdatedLocalEventToGoogle(id); }

export function quickSetTaskStatus(id, status) {
  const item = state.tasks.find((entry) => entry.id === id);
  if (!item) return;
  item.status = status;
  if (status === '完了') item.deferUntilDate = '';
  saveState();
  renderAll();
  showToast(`タスク状態を「${status}」に変更しました。`, { variant: 'ok', duration: 1800 });
}

export function deferTaskToTomorrow(id) {
  const item = state.tasks.find((entry) => entry.id === id);
  if (!item) return;
  const baseDate = $('selectedDate')?.value || formatDateInput(new Date());
  item.deferUntilDate = addDays(baseDate, 1);
  item.status = item.status === '完了' ? '完了' : '未着手';
  saveState();
  renderAll();
  showToast('タスクを明日に回しました。', { variant: 'ok', duration: 2200 });
}

export function populateTaskForm(id) {
  const item = state.tasks.find((entry) => entry.id === id);
  if (!item) return;
  const form = $('taskForm');
  if (!form) return;
  form.elements.editId.value = item.id;
  form.elements.title.value = item.title;
  form.elements.category.value = item.category;
  form.elements.deadlineDate.value = item.deadlineDate;
  form.elements.deadlineTime.value = item.deadlineTime;
  form.elements.estimate.value = item.estimate;
  form.elements.priority.value = item.priority;
  form.elements.importance.value = item.importance;
  form.elements.status.value = item.status;
  form.elements.deferUntilDate.value = item.deferUntilDate;
  form.elements.note.value = item.note;
  form.elements.protectTimeBlock.checked = Boolean(item.protectTimeBlock);
  if ($('taskSubmitBtn')) $('taskSubmitBtn').textContent = 'タスクを更新';
  if ($('taskCancelBtn')) $('taskCancelBtn').hidden = false;
  focusFormPanel('taskFormPanel', form, "input[name='title']");
}

export async function deleteTask(id) {
  const item = state.tasks.find((entry) => entry.id === id);
  if (!item) return;
  const index = state.tasks.findIndex((entry) => entry.id === id);
  captureRecoverySnapshot('delete-task');
  state.tasks = state.tasks.filter((entry) => entry.id !== id);
  saveState();
  renderAll();
  showToast('タスクを削除しました。', {
    variant: 'ok',
    duration: 5000,
    actionLabel: '元に戻す',
    onAction: () => {
      state.tasks.splice(index, 0, item);
      saveState();
      renderAll();
      showToast('タスクを元に戻しました。', { variant: 'ok', duration: 1800 });
    }
  });
}

export function populateStudyLocationForm(id) {
  const item = state.studyLocations.find((entry) => entry.id === id);
  if (!item) return;
  const form = $('studyLocationForm');
  const appSettingsPanel = $('appSettingsPanel');
  const formPanel = $('studyLocationFormPanel');
  if (!form) return;
  if (appSettingsPanel) appSettingsPanel.open = true;
  if (formPanel) formPanel.open = true;
  form.elements.editId.value = item.id;
  form.elements.name.value = item.name;
  form.elements.kind.value = item.kind;
  form.elements.sourceUrl.value = item.sourceUrl || '';
  form.elements.travelMinutes.value = item.travelMinutes ?? '';
  for (let weekday = 0; weekday < 7; weekday += 1) {
    if (form.elements[`weekly${weekday}`]) form.elements[`weekly${weekday}`].value = item.weeklyHours?.[String(weekday)] || '';
  }
  form.elements.exceptionsText.value = item.exceptionsText || '';
  form.elements.memo.value = item.memo || '';
  form.elements.isPreferred.checked = Boolean(item.isPreferred);
  if ($('studyLocationSubmitBtn')) $('studyLocationSubmitBtn').textContent = '自習場所を更新';
  if ($('studyLocationCancelBtn')) $('studyLocationCancelBtn').hidden = false;
  window.workspaceNavApi?.openUtilityPanel?.('appSettingsPanel');
  requestAnimationFrame(() => form.querySelector("input[name='name']")?.focus());
}

export async function deleteStudyLocation(id) {
  const item = state.studyLocations.find((entry) => entry.id === id);
  if (!item) return;
  const index = state.studyLocations.findIndex((entry) => entry.id === id);
  captureRecoverySnapshot('delete-study-location');
  state.studyLocations = state.studyLocations.filter((entry) => entry.id !== id);
  saveState();
  renderAll();
  showToast('自習場所を削除しました。', {
    variant: 'ok',
    duration: 5000,
    actionLabel: '元に戻す',
    onAction: () => {
      state.studyLocations.splice(index, 0, item);
      saveState();
      renderAll();
      showToast('自習場所を元に戻しました。', { variant: 'ok', duration: 1800 });
    }
  });
}

export function openStudyLocationSourceUrl(id) {
  const item = state.studyLocations.find((entry) => entry.id === id);
  if (!item?.sourceUrl) {
    showToast('公式URLが未設定です。', { variant: 'warn' });
    return;
  }
  window.open(item.sourceUrl, '_blank', 'noopener,noreferrer');
}

export function markStudyLocationCheckedOpen(id) {
  const item = state.studyLocations.find((entry) => entry.id === id);
  if (!item) return;
  const selectedDate = $('selectedDate')?.value || formatDateInput(new Date());
  const defaultHours = getStudyLocationScheduledHoursText(item, selectedDate);
  let overrideHours = '';
  if (!defaultHours || !isRecognizedHoursText(defaultHours)) {
    const input = window.prompt(`${selectedDate} の営業時間を入力してください。\n例: 09:00-21:00`, defaultHours || '');
    if (input === null) return;
    overrideHours = String(input).trim();
    if (!overrideHours) {
      showToast('営業時間を入力してください。', { variant: 'warn' });
      return;
    }
  }
  upsertStudyLocationDateCheck(item, selectedDate, {
    status: 'checked_open',
    overrideHours,
    note: ''
  });
  showToast(`${item.name} を確認済みにしました。`, { variant: 'ok', duration: 1800 });
}

export function markStudyLocationCheckedClosed(id) {
  const item = state.studyLocations.find((entry) => entry.id === id);
  if (!item) return;
  const selectedDate = $('selectedDate')?.value || formatDateInput(new Date());
  upsertStudyLocationDateCheck(item, selectedDate, {
    status: 'checked_closed',
    overrideHours: '休館',
    note: ''
  });
  showToast(`${item.name} を休館として記録しました。`, { variant: 'ok', duration: 1800 });
}

export function markStudyLocationCheckedShortened(id) {
  const item = state.studyLocations.find((entry) => entry.id === id);
  if (!item) return;
  const selectedDate = $('selectedDate')?.value || formatDateInput(new Date());
  const defaultHours = getStudyLocationScheduledHoursText(item, selectedDate);
  const input = window.prompt(`${selectedDate} の営業時間を入力してください。\n例: 10:00-17:00`, defaultHours || '');
  if (input === null) return;
  const overrideHours = String(input).trim();
  if (!overrideHours) {
    showToast('営業時間を入力してください。', { variant: 'warn' });
    return;
  }
  const noteInput = window.prompt(`${selectedDate} の補足メモ（任意）`, '');
  if (noteInput === null) return;
  upsertStudyLocationDateCheck(item, selectedDate, {
    status: 'checked_shortened',
    overrideHours,
    note: String(noteInput).trim()
  });
  showToast(`${item.name} の確認結果を記録しました。`, { variant: 'ok', duration: 1800 });
}

export function clearStudyLocationDateCheck(id) {
  const item = state.studyLocations.find((entry) => entry.id === id);
  if (!item) return;
  const selectedDate = $('selectedDate')?.value || formatDateInput(new Date());
  if (!item.checksByDate?.[selectedDate]) {
    showToast('この日の確認記録はありません。', { variant: 'warn' });
    return;
  }
  item.checksByDate = { ...(item.checksByDate || {}) };
  delete item.checksByDate[selectedDate];
  saveState();
  renderAll();
  showToast(`${item.name} の確認記録を解除しました。`, { variant: 'ok', duration: 1800 });
}

function upsertStudyLocationDateCheck(item, selectedDate, patch) {
  item.checksByDate = { ...(item.checksByDate || {}) };
  item.checksByDate[selectedDate] = {
    status: patch.status || '',
    overrideHours: patch.status === 'checked_closed' ? '休館' : String(patch.overrideHours || '').trim(),
    checkedAt: new Date().toISOString(),
    note: String(patch.note || '').trim()
  };
  saveState();
  renderAll();
}

function getStudyLocationScheduledHoursText(item, selectedDate) {
  const lines = String(item?.exceptionsText || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^(\d{4}-\d{2}-\d{2})[\s　]+(.+)$/);
    if (match && match[1] === selectedDate) return match[2].trim();
  }
  const weekday = new Date(`${selectedDate}T00:00:00`).getDay();
  return item?.weeklyHours?.[String(weekday)] || '';
}

function isRecognizedHoursText(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const compact = raw.replace(/[〜～‐‑‒–—―ー]/g, '-').replace(/\s+/g, '');
  if (/^(休館|closed)$/i.test(compact)) return true;
  return /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.test(compact);
}

export async function deleteGoogleEvent(id) {
  const ok = await confirmDialog({
    title: 'Google予定を削除',
    message: 'Googleカレンダーからこの予定を削除します。よろしいですか？',
    confirmText: '削除',
    danger: true
  });
  if (!ok) return;
  captureRecoverySnapshot('delete-google-event');
  await deleteGoogleEventById(id, { removeLocalMirror: true });
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `day-manager-backup-${formatDateInput(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
  showToast('バックアップを書き出しました。', { variant: 'ok', duration: 2200 });
}

function importData(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = '';

  const reader = new FileReader();
  reader.onload = async () => {
    let parsed;
    try {
      parsed = JSON.parse(String(reader.result));
    } catch {
      showToast('JSONの読み込みに失敗しました。', { variant: 'warn' });
      return;
    }

    const ok = await confirmDialog({
      title: 'バックアップを読み込みます',
      message: '現在のデータはすべて上書きされます。続けますか？',
      confirmText: '読み込む',
      danger: true
    });
    if (!ok) return;

    try {
      const normalized = normalizePersistedState(parsed);
      captureRecoverySnapshot('import-backup');
      applyPersistedState(normalized);
      if ($('plannerMode')) $('plannerMode').value = state.uiState.plannerMode;
      if ($('selectedDate')) loadConditionInputsForDate($('selectedDate').value);
      hydrateSettingsInputs();
      renderAll();
      renderStudyManager();
      showToast('バックアップを読み込みました。問題があれば「直前状態を復元」で戻せます。', { variant: 'ok', duration: 2600 });
    } catch (error) {
      showToast(error?.message || 'バックアップの読み込みに失敗しました。', { variant: 'warn' });
    }
  };
  reader.readAsText(file, 'utf-8');
}

async function restoreLastSnapshot() {
  const meta = window.localStorage.getItem('day-manager-last-snapshot-v1');
  if (!meta) {
    showToast('復元できる自動退避がありません。', { variant: 'warn' });
    refreshRecoveryUi();
    return;
  }

  const ok = await confirmDialog({
    title: '直前状態を復元',
    message: '最後に自動退避した状態へ戻します。現在の表示内容は巻き戻されます。続けますか？',
    confirmText: '復元する',
    danger: true
  });
  if (!ok) return;

  try {
    restoreRecoverySnapshot();
    if ($('plannerMode')) $('plannerMode').value = state.uiState.plannerMode;
    if ($('selectedDate')) loadConditionInputsForDate($('selectedDate').value);
    hydrateSettingsInputs();
    renderAll();
    renderStudyManager();
    showToast('直前状態を復元しました。', { variant: 'ok', duration: 2200 });
  } catch (error) {
    showToast(error?.message || '復元に失敗しました。', { variant: 'warn' });
  }
}
