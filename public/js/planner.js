import { state } from "./state.js";
import { getCachedGoogleEvents } from "./google-calendar.js";
import { getNowContext, toMinutes, fromMinutes, formatDateInput, formatTimeOnly } from "./time.js";
import { $ } from "./utils.js";
import { getSchedulingRules, isWeekdayDate, makeProtectedBlock, describeProtectedBlock, summarizeProtectedBlocks, buildRuleModeLabel, intersectMinuteRange, clampBlockWithinSlot, minutesToTimeText } from "./scheduling-rules.js";

function currentContext(dateStr = $("selectedDate")?.value || formatDateInput(new Date())) {
  return getNowContext(dateStr, state.uiState?.plannerMode || "auto");
}

export function getSchedulesForDate(dateStr) {
  if (!dateStr) return [];
  const dateObj = new Date(`${dateStr}T00:00:00`);
  const weekday = dateObj.getDay();

  const fixed = state.fixedSchedules
    .filter((item) => item.weekday === weekday)
    .map((item) => ({ ...item, type: "fixed", date: dateStr, allDay: false }));

  const oneOff = state.oneOffEvents
    .filter((item) => item.date === dateStr)
    .map((item) => ({ ...item, type: "event" }));

  const syncedIds = new Set(oneOff.map((item) => item.googleEventId).filter(Boolean));
  const googleSchedules = getCachedGoogleEvents(dateStr)
    .filter((event) => !syncedIds.has(event.id))
    .map((event) => mapGoogleEventToSchedule(event, dateStr));

  return [...fixed, ...oneOff, ...googleSchedules].sort(compareSchedule);
}

export function mapGoogleEventToSchedule(event, fallbackDate) {
  const isAllDay = Boolean(event.start?.date && !event.start?.dateTime);
  if (isAllDay) {
    return {
      id: event.id,
      title: event.summary || "Google予定",
      start: "",
      end: "",
      note: event.description ? `Google / ${event.description}` : "Google Calendar",
      type: "google",
      source: "google",
      allDay: true,
      date: event.start?.date || fallbackDate
    };
  }

  const startDate = new Date(event.start?.dateTime || `${fallbackDate}T00:00:00`);
  const endDate = event.end?.dateTime ? new Date(event.end.dateTime) : null;

  return {
    id: event.id,
    title: event.summary || "Google予定",
    start: formatTimeOnly(startDate),
    end: endDate ? formatTimeOnly(endDate) : "",
    note: event.description ? `Google / ${event.description}` : "Google Calendar",
    type: "google",
    source: "google",
    allDay: false,
    date: formatDateInput(startDate)
  };
}

export function getUpcomingTasks(dateStr, hours = 48, ctx = currentContext(dateStr)) {
  const start = ctx.isToday ? ctx.now : new Date(`${dateStr}T00:00:00`);
  const end = new Date(start.getTime() + hours * 60 * 60 * 1000);

  return state.tasks
    .filter((task) => task.status !== "完了" && task.deadlineDate)
    .filter((task) => !task.deferUntilDate || task.deferUntilDate <= dateStr)
    .filter((task) => {
      const taskDate = new Date(`${task.deadlineDate}T${task.deadlineTime || "23:59"}:00`);
      return taskDate >= start && taskDate <= end;
    })
    .sort((a, b) => (`${a.deadlineDate}${a.deadlineTime}`).localeCompare(`${b.deadlineDate}${b.deadlineTime}`));
}

export function getPendingTasks(dateStr = $("selectedDate")?.value || formatDateInput(new Date()), ctx = currentContext(dateStr)) {
  return state.tasks.filter((task) => {
    if (task.status === "完了") return false;
    if (task.deferUntilDate && task.deferUntilDate > dateStr && ctx.effectiveMode !== "night") return false;
    return true;
  });
}

export function compareSchedule(a, b) {
  const allDayRankA = a.allDay ? 0 : 1;
  const allDayRankB = b.allDay ? 0 : 1;
  if (allDayRankA !== allDayRankB) return allDayRankA - allDayRankB;
  const aKey = `${a.start || "99:99"}${a.title}`;
  const bKey = `${b.start || "99:99"}${b.title}`;
  return aKey.localeCompare(bKey);
}

export function formatScheduleLine(item) {
  if (item.allDay) return `終日 / ${item.title}${item.note ? ` / ${item.note}` : ""}`;
  const time = item.start ? `${item.start}${item.end ? ` - ${item.end}` : ""}` : "時刻未設定";
  const note = item.note ? ` / ${item.note}` : "";
  return `${time} / ${item.title}${note}`;
}

