import { state, saveState, normalizePlanningDraft, normalizeOneOffEvent } from './state.js';
import { getWeekDates, getWeekKey, getWeekLabel, formatDateInput, formatDateTimeForDisplay, getNowContext } from './time.js';
import { getSchedulesForDate, getUpcomingTasks, getPendingTasks, computeFreeSlots, formatScheduleLine } from './planner.js';
import { hasValidGoogleToken, upsertGoogleEventFromLocal, cacheGoogleEvent, getErrorMessage } from './google-calendar.js';
import { captureRecoverySnapshot } from './recovery.js';

export function buildGeminiPlanningPrompt(selectedDate = formatDateInput(new Date())) {
  const safeDate = selectedDate || formatDateInput(new Date());
  const weekDates = getWeekDates(safeDate);
  const weekLabel = getWeekLabel(safeDate);
  const weekKey = getWeekKey(safeDate);
  const pendingTasks = getPendingTasks(safeDate);
  const upcomingDeadlines = getUpcomingTasks(safeDate, 7 * 24);

  const lines = [
    'あなたは日程調整AIです。以下の情報をもとに、予定提案JSONのみを返してください。',
    '説明文、Markdown、コードフェンスは不要です。必ずJSONだけを返してください。',
    '',
    '返却形式:',
    '{',
    '  "proposedEvents": [',
    '    {',
    '      "title": "予定名",',
    '      "date": "YYYY-MM-DD",',
    '      "start": "HH:MM",',
    '      "end": "HH:MM",',
    '      "allDay": false,',
    '      "note": "補足",',
    '      "reason": "その時間に置いた理由"',
    '    }',
    '  ]',
    '}',
    '',
    '制約:',
    '- 既存予定と重複させない',
    '- allDay が false のときは start と end を必ず入れる',
    '- 1件あたり20分以上にする',
    '- 課題の締切が近いものを優先する',
    '- 現実的な長さで配置する',
    '- date はこの週の範囲に収める',
    '',
    `対象基準日: ${safeDate}`,
    `対象週: ${weekLabel}`,
    `週キー: ${weekKey}`,
    '',
    '未完了タスク:',
    pendingTasks.length
      ? pendingTasks.map((task) => `- ${task.title} / 分類:${task.category || 'なし'} / 締切:${task.deadlineDate || '未設定'}${task.deadlineTime ? ` ${task.deadlineTime}` : ''} / 見積:${task.estimate || '?'}分 / 重要度:${task.importance} / 優先度:${task.priority} / 状態:${task.status}${task.note ? ` / ${task.note}` : ''}`).join('\n')
      : '- なし',
    '',
    '7日以内の締切:',
    upcomingDeadlines.length
      ? upcomingDeadlines.map((task) => `- ${task.title} / ${task.deadlineDate}${task.deadlineTime ? ` ${task.deadlineTime}` : ''} / 重要度:${task.importance} / 優先度:${task.priority}`).join('\n')
      : '- なし',
    '',
    '日別の既存予定と空き時間:'
  ];

  weekDates.forEach((date) => {
    const ctx = getNowContext(date, state.uiState?.plannerMode || 'auto');
    const schedules = getSchedulesForDate(date);
    const freeSlots = computeFreeSlots(schedules, ctx);
    lines.push(`## ${date}`);
    lines.push('既存予定:');
    lines.push(schedules.length ? schedules.map((item) => `- ${formatScheduleLine(item)}`).join('\n') : '- なし');
    lines.push('空き時間候補:');
    lines.push(freeSlots.length ? freeSlots.map((slot) => `- ${slot.start} - ${slot.end} (${slot.minutes}分)`).join('\n') : '- ほぼなし');
    lines.push('');
  });

  lines.push('JSONのみを返してください。');
  return lines.join('\n');
}

export function parsePlanningDraftsResponse(rawText, fallbackDate = formatDateInput(new Date())) {
  const cleaned = stripJsonFence(String(rawText || '').trim());
  if (!cleaned) {
    return { ok: false, error: 'AI提案JSONが空です。' };
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { ok: false, error: 'JSONとして読めませんでした。Geminiの返答をそのまま貼り付けてください。' };
  }

  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.proposedEvents)
      ? parsed.proposedEvents
      : [];

  if (!list.length) {
    return { ok: false, error: 'proposedEvents が見つかりませんでした。' };
  }

  const drafts = [];
  const errors = [];

  list.forEach((item, index) => {
    const normalized = normalizeProposalItem(item, fallbackDate);
    if (!normalized.ok) {
      errors.push(`${index + 1}件目: ${normalized.error}`);
      return;
    }
    drafts.push(normalized.draft);
  });

  if (!drafts.length) {
    return { ok: false, error: errors[0] || '有効な提案がありませんでした。' };
  }

  return {
    ok: true,
    drafts,
    skipped: errors.length,
    warnings: errors
  };
}

export function replacePlanningDrafts(drafts) {
  if (state.planningDrafts.length || (drafts || []).length) {
    captureRecoverySnapshot('replace-planning-drafts');
  }
  state.planningDrafts = (drafts || []).map(normalizePlanningDraft);
  saveState();
  return state.planningDrafts;
}

export function clearPlanningDrafts() {
  if (!state.planningDrafts.length) return;
  captureRecoverySnapshot('clear-planning-drafts');
  state.planningDrafts = [];
  saveState();
}

