import { state, saveState, STATE_SCHEMA_VERSION, normalizeOneOffEvent, normalizeFixedSchedule, normalizeTask, normalizeStudyLocation, normalizeTravelRoute, normalizeCourse, normalizeMaterial, normalizeAssessment, normalizeWeeklyPlans, normalizeMilestone, normalizePlanningDraft } from './state.js';
import { $, getFormValue } from './utils.js';
import { addDays, formatDateInput, formatTimeOnly, isValidTimeRange } from './time.js';
import { renderAll, hydrateSettingsInputs, loadConditionInputsForDate } from './render.js';
import { renderStudyManager } from './study-manager.js';
import { loadGoogleEventsForDate, hasValidGoogleToken, upsertGoogleEventFromLocal, syncLocalEventToGoogle, syncUpdatedLocalEventToGoogle, deleteLocalEvent, deleteGoogleEventById } from './google-calendar.js';
import { parseQuickAddInput } from './quick-add.js';
import { showToast, confirmDialog } from './ui-feedback.js';
import { normalizePersistedState, applyPersistedState, captureRecoverySnapshot, restoreRecoverySnapshot, refreshRecoveryUi } from './recovery.js';
import { getVisibleOneOffEvents, isCleanupCandidateEvent, findStudyLocationIdByName, resolvePlaceName } from './travel.js';
import { focusFormPanel, resetFixedForm, resetEventForm, resetTaskForm, resetStudyLocationForm, openTravelRouteFormForCreate, resetTravelRouteForm, openFixedFormForCreate, openEventFormForCreate, openTaskFormForCreate } from './actions-editor.js';

function getSelectedTaskDate() {
  return $('selectedDate')?.value || formatDateInput(new Date());
}

function hasTaskCompletedOnDate(task, dateStr = getSelectedTaskDate()) {
  return Boolean(task.repeatDaily && Array.isArray(task.completedDates) && task.completedDates.includes(dateStr));
}

