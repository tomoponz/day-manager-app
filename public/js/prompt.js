import { state } from "./state.js";
import { $ } from "./utils.js";
import { showToast } from "./ui-feedback.js";
import { WEEKDAY_NAMES, getNowContext, addDays } from "./time.js";
import {
  getSchedulesForDate,
  getUpcomingTasks,
  getPendingTasks,
  computeFreeSlots,
  buildAutoPlan,
  splitSchedulesByNow,
  buildRiskAlerts,
  formatScheduleLine
} from "./planner.js";
import { buildStudyPromptSection } from "./study-manager.js";
import { buildMovementPlanLines } from "./travel.js";

export function generatePrompt() {
  const selectedDate = $("selectedDate").value;
  const planningDays = Math.min(14, Math.max(1, Number(state.settings?.aiPlanningDays || 1) || 1));
  const study = buildStudyPromptSection();
  const sections = [];

  for (let offset = 0; offset < planningDays; offset += 1) {
    const date = addDays(selectedDate, offset);
    const ctx = getNowContext(date, state.uiState?.plannerMode || "auto");
    const dayData = state.dayConditions[date] || {};
    const schedules = getSchedulesForDate(date);
    const deadlines = getUpcomingTasks(date, 48, ctx);
    const pending = getPendingTasks(date, ctx);
    const freeSlots = computeFreeSlots(schedules, ctx);
    const fatigue = Number(dayData.fatigue || (offset === 0 ? $("fatigue")?.value : "") || 5);
    const autoPlan = buildAutoPlan(date, ctx, true, fatigue);
    const split = splitSchedulesByNow(schedules, ctx);
    const risks = buildRiskAlerts(date, ctx, schedules, fatigue);
    const studyLocationLines = buildStudyLocationPromptLines(date, ctx);
    const movementLines = buildMovementPlanLines(date, schedules);

    sections.push([
      `## ${date} (${WEEKDAY_NAMES[new Date(`${date}T00:00:00`).getDay()]})`,
      `現在日時：${ctx.currentDateLabel}`,
      `運用モード：${ctx.effectiveModeLabel}`,
      `睡眠・体調：睡眠 ${dayData.sleepHours || "未入力"} 時間 / 体力 ${dayData.fatigue || "未入力"} / メモ ${dayData.note || "なし"}`,
      "現在地点：",
      split.current.length ? split.current.map((item) => `- 進行中 / ${formatScheduleLine(item)}`).join("\n") : "- 進行中予定なし",
      split.upcoming.length ? split.upcoming.slice(0, 5).map((item) => `- これから / ${formatScheduleLine(item)}`).join("\n") : "- これからの予定少なめ",
      "固定予定・単発予定：",
      schedules.length ? schedules.map((item) => `- ${formatScheduleLine(item)}`).join("\n") : "- なし",
      "移動メモ：",
      movementLines.length ? movementLines.map((line) => `- ${line}`).join("\n") : "- ルート情報なし",
      "48時間以内の締切：",
      deadlines.length
        ? deadlines.map((task) => `- ${task.title} / ${task.deadlineDate}${task.deadlineTime ? ` ${task.deadlineTime}` : ""} / 優先度:${task.priority} / 重要度:${task.importance} / 見積:${task.estimate || "?"}分 / ${task.note || "メモなし"}`).join("\n")
        : "- なし",
      "未完了タスク：",
      pending.length
        ? pending.map((task) => `- ${task.title} / ${task.category || "分類なし"} / 状態:${task.status} / 重要度:${task.importance} / 優先度:${task.priority} / 見積:${task.estimate || "?"}分 / 締切:${task.deadlineDate || "未設定"}${task.deadlineTime ? ` ${task.deadlineTime}` : ""}${task.deferUntilDate ? ` / 保留:${task.deferUntilDate}` : ""}${task.note ? ` / ${task.note}` : ""}`).join("\n")
        : "- なし",
      "残り空き時間候補：",
      freeSlots.length ? freeSlots.map((slot) => `- ${slot.start} - ${slot.end} (${slot.minutes}分)`).join("\n") : "- ほぼなし",
      "今日使える自習場所：",
      studyLocationLines.length ? studyLocationLines.map((line) => `- ${line}`).join("\n") : "- なし",
      "危険アラート：",
      risks.length ? risks.map((line) => `- ${line}`).join("\n") : "- 特になし",
      "アプリ内の自動時間割候補：",
      autoPlan.timeline.length ? autoPlan.timeline.map((line) => `- ${line}`).join("\n") : "- なし",
      "アプリ内の最優先3件：",
      autoPlan.topThree.length ? autoPlan.topThree.map((line) => `- ${line}`).join("\n") : "- なし",
      "今日切る候補：",
      autoPlan.cutCandidates.length ? autoPlan.cutCandidates.map((line) => `- ${line}`).join("\n") : "- なし"
    ].join("\n"));
  }

  const text = [
    `${state.settings?.aiServiceName || "AI"} に貼る計画依頼です。`,
    `対象開始日：${selectedDate}`,
    `対象日数：${planningDays}日`,
    `タイムゾーン：${getNowContext(selectedDate, state.uiState?.plannerMode || "auto").timeZone}`,
    "科目の状況：",
    study.courseLines.join("\n"),
    "教材進度：",
    study.materialLines.join("\n"),
    "今日進める教材候補：",
    study.focusLines.join("\n"),
    "科目危険度ランキング：",
    study.riskLines.join("\n"),
    "学業の締切マップ：",
    study.deadlineLines.join("\n"),
    "",
    ...sections,
    "",
    "出力形式：",
    "1. まず対象日数全体の優先順位",
    "2. 各日の時間ブロック化した計画",
    "3. 締切・教材・移動の注意点",
    "4. 今やらないこと",
    "5. 詰まった時の代替案",
    "6. JSONのみが必要なら、その形式でも出せるようにする"
  ].join("\n");

  $("promptOutput").value = text;
}

