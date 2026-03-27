import { state } from "./state.js";
import { $ } from "./utils.js";
import { showToast } from "./ui-feedback.js";
import { WEEKDAY_NAMES, getNowContext } from "./time.js";
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

export function generatePrompt() {
  const selectedDate = $("selectedDate").value;
  const ctx = getNowContext(selectedDate, state.uiState?.plannerMode || "auto");
  const dayData = state.dayConditions[selectedDate] || {};
  const schedules = getSchedulesForDate(selectedDate);
  const deadlines = getUpcomingTasks(selectedDate, 48, ctx);
  const pending = getPendingTasks(selectedDate, ctx);
  const freeSlots = computeFreeSlots(schedules, ctx);
  const autoPlan = buildAutoPlan(selectedDate, ctx, true);
  const split = splitSchedulesByNow(schedules, ctx);
  const risks = buildRiskAlerts(selectedDate, ctx, schedules);
  const study = buildStudyPromptSection();

  const text = [
    "今日の1日を設計して。",
    `現在日時：${ctx.currentDateLabel}`,
    `タイムゾーン：${ctx.timeZone}`,
    `対象日：${selectedDate} (${WEEKDAY_NAMES[new Date(`${selectedDate}T00:00:00`).getDay()]})`,
    `運用モード：${ctx.effectiveModeLabel}`,
    `睡眠・体調：睡眠 ${dayData.sleepHours || "未入力"} 時間 / 体力 ${dayData.fatigue || "未入力"} / メモ ${dayData.note || "なし"}`,
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
    "現在地点：",
    split.current.length ? split.current.map((item) => `- 進行中 / ${formatScheduleLine(item)}`).join("\n") : "- 進行中予定なし",
    split.upcoming.length ? split.upcoming.slice(0, 5).map((item) => `- これから / ${formatScheduleLine(item)}`).join("\n") : "- これからの予定少なめ",
    "固定予定・単発予定：",
    schedules.length ? schedules.map((item) => `- ${formatScheduleLine(item)}`).join("\n") : "- なし",
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
    "危険アラート：",
    risks.length ? risks.map((line) => `- ${line}`).join("\n") : "- 特になし",
    "アプリ内の自動時間割候補：",
    autoPlan.timeline.length ? autoPlan.timeline.map((line) => `- ${line}`).join("\n") : "- なし",
    "アプリ内の最優先3件：",
    autoPlan.topThree.length ? autoPlan.topThree.map((line) => `- ${line}`).join("\n") : "- なし",
    "今日切る候補：",
    autoPlan.cutCandidates.length ? autoPlan.cutCandidates.map((line) => `- ${line}`).join("\n") : "- なし",
    "出力形式：",
    "1. いまからの最優先3件",
    "2. 現在時刻以降の時間ブロック化した1日設計",
    "3. 学業面で今日進めるべき教材・締切",
    "4. 今やらないこと",
    "5. 詰まった時の代替案",
    "6. 夜の締め条件"
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