export function splitSchedulesByNow(schedules, ctx) {
  if (!ctx.isToday) return { done: [], current: [], upcoming: schedules };
  const done = [];
  const current = [];
  const upcoming = [];

  schedules.forEach((item) => {
    if (item.allDay || !item.start) {
      upcoming.push(item);
      return;
    }
    const start = toMinutes(item.start);
    const end = item.end ? toMinutes(item.end) : start;
    if (end <= ctx.currentMinutes) done.push(item);
    else if (start <= ctx.currentMinutes && end > ctx.currentMinutes) current.push(item);
    else upcoming.push(item);
  });
  return { done, current, upcoming };
}

export function computeFreeSlots(schedules, ctx = currentContext(), options = {}) {
  const { additionalBlocks = [] } = options;
  const baseStart = toMinutes("06:00");
  const baseEnd = toMinutes("24:00");
  const buffer = Math.max(0, Number(state.settings?.bufferMinutes || 0));
  const scheduleBlocks = schedules
    .filter((item) => !item.allDay && item.start && item.end)
    .map((item) => ({
      start: Math.max(baseStart, toMinutes(item.start) - Math.floor(buffer / 2)),
      end: Math.min(baseEnd, toMinutes(item.end) + Math.ceil(buffer / 2))
    }));

  const guardBlocks = (additionalBlocks || [])
    .filter((item) => !item.allDay && item.start && item.end)
    .map((item) => ({
      start: Math.max(baseStart, toMinutes(item.start)),
      end: Math.min(baseEnd, toMinutes(item.end))
    }));

  const blocks = [...scheduleBlocks, ...guardBlocks]
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const block of blocks) {
    if (!merged.length || block.start > merged[merged.length - 1].end) merged.push({ ...block });
    else merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, block.end);
  }

  const free = [];
  let cursor = ctx.isToday ? Math.max(baseStart, ctx.currentMinutes) : baseStart;
  for (const block of merged) {
    if (block.end <= cursor) continue;
    if (block.start > cursor) free.push(makeSlot(cursor, block.start));
    cursor = Math.max(cursor, block.end);
  }
  if (cursor < baseEnd) free.push(makeSlot(cursor, baseEnd));
  return free.filter((slot) => slot.minutes >= 20);
}

export function makeSlot(start, end) {
  return { start: fromMinutes(start), end: fromMinutes(end), minutes: end - start };
}


export function buildProtectedTimeBlocks(dateStr, schedules = getSchedulesForDate(dateStr), ctx = currentContext(dateStr)) {
  if (!dateStr) return [];

  const rules = getSchedulingRules();
  const baseFreeSlots = computeFreeSlots(schedules, ctx);
  const protectedBlocks = [];

  const lunchBlock = computeLunchProtectionBlock(dateStr, rules, baseFreeSlots);
  if (lunchBlock) protectedBlocks.push(lunchBlock);

  const breakBlocks = computeRecoveryBreakBlocks(dateStr, schedules, ctx, rules, protectedBlocks);
  protectedBlocks.push(...breakBlocks);

  const focusBlock = computeFocusProtectionBlock(dateStr, schedules, ctx, rules, protectedBlocks);
  if (focusBlock) protectedBlocks.push(focusBlock);

  return protectedBlocks.sort((a, b) => `${a.start}${a.end}${a.title}`.localeCompare(`${b.start}${b.end}${b.title}`));
}

export function computeRuleAwareFreeSlots(dateStr, schedules = getSchedulesForDate(dateStr), ctx = currentContext(dateStr)) {
  const protectedBlocks = buildProtectedTimeBlocks(dateStr, schedules, ctx);
  const freeSlots = computeFreeSlots(schedules, ctx, { additionalBlocks: protectedBlocks });
  return { protectedBlocks, freeSlots };
}

function computeLunchProtectionBlock(dateStr, rules, freeSlots) {
  if (!rules.protectLunch || !isWeekdayDate(dateStr)) return null;
  const windowStart = toMinutes(rules.lunchWindowStart);
  const windowEnd = toMinutes(rules.lunchWindowEnd);
  if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd) || windowEnd <= windowStart) return null;

  for (const slot of freeSlots) {
    const slotStart = toMinutes(slot.start);
    const slotEnd = toMinutes(slot.end);
    const intersection = intersectMinuteRange(slotStart, slotEnd, windowStart, windowEnd);
    if (!intersection || intersection.minutes < rules.lunchMinutes) continue;
    const preferredStart = Math.max(intersection.start, windowStart);
    const placed = clampBlockWithinSlot(intersection.start, intersection.end, rules.lunchMinutes, preferredStart);
    if (!placed) continue;
    return makeProtectedBlock({
      date: dateStr,
      kind: "lunch",
      title: "昼休み候補",
      start: minutesToTimeText(placed.start),
      end: minutesToTimeText(placed.end),
      note: `${rules.lunchMinutes}分確保`
    });
  }

  return null;
}