export async function copyPrompt() {
  const textarea = $("promptOutput");
  if (!textarea.value.trim()) generatePrompt();

  try {
    await navigator.clipboard.writeText(textarea.value);
    showToast("コピーしました。", { variant: "ok", duration: 2200 });
  } catch {
    textarea.select();
    document.execCommand("copy");
    showToast("コピーしました。", { variant: "ok", duration: 2200 });
  }
}

function buildStudyLocationPromptLines(selectedDate, ctx) {
  const items = Array.isArray(state.studyLocations) ? [...state.studyLocations] : [];
  if (!items.length) return [];

  return items
    .sort((a, b) => {
      if (Boolean(a.isPreferred) !== Boolean(b.isPreferred)) return Number(Boolean(b.isPreferred)) - Number(Boolean(a.isPreferred));
      const travelA = a.travelMinutes === "" ? 9999 : Number(a.travelMinutes || 9999);
      const travelB = b.travelMinutes === "" ? 9999 : Number(b.travelMinutes || 9999);
      if (travelA !== travelB) return travelA - travelB;
      return String(a.name || "").localeCompare(String(b.name || ""), "ja");
    })
    .slice(0, 6)
    .map((item) => {
      const status = getStudyLocationStatus(item, selectedDate, ctx);
      const parts = [item.name, getStudyLocationKindLabel(item.kind), status.sourceLabel, status.statusLabel];
      if (status.hoursLabel) parts.push(status.hoursLabel);
      if (status.remainingLabel) parts.push(status.remainingLabel);
      if (String(item.travelMinutes || "").trim()) parts.push(`移動${item.travelMinutes}分`);
      if (item.isPreferred) parts.push('優先候補');
      if (status.noteLabel) parts.push(`補足:${status.noteLabel}`);
      return parts.join(' / ');
    });
}