function setTaskCompletionForDate(task, dateStr, completed) {
  const dates = Array.isArray(task.completedDates) ? task.completedDates.filter(Boolean) : [];
  const next = dates.filter((value) => value !== dateStr);
  if (completed) next.push(dateStr);
  task.completedDates = [...new Set(next)].sort();
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
    placeName: String(fd.get('placeName') || '').trim(),
    placeId: findStudyLocationIdByName(String(fd.get('placeName') || '').trim()),
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
    placeName: String(fd.get('placeName') || '').trim(),
    placeId: findStudyLocationIdByName(String(fd.get('placeName') || '').trim()),
    lifecycleStatus: 'active',
    hiddenAt: '',
    archivedAt: '',
    completedAt: '',
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
    target.lifecycleStatus = 'active';
    target.hiddenAt = '';
    target.dismissedAt = '';
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
    protectTimeBlock: Boolean(fd.get('protectTimeBlock')),
    repeatDaily: Boolean(fd.get('repeatDaily'))
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

export function onSubmitTravelRoute(e) {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const editingId = String(fd.get('editId') || '');
  const departureTimetableText = String(fd.get('departureTimetableText') || '').trim();
  const arrivalTimetableText = String(fd.get('arrivalTimetableText') || '').trim();
  const payload = normalizeTravelRoute({
    id: editingId || crypto.randomUUID(),
    fromPlace: String(fd.get('fromPlace') || '').trim(),
    fromPlaceId: findStudyLocationIdByName(String(fd.get('fromPlace') || '').trim()),
    toPlace: String(fd.get('toPlace') || '').trim(),
    toPlaceId: findStudyLocationIdByName(String(fd.get('toPlace') || '').trim()),
    method: String(fd.get('method') || 'walk').trim(),
    durationMinutes: String(fd.get('durationMinutes') || '').trim(),
    timetableMode: String(fd.get('timetableMode') || 'daily').trim(),
    departureTimetableText,
    arrivalTimetableText,
    timetableText: departureTimetableText,
    note: String(fd.get('note') || '').trim()
  });

  if (!payload.fromPlace || !payload.toPlace) {
    showToast('出発地と到着地を入力してください。', { variant: 'warn' });
    return;
  }

  if (editingId) {
    const target = state.travelRoutes.find((item) => item.id === editingId);
    if (!target) return;
    Object.assign(target, payload);
    showToast('移動ルートを更新しました。', { variant: 'ok', duration: 2200 });
  } else {
    state.travelRoutes.push(payload);
    showToast('移動ルートを追加しました。', { variant: 'ok', duration: 2200 });
  }

  saveState();
  resetTravelRouteForm();
  renderAll();
}

export function populateTravelRouteForm(id) {
  const item = state.travelRoutes.find((entry) => entry.id === id);
  if (!item) return;
  const form = $('travelRouteForm');
  const appSettingsPanel = $('appSettingsPanel');
  const formPanel = $('travelRouteFormPanel');
  if (!form) return;
  if (appSettingsPanel) appSettingsPanel.open = true;
  if (formPanel) formPanel.open = true;
  form.elements.editId.value = item.id;
  form.elements.fromPlace.value = resolvePlaceName(item.fromPlaceId, item.fromPlace) || item.fromPlace;
  form.elements.toPlace.value = resolvePlaceName(item.toPlaceId, item.toPlace) || item.toPlace;
  form.elements.method.value = item.method || 'walk';
  form.elements.durationMinutes.value = item.durationMinutes ?? '';
  form.elements.timetableMode.value = item.timetableMode || 'daily';
  if (form.elements.departureTimetableText) form.elements.departureTimetableText.value = item.departureTimetableText || item.timetableText || '';
  if (form.elements.arrivalTimetableText) form.elements.arrivalTimetableText.value = item.arrivalTimetableText || '';
  form.elements.note.value = item.note || '';
  if ($('travelRouteSubmitBtn')) $('travelRouteSubmitBtn').textContent = '移動ルートを更新';
  if ($('travelRouteCancelBtn')) $('travelRouteCancelBtn').hidden = false;
  window.workspaceNavApi?.openUtilityPanel?.('appSettingsPanel', { scrollTargetId: 'travelRouteFormPanel' });
  requestAnimationFrame(() => form.querySelector("input[name='fromPlace']")?.focus());
}

export async function deleteTravelRoute(id) {
  const item = state.travelRoutes.find((entry) => entry.id === id);
  if (!item) return;
  const index = state.travelRoutes.findIndex((entry) => entry.id === id);
  captureRecoverySnapshot('delete-travel-route');
  state.travelRoutes = state.travelRoutes.filter((entry) => entry.id !== id);
  saveState();
  renderAll();
  showToast('移動ルートを削除しました。', {
    variant: 'ok',
    duration: 5000,
    actionLabel: '元に戻す',
    onAction: () => {
      state.travelRoutes.splice(index, 0, item);
      saveState();
      renderAll();
      showToast('移動ルートを元に戻しました。', { variant: 'ok', duration: 1800 });
    }
  });
}

export function dismissOneOffEvent(id) {
  const item = state.oneOffEvents.find((entry) => entry.id === id);
  if (!item) return;
  captureRecoverySnapshot('dismiss-event');
  const timestamp = new Date().toISOString();
  item.lifecycleStatus = 'hidden';
  item.hiddenAt = timestamp;
  item.dismissedAt = timestamp;
  saveState();
  renderAll();
  showToast('単発予定を一覧から片付けました。Google側の予定は消していません。', {
    variant: 'ok',
    duration: 5000,
    actionLabel: '元に戻す',
    onAction: () => {
      item.lifecycleStatus = 'active';
      item.hiddenAt = '';
      item.dismissedAt = '';
      saveState();
      renderAll();
      showToast('単発予定を一覧に戻しました。', { variant: 'ok', duration: 1800 });
    }
  });
}

export function cleanupPastOneOffEvents() {
  const targets = getVisibleOneOffEvents(state.oneOffEvents).filter((item) => isCleanupCandidateEvent(item));
  if (!targets.length) {
    showToast('片付ける候補の単発予定はありません。', { variant: 'warn' });
    return;
  }
  captureRecoverySnapshot('dismiss-past-events');
  const timestamp = new Date().toISOString();
  targets.forEach((item) => {
    item.lifecycleStatus = 'hidden';
    item.hiddenAt = timestamp;
    item.dismissedAt = timestamp;
  });
  saveState();
  renderAll();
  showToast(`${targets.length}件の単発予定を一覧から片付けました。`, {
    variant: 'ok',
    duration: 5000,
    actionLabel: '元に戻す',
    onAction: () => {
      targets.forEach((item) => {
        item.lifecycleStatus = 'active';
        item.hiddenAt = '';
        item.dismissedAt = '';
      });
      saveState();
      renderAll();
      showToast('単発予定を一覧に戻しました。', { variant: 'ok', duration: 1800 });
    }
  });
}

export function restoreDismissedOneOffEvents() {
  const targets = (state.oneOffEvents || []).filter((item) => String(item.dismissedAt || '').trim());
  if (!targets.length) {
    showToast('戻せる単発予定はありません。', { variant: 'warn' });
    return;
  }
  targets.forEach((item) => {
    item.lifecycleStatus = 'active';
    item.hiddenAt = '';
    item.dismissedAt = '';
  });
  saveState();
  renderAll();
  showToast(`${targets.length}件の単発予定を一覧に戻しました。`, { variant: 'ok', duration: 2200 });
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
  if (form.elements.placeName) form.elements.placeName.value = resolvePlaceName(item.placeId, item.placeName) || '';
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
  if (form.elements.placeName) form.elements.placeName.value = resolvePlaceName(item.placeId, item.placeName) || '';
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
  state.oneOffEvents.push({ ...item, id: crypto.randomUUID(), title: `${item.title} (複製)`, googleEventId: '', googleSyncStatus: 'local', lifecycleStatus: 'active', hiddenAt: '', archivedAt: '', completedAt: '', dismissedAt: '' });
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
  if (item.repeatDaily) {
    const selectedDate = getSelectedTaskDate();
    if (status === '完了') {
      setTaskCompletionForDate(item, selectedDate, true);
      item.status = '未着手';
      item.deferUntilDate = '';
      saveState();
      renderAll();
      showToast('今日の継続タスクを完了にしました。', { variant: 'ok', duration: 1800 });
      return;
    }
    setTaskCompletionForDate(item, selectedDate, false);
    item.status = status === '進行中' ? '進行中' : '未着手';
    saveState();
    renderAll();
    showToast(`継続タスク状態を「${status}」に変更しました。`, { variant: 'ok', duration: 1800 });
    return;
  }
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
  if (form.elements.repeatDaily) form.elements.repeatDaily.checked = Boolean(item.repeatDaily);
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

export function exportData() {
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

export function importData(e) {
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

export async function restoreLastSnapshot() {
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
