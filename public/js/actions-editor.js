import { $, getFormValue } from './utils.js';
import { formatDateInput } from './time.js';
import { loadConditionInputsForDate, hydrateSettingsInputs } from './render.js';

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

export function bindEditorDrawerUi() {
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

export function focusFormPanel(panelId, form, focusSelector = 'input, select, textarea') {
  const editorKey = getEditorKeyByPanelId(panelId);
  if (!editorKey) return;
  openEditorDrawer(editorKey, { focusSelector });
}

export function openTravelRouteFormForCreate() {
  resetTravelRouteForm({ keepPanelOpen: true });
  const form = $('travelRouteForm');
  const appSettingsPanel = $('appSettingsPanel');
  const formPanel = $('travelRouteFormPanel');
  if (appSettingsPanel) appSettingsPanel.open = true;
  if (formPanel) formPanel.open = true;
  window.workspaceNavApi?.openUtilityPanel?.('appSettingsPanel', { scrollTargetId: 'travelRouteFormPanel' });
  requestAnimationFrame(() => form?.querySelector("input[name='fromPlace']")?.focus());
}

export function resetTravelRouteForm(options = {}) {
  const form = $('travelRouteForm');
  if (!form) return;
  form.reset();
  form.elements.editId.value = '';
  if (form.elements.method) form.elements.method.value = 'walk';
  if (form.elements.timetableMode) form.elements.timetableMode.value = 'daily';
  if ($('travelRouteSubmitBtn')) $('travelRouteSubmitBtn').textContent = '移動ルートを追加';
  if ($('travelRouteCancelBtn')) $('travelRouteCancelBtn').hidden = true;
  if (!options.keepPanelOpen) {
    const formPanel = $('travelRouteFormPanel');
    if (formPanel) formPanel.open = false;
  }
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
  if (form.elements.repeatDaily) form.elements.repeatDaily.checked = false;
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