function getStudyLocationStatus(location, selectedDate, ctx) {
  const hoursSource = getStudyLocationHoursSource(location, selectedDate);
  const raw = String(hoursSource?.value || '').trim();
  const sourceLabel = hoursSource.isChecked
    ? '確認済み'
    : hoursSource.isException
      ? '例外日'
      : '要確認';
  const noteLabel = hoursSource.note || '';

  if (!raw) return { statusLabel: '時間未設定', hoursLabel: '', remainingLabel: '', sourceLabel, noteLabel };
  const compact = raw.replace(/[〜～‐‑‒–—―ー]/g, '-').replace(/\s+/g, '');
  if (/^(休館|closed)$/i.test(compact)) return { statusLabel: '休館', hoursLabel: '休館', remainingLabel: '', sourceLabel, noteLabel };
  const match = compact.match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
  if (!match) return { statusLabel: '要確認', hoursLabel: raw, remainingLabel: '', sourceLabel, noteLabel };

  const open = normalizeClock(match[1]);
  const close = normalizeClock(match[2]);
  const hoursLabel = `${open} - ${close}`;
  if (!ctx?.isToday || selectedDate !== `${ctx.now.getFullYear()}-${String(ctx.now.getMonth() + 1).padStart(2, '0')}-${String(ctx.now.getDate()).padStart(2, '0')}`) {
    return { statusLabel: '利用可', hoursLabel, remainingLabel: '', sourceLabel, noteLabel };
  }
  const nowMinutes = ctx.now.getHours() * 60 + ctx.now.getMinutes();
  const openMinutes = toMinutes(open);
  const closeMinutes = toMinutes(close);
  if (nowMinutes < openMinutes) return { statusLabel: '開館前', hoursLabel, remainingLabel: `あと ${formatMinutes(openMinutes - nowMinutes)} で開館`, sourceLabel, noteLabel };
  if (nowMinutes >= closeMinutes) return { statusLabel: '閉館後', hoursLabel, remainingLabel: '', sourceLabel, noteLabel };
  return { statusLabel: '営業中', hoursLabel, remainingLabel: `残り ${formatMinutes(closeMinutes - nowMinutes)}`, sourceLabel, noteLabel };
}

function getStudyLocationHoursSource(location, selectedDate) {
  const check = getStudyLocationDateCheck(location, selectedDate);
  if (check) {
    if (check.status === 'checked_closed') return { value: '休館', isException: true, isChecked: true, note: check.note || '' };
    if (check.overrideHours) return { value: check.overrideHours, isException: true, isChecked: true, note: check.note || '' };
    const scheduled = getScheduledStudyLocationHoursSource(location, selectedDate);
    return { ...scheduled, isChecked: true, note: check.note || scheduled.note || '' };
  }
  return getScheduledStudyLocationHoursSource(location, selectedDate);
}

function getStudyLocationDateCheck(location, selectedDate) {
  const source = location?.checksByDate && typeof location.checksByDate === 'object' ? location.checksByDate : {};
  const raw = source?.[selectedDate];
  if (!raw || typeof raw !== 'object') return null;
  return {
    status: String(raw.status || ''),
    overrideHours: String(raw.overrideHours || '').trim(),
    checkedAt: String(raw.checkedAt || ''),
    note: String(raw.note || '').trim()
  };
}

function getScheduledStudyLocationHoursSource(location, selectedDate) {
  const lines = String(location?.exceptionsText || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^(\d{4}-\d{2}-\d{2})[\s　]+(.+)$/);
    if (match && match[1] === selectedDate) return { value: match[2].trim(), isException: true, isChecked: false, note: '' };
  }
  const weekday = new Date(`${selectedDate}T00:00:00`).getDay();
  return { value: location?.weeklyHours?.[String(weekday)] || '', isException: false, isChecked: false, note: '' };
}

function getStudyLocationKindLabel(kind) {
  return ({
    university_library: '大学図書館',
    pref_library: '県立図書館',
    city_library: '市立図書館',
    cafe: 'カフェ',
    home: '自宅',
    other: 'その他'
  })[kind] || '自習場所';
}

function normalizeClock(value) {
  const [hour, minute] = String(value).split(':');
  return `${String(Number(hour)).padStart(2, '0')}:${minute}`;
}

function toMinutes(value) {
  const [hour, minute] = String(value).split(':').map(Number);
  return hour * 60 + minute;
}

function formatMinutes(minutes) {
  const safe = Math.max(0, Number(minutes || 0));
  const hour = Math.floor(safe / 60);
  const minute = safe % 60;
  if (!hour) return `${minute}分`;
  if (!minute) return `${hour}時間`;
  return `${hour}時間${minute}分`;
}