function computeRecoveryBreakBlocks(dateStr, schedules, ctx, rules, protectedBlocks) {
  if (!rules.breakAfterEvent) return [];
  const freeSlots = computeFreeSlots(schedules, ctx, { additionalBlocks: protectedBlocks });
  const timedSchedules = schedules
    .filter((item) => !item.allDay && item.start && item.end)
    .sort(compareSchedule);

  const breaks = [];
  for (const schedule of timedSchedules) {
    const scheduleEnd = toMinutes(schedule.end);
    const matchingSlot = freeSlots.find((slot) => {
      const slotStart = toMinutes(slot.start);
      const slotEnd = toMinutes(slot.end);
      if (!Number.isFinite(slotStart) || !Number.isFinite(slotEnd)) return false;
      if (slotEnd - Math.max(slotStart, scheduleEnd) < rules.breakMinutes) return false;
      return slotStart <= scheduleEnd + 10 && slotEnd > scheduleEnd;
    });
    if (!matchingSlot) continue;

    const slotStart = Math.max(toMinutes(matchingSlot.start), scheduleEnd);
    const placed = clampBlockWithinSlot(slotStart, toMinutes(matchingSlot.end), rules.breakMinutes, slotStart);
    if (!placed) continue;

    const candidate = makeProtectedBlock({
      date: dateStr,
      kind: "break",
      title: "休憩候補",
      start: minutesToTimeText(placed.start),
      end: minutesToTimeText(placed.end),
      note: `${schedule.title} の後` 
    });

    if (breaks.some((item) => blocksOverlap(item, candidate))) continue;
    breaks.push(candidate);
  }

  return breaks;
}

function computeFocusProtectionBlock(dateStr, schedules, ctx, rules, protectedBlocks) {
  if (!rules.protectFocusBlock) return null;
  const pendingTasks = getPendingTasks(dateStr, ctx).filter((task) => task.status !== "完了");
  if (!pendingTasks.length) return null;

  const freeSlots = computeFreeSlots(schedules, ctx, { additionalBlocks: protectedBlocks });
  const candidates = freeSlots
    .filter((slot) => slot.minutes >= Math.min(45, rules.focusBlockMinutes))
    .sort((a, b) => b.minutes - a.minutes || a.start.localeCompare(b.start));
  const chosen = candidates[0];
  if (!chosen) return null;

  const allocatedMinutes = Math.min(chosen.minutes, rules.focusBlockMinutes);
  const placed = clampBlockWithinSlot(toMinutes(chosen.start), toMinutes(chosen.end), allocatedMinutes, toMinutes(chosen.start));
  if (!placed) return null;

  const leadTask = pendingTasks[0];
  return makeProtectedBlock({
    date: dateStr,
    kind: "focus",
    title: "集中時間候補",
    start: minutesToTimeText(placed.start),
    end: minutesToTimeText(placed.end),
    note: leadTask ? `先頭候補: ${leadTask.title}` : `${allocatedMinutes}分確保`
  });
}

function blocksOverlap(a, b) {
  return toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end);
}

export function buildCurrentStateLines(date, ctx, split, freeSlots, protectedBlocks = []) {
  const lines = [
    `現在日時: ${ctx.currentDateLabel}`,
    `運用モード: ${ctx.effectiveModeLabel}`,
    `対象日: ${date}`,
    `集中目標: ${state.settings?.focusMinutesTarget || 0}分 / バッファ: ${state.settings?.bufferMinutes || 0}分`
  ];
  const protectedSummary = summarizeProtectedBlocks(protectedBlocks);
  if (protectedSummary.length) lines.push(`時間防衛: ${protectedSummary.join(" / ")}`);
  if (ctx.isToday) {
    const remainingMinutes = Math.max(0, toMinutes("24:00") - ctx.currentMinutes);
    lines.push(`今日の残り時間: ${Math.floor(remainingMinutes / 60)}時間${remainingMinutes % 60}分`);
    if (split.current.length) lines.push(`進行中予定: ${split.current.map((item) => item.title).join(" / ")}`);
    lines.push(`残り空き時間候補: ${freeSlots.length ? freeSlots.map((slot) => `${slot.start}-${slot.end}`).join(" / ") : "ほぼなし"}`);
  } else {
    lines.push(`今日は ${ctx.todayStr} / 現在時刻は参考のみ`);
  }
  return lines;
}

