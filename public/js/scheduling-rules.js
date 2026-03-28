import { state } from "./state.js";
import { WEEKDAY_NAMES, toMinutes, fromMinutes } from "./time.js";

export function getSchedulingRules() {
  const settings = state.settings || {};
  return {
    protectLunch: typeof settings.protectLunch === "boolean" ? settings.protectLunch : true,
    lunchWindowStart: normalizeTime(settings.lunchWindowStart, "12:00"),
    lunchWindowEnd: normalizeTime(settings.lunchWindowEnd, "13:30"),
    lunchMinutes: normalizeNumber(settings.lunchMinutes, 45, 20, 180),
    breakAfterEvent: typeof settings.breakAfterEvent === "boolean" ? settings.breakAfterEvent : true,
    breakMinutes: normalizeNumber(settings.breakMinutes, 15, 5, 60),
    protectFocusBlock: typeof settings.protectFocusBlock === "boolean" ? settings.protectFocusBlock : false,
    focusBlockMinutes: normalizeNumber(settings.focusBlockMinutes, 90, 30, 240),
    aiDraftOnly: settings.aiDraftOnly !== false,
    confirmBeforeGoogleApply: settings.confirmBeforeGoogleApply !== false
  };
}

export function isWeekdayDate(dateStr) {
  if (!dateStr) return false;
  const weekday = new Date(`${dateStr}T00:00:00`).getDay();
  return weekday >= 1 && weekday <= 5;
}

export function makeProtectedBlock({ date = "", kind = "guard", title = "時間防衛", start = "", end = "", note = "", variant = "" } = {}) {
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  const safeStart = Number.isFinite(startMinutes) ? startMinutes : 0;
  const safeEnd = Number.isFinite(endMinutes) && endMinutes > safeStart ? endMinutes : safeStart;
  return {
    id: `protected:${kind}:${date}:${start}:${end}:${title}`,
    date,
    kind,
    title,
    start,
    end,
    note,
    variant: variant || kind,
    allDay: false,
    type: "protected",
    isProtected: true,
    minutes: Math.max(0, safeEnd - safeStart),
    label: `${start} - ${end} / ${title}`
  };
}

export function describeProtectedBlock(block) {
  if (!block) return "";
  const time = block.start && block.end ? `${block.start} - ${block.end}` : "時刻未設定";
  const note = block.note ? ` / ${block.note}` : "";
  return `${time} / ${block.title}${note}`;
}

export function summarizeProtectedBlocks(blocks = []) {
  const counts = { lunch: 0, break: 0, focus: 0, draft: 0, other: 0 };
  blocks.forEach((block) => {
    if (block?.kind === "lunch") counts.lunch += 1;
    else if (block?.kind === "break") counts.break += 1;
    else if (block?.kind === "focus") counts.focus += 1;
    else if (block?.kind === "draft") counts.draft += 1;
    else counts.other += 1;
  });

  const lines = [];
  if (counts.lunch) lines.push(`昼休み候補 ${counts.lunch}件`);
  if (counts.break) lines.push(`休憩候補 ${counts.break}件`);
  if (counts.focus) lines.push(`集中時間候補 ${counts.focus}件`);
  if (counts.draft) lines.push(`AI下書き ${counts.draft}件`);
  if (counts.other) lines.push(`保護ブロック ${counts.other}件`);
  return lines;
}

export function buildRuleModeLabel(dateStr, blocks = []) {
  const rules = getSchedulingRules();
  const labels = [];
  if (rules.protectLunch) labels.push(`昼休み ${rules.lunchWindowStart}-${rules.lunchWindowEnd}`);
  if (rules.breakAfterEvent) labels.push(`予定後休憩 ${rules.breakMinutes}分`);
  if (rules.protectFocusBlock) labels.push(`集中確保 ${rules.focusBlockMinutes}分`);
  if (!labels.length) return "時間防衛ルールはオフです。";

  const weekdayText = dateStr ? `${WEEKDAY_NAMES[new Date(`${dateStr}T00:00:00`).getDay()]}曜日` : "対象日";
  const protectedSummary = summarizeProtectedBlocks(blocks);
  return `${weekdayText}の時間防衛: ${labels.join(" / ")}${protectedSummary.length ? ` / ${protectedSummary.join(" / ")}` : ""}`;
}

export function intersectMinuteRange(slotStart, slotEnd, windowStart, windowEnd) {
  const start = Math.max(slotStart, windowStart);
  const end = Math.min(slotEnd, windowEnd);
  return end > start ? { start, end, minutes: end - start } : null;
}

export function clampBlockWithinSlot(slotStart, slotEnd, desiredMinutes, preferredStart = null) {
  if (!Number.isFinite(slotStart) || !Number.isFinite(slotEnd) || slotEnd <= slotStart) return null;
  const minutes = Math.min(Math.max(0, desiredMinutes), slotEnd - slotStart);
  if (minutes <= 0) return null;

  let start = Number.isFinite(preferredStart) ? preferredStart : slotStart;
  start = Math.max(slotStart, start);
  start = Math.min(start, slotEnd - minutes);
  return { start, end: start + minutes, minutes };
}

function normalizeTime(value, fallback) {
  const text = String(value || "").trim();
  return /^\d{2}:\d{2}$/.test(text) ? text : fallback;
}

function normalizeNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function minutesToTimeText(totalMinutes) {
  return fromMinutes(totalMinutes);
}