export function deletePlanningDraft(id) {
  const exists = state.planningDrafts.some((item) => item.id === id);
  if (!exists) return;
  captureRecoverySnapshot('delete-planning-draft');
  state.planningDrafts = state.planningDrafts.filter((item) => item.id !== id);
  saveState();
}

export async function applyPlanningDraft(id, { syncToGoogle = false, captureSnapshot = true } = {}) {
  const draft = state.planningDrafts.find((item) => item.id === id);
  if (!draft) {
    return { ok: false, error: '提案が見つかりません。' };
  }
  if (syncToGoogle && !hasValidGoogleToken()) {
    return { ok: false, error: 'Google に接続してから実行してください。' };
  }

  if (captureSnapshot) {
    captureRecoverySnapshot(syncToGoogle ? 'apply-planning-draft-google' : 'apply-planning-draft-local');
  }

  const localEvent = toLocalEventFromDraft(draft);
  if (isDuplicateLocalEvent(localEvent)) {
    draft.status = 'skipped';
    saveState();
    return { ok: true, applied: false, skipped: true, mode: syncToGoogle ? 'google' : 'local' };
  }

  state.oneOffEvents.push(localEvent);

  try {
    if (syncToGoogle) {
      const created = await upsertGoogleEventFromLocal(localEvent);
      localEvent.googleEventId = created.id;
      localEvent.googleSyncStatus = 'synced';
      cacheGoogleEvent(created, localEvent.date);
      draft.status = 'applied-google';
    } else {
      draft.status = 'applied-local';
    }
    saveState();
    return { ok: true, applied: true, skipped: false, mode: syncToGoogle ? 'google' : 'local' };
  } catch (error) {
    if (syncToGoogle) {
      localEvent.googleSyncStatus = 'failed';
      draft.status = 'failed';
      saveState();
      return { ok: false, error: getErrorMessage(error), applied: true, skipped: false, mode: 'google' };
    }
    draft.status = 'applied-local';
    saveState();
    return { ok: true, applied: true, skipped: false, mode: 'local' };
  }
}

export async function applyAllPlanningDrafts({ syncToGoogle = false } = {}) {
  if (syncToGoogle && !hasValidGoogleToken()) {
    return { ok: false, error: 'Google に接続してから実行してください。' };
  }

  const targets = state.planningDrafts.filter((item) => item.status === 'draft' || item.status === 'failed');
  if (!targets.length) {
    return { ok: true, applied: 0, skipped: 0, failed: 0 };
  }

  captureRecoverySnapshot(syncToGoogle ? 'apply-planning-drafts-google' : 'apply-planning-drafts-local');

  let applied = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  for (const draft of targets) {
    const result = await applyPlanningDraft(draft.id, { syncToGoogle, captureSnapshot: false });
    if (result.applied && result.ok) {
      applied += 1;
      continue;
    }
    if (result.skipped) {
      skipped += 1;
      continue;
    }
    if (!result.ok) {
      failed += 1;
      if (result.error) errors.push(result.error);
    }
  }

  return { ok: failed === 0, applied, skipped, failed, errors };
}

function normalizeProposalItem(item, fallbackDate) {
  const title = String(item?.title || '').trim();
  if (!title) {
    return { ok: false, error: 'title がありません。' };
  }

  const date = String(item?.date || item?.targetDate || fallbackDate || '').trim();
  if (!isDateString(date)) {
    return { ok: false, error: `date が不正です (${date || '空'})` };
  }

  const allDay = Boolean(item?.allDay);
  const start = allDay ? '' : normalizeTimeText(item?.start);
  const end = allDay ? '' : normalizeTimeText(item?.end);

  if (!allDay && (!start || !end)) {
    return { ok: false, error: 'allDay=false の提案には start と end が必要です。' };
  }

  const draft = normalizePlanningDraft({
    draftType: 'calendar-event',
    title,
    targetDate: date,
    targetWeekKey: getWeekKey(date),
    start,
    end,
    allDay,
    note: String(item?.note || '').trim(),
    reason: String(item?.reason || '').trim(),
    status: 'draft',
    source: 'gemini',
    createdAt: formatDateTimeForDisplay(new Date())
  });

  return { ok: true, draft };
}

function toLocalEventFromDraft(draft) {
  return normalizeOneOffEvent({
    id: crypto.randomUUID(),
    title: draft.title,
    date: draft.targetDate,
    start: draft.allDay ? '' : draft.start,
    end: draft.allDay ? '' : draft.end,
    note: buildDraftNote(draft),
    allDay: Boolean(draft.allDay),
    googleSyncStatus: 'local'
  });
}

function buildDraftNote(draft) {
  const parts = [];
  if (draft.note) parts.push(draft.note);
  if (draft.reason) parts.push(`AI理由: ${draft.reason}`);
  return parts.join(' / ');
}

function isDuplicateLocalEvent(candidate) {
  return state.oneOffEvents.some((item) =>
    item.date === candidate.date &&
    item.title === candidate.title &&
    (item.start || '') === (candidate.start || '') &&
    (item.end || '') === (candidate.end || '') &&
    Boolean(item.allDay) === Boolean(candidate.allDay)
  );
}

function stripJsonFence(text) {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function normalizeTimeText(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return '';
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function isDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}