export function buildTimelineStatusLines(split) {
  const lines = [];
  if (split.current.length) split.current.forEach((item) => lines.push(`進行中 / ${formatScheduleLine(item)}`));
  if (split.upcoming.length) split.upcoming.slice(0, 5).forEach((item) => lines.push(`これから / ${formatScheduleLine(item)}`));
  if (!lines.length && split.done.length) split.done.slice(-3).forEach((item) => lines.push(`終了済み / ${formatScheduleLine(item)}`));
  return lines;
}

export function buildRiskAlerts(dateStr, ctx, schedules, fatigue = 5) {
  const alerts = [];
  const reference = ctx.isToday ? ctx.now : new Date(`${dateStr}T00:00:00`);
  const { freeSlots } = computeRuleAwareFreeSlots(dateStr, schedules, ctx);
  const pending = getPendingTasks(dateStr, ctx);
  pending.forEach((task) => {
    if (!task.deadlineDate) return;
    const due = new Date(`${task.deadlineDate}T${task.deadlineTime || "23:59"}:00`);
    const diffHours = (due.getTime() - reference.getTime()) / (1000 * 60 * 60);
    if (diffHours < 0) alerts.push(`期限超過 / ${task.title}`);
    else if (diffHours <= 12) alerts.push(`12時間以内 / ${task.title}`);
    else if (diffHours <= 24) alerts.push(`24時間以内 / ${task.title}`);
  });
  if (ctx.isToday && !freeSlots.length) alerts.push("残り空き時間がほぼありません");
  if (ctx.isToday && Number(fatigue || 5) <= 2) alerts.push("体力がかなり低いので、重い作業は縮小推奨");
  const failedSync = state.oneOffEvents.filter((item) => item.googleSyncStatus === "failed");
  if (failedSync.length) alerts.push(`Google同期失敗 ${failedSync.length}件`);
  return alerts.slice(0, 6);
}

export function buildCutCandidates(dateStr, ctx, fatigue = 5) {
  return buildAutoPlan(dateStr, ctx, true, fatigue).cutCandidates;
}

export function buildAutoPlan(dateStr, providedCtx = null, includeCutCandidates = false, fatigue = 5) {
  const ctx = providedCtx || currentContext(dateStr);
  const schedules = getSchedulesForDate(dateStr);
  const { protectedBlocks, freeSlots } = computeRuleAwareFreeSlots(dateStr, schedules, ctx);
  const referenceDate = ctx.isToday ? ctx.now : new Date(`${dateStr}T00:00:00`);
  const normalizedFatigue = Number(fatigue || 5);
  const focusTarget = Math.max(0, Number(state.settings?.focusMinutesTarget || 0));

  const tasks = getPendingTasks(dateStr, ctx).map((task) => ({
    ...task,
    remaining: Math.max(20, Number(task.estimate) || 60)
  }));

  if (!tasks.length) return { topThree: [], timeline: [], cutCandidates: [], note: "未完了タスクがないため、自動時間割候補はありません。", focusSummary: "0 / 0分" };
  if (!freeSlots.length) return { topThree: [], timeline: [], cutCandidates: deriveCutCandidates(tasks), note: "残り空き時間がほぼないため、自動時間割候補は作れません。", focusSummary: `0 / ${focusTarget}分` };

  const placements = [];
  const scheduledTaskIds = new Set();
  let plannedFocusMinutes = 0;

  for (const slot of freeSlots) {
    let cursor = toMinutes(slot.start);
    let remainingSlot = slot.minutes;
    let safety = 0;
    while (remainingSlot >= 20 && safety < 20) {
      safety += 1;
      const candidates = tasks
        .filter((task) => task.remaining > 0)
        .map((task) => ({ task, score: scoreTask(task, referenceDate, remainingSlot, normalizedFatigue, ctx, dateStr) }))
        .filter((entry) => entry.score > -999)
        .sort((a, b) => b.score - a.score);
      const chosen = candidates[0]?.task;
      if (!chosen) break;
      const allocation = Math.min(chosen.remaining, remainingSlot, suggestChunkMinutes(chosen, remainingSlot, ctx));
      if (allocation < 20) break;
      const start = fromMinutes(cursor);
      const end = fromMinutes(cursor + allocation);
      const partial = allocation < chosen.remaining;
      placements.push({
        taskId: chosen.id,
        label: `${start} - ${end} / ${chosen.title}${partial ? " (部分着手)" : ""}${chosen.protectTimeBlock ? " [保護]" : ""}`,
        topLabel: `${chosen.title} / ${chosen.importance} / 優先度:${chosen.priority}${chosen.protectTimeBlock ? " / 保護" : ""}`
      });
      if (chosen.protectTimeBlock || chosen.importance === "必須") plannedFocusMinutes += allocation;
      scheduledTaskIds.add(chosen.id);
      chosen.remaining -= allocation;
      cursor += allocation;
      remainingSlot -= allocation;
    }
  }

  const topThree = [];
  const seen = new Set();
  placements.forEach((item) => {
    if (seen.has(item.taskId) || topThree.length >= 3) return;
    seen.add(item.taskId);
    topThree.push(item.topLabel);
  });

  const unscheduled = tasks.filter((task) => !scheduledTaskIds.has(task.id));
  const cutCandidates = deriveCutCandidates(unscheduled);
  const ruleLabel = buildRuleModeLabel(dateStr, protectedBlocks);
  const note = placements.length
    ? `${ctx.effectiveModeLabel}として、現在時刻以降に収まりやすい順で仮配置しています。 ${ruleLabel}`
    : `条件に合う自動配置候補を作れませんでした。今日は切る候補を確認してください。 ${ruleLabel}`;

  return {
    topThree,
    timeline: placements.map((item) => item.label),
    cutCandidates: includeCutCandidates ? cutCandidates : [],
    note,
    focusSummary: `${plannedFocusMinutes} / ${focusTarget}分`,
    protectedSummary: summarizeProtectedBlocks(protectedBlocks),
    protectedBlocks
  };
}

export function suggestChunkMinutes(task, slotMinutes, ctx) {
  const estimate = Math.max(20, Number(task.estimate) || 60);
  if (ctx.effectiveMode === "night") return Math.min(slotMinutes, Math.min(estimate, 45));
  if (ctx.effectiveMode === "replan") return Math.min(slotMinutes, Math.min(estimate, 60));
  return Math.min(slotMinutes, estimate <= 120 ? estimate : 90);
}

export function deriveCutCandidates(tasks) {
  return tasks
    .slice()
    .sort((a, b) => {
      const aScore = ({ 後回し: 0, できれば: 1, 必須: 2 })[a.importance] ?? 1;
      const bScore = ({ 後回し: 0, できれば: 1, 必須: 2 })[b.importance] ?? 1;
      if (aScore !== bScore) return aScore - bScore;
      return (Number(b.estimate) || 60) - (Number(a.estimate) || 60);
    })
    .slice(0, 4)
    .map((task) => `${task.title} / ${task.importance}${task.deferUntilDate ? ` / 保留:${task.deferUntilDate}` : ""}`);
}

export function scoreTask(task, referenceDate, slotMinutes, fatigue, ctx, dateStr = $("selectedDate")?.value || formatDateInput(new Date())) {
  if (task.deferUntilDate && task.deferUntilDate > dateStr) return -999;
  let score = 0;
  score += ({ 必須: 60, できれば: 25, 後回し: -12 })[task.importance] ?? 0;
  score += ({ 高: 30, 中: 12, 低: 0 })[task.priority] ?? 0;
  score += ({ 未着手: 8, 進行中: 16, 完了: -999 })[task.status] ?? 0;
  if (task.protectTimeBlock) score += 22;

  const estimate = Number(task.estimate) || 60;
  if (estimate <= slotMinutes) score += 18;
  else if (slotMinutes >= 30) score += 6;
  else score -= 20;

  if (task.deadlineDate) {
    const due = new Date(`${task.deadlineDate}T${task.deadlineTime || "23:59"}:00`);
    const hoursToDue = (due.getTime() - referenceDate.getTime()) / (1000 * 60 * 60);
    if (hoursToDue <= 0) score += 80;
    else if (hoursToDue <= 12) score += 56;
    else if (hoursToDue <= 24) score += 44;
    else if (hoursToDue <= 48) score += 30;
    else if (hoursToDue <= 72) score += 18;
  }

  if (fatigue <= 3 && estimate >= 90) score -= 25;
  if (fatigue <= 3 && task.importance === "後回し") score -= 12;
  if (fatigue >= 7 && task.priority === "高") score += 8;

  if (ctx.effectiveMode === "morning" && estimate >= 60) score += 10;
  if (ctx.effectiveMode === "night" && estimate >= 90) score -= 18;
  if (ctx.effectiveMode === "night" && task.importance === "必須" && estimate <= 45) score += 10;
  if (ctx.effectiveMode === "replan" && task.status === "進行中") score += 10;

  return score;
}
