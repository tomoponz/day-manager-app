import { formatDateInput, addDays } from "./time.js";

const WEEKDAY_MAP = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 };

export function parseQuickAddInput(input, selectedDateValue = formatDateInput(new Date())) {
  const raw = String(input || "").trim();
  if (!raw) {
    return { ok: false, error: "入力が空です。" };
  }

  const baseDate = selectedDateValue || formatDateInput(new Date());
  const detectedType = detectType(raw);
  const dateInfo = parseDate(raw, baseDate);
  const timeInfo = parseTime(raw);
  const durationMinutes = parseDuration(raw);
  const priority = parsePriority(raw);
  const importance = parseImportance(raw);
  const protectTimeBlock = /保護|守る|固定/.test(raw);
  const status = /進行中/.test(raw) ? "進行中" : /完了/.test(raw) ? "完了" : "未着手";

  const title = cleanupTitle(raw);
  if (!title) {
    return { ok: false, error: "タイトル部分を認識できませんでした。" };
  }

  if (detectedType === "task") {
    const deadlineDate = dateInfo.explicit ? dateInfo.date : inferTaskDeadlineDate(baseDate, timeInfo, raw);
    return {
      ok: true,
      type: "task",
      preview: `タスク / ${title}`,
      value: {
        title,
        category: parseCategory(raw),
        deadlineDate,
        deadlineTime: inferTaskDeadlineTime(timeInfo, raw),
        estimate: durationMinutes ? String(durationMinutes) : "",
        priority,
        importance,
        note: buildQuickNote(raw),
        status,
        deferUntilDate: "",
        protectTimeBlock
      }
    };
  }

  const eventDate = dateInfo.date || baseDate;
  const derivedStart = inferEventStartTime(timeInfo, raw);
  const endTime = timeInfo.end || (!timeInfo.end && derivedStart && durationMinutes ? addMinutesToTime(derivedStart, durationMinutes) : "");
  const allDay = !derivedStart;

  return {
    ok: true,
    type: "event",
    preview: `${eventDate} / ${title}`,
    value: {
      title,
      date: eventDate,
      start: allDay ? "" : derivedStart,
      end: allDay ? "" : endTime,
      note: buildQuickNote(raw),
      allDay
    }
  };
}

function detectType(text) {
  if (/^(タスク|task|課題|todo)[:：]/i.test(text)) return "task";
  if (/締切|今日中|レポ|課題|提出|勉強|復習/.test(text)) return "task";
  return "event";
}

function parseDate(text, fallbackDate) {
  if (/明後日/.test(text)) return { date: addDays(fallbackDate, 2), explicit: true };
  if (/明日/.test(text)) return { date: addDays(fallbackDate, 1), explicit: true };
  if (/今日/.test(text) || /今日中|今夜/.test(text)) return { date: fallbackDate, explicit: true };
  return { date: "", explicit: false };
}

function parseTime(text) {
  const range = text.match(/(\d{1,2})(?::(\d{2}))?\s*[〜~\-]\s*(\d{1,2})(?::(\d{2}))?/);
  if (range) {
    const [, sh, sm = "00", eh, em = "00"] = range;
    return { start: formatTime(sh, sm), end: formatTime(eh, em) };
  }
  const single = text.match(/(\d{1,2})(?::(\d{2}))?\s*(時|時半)?/);
  if (single) {
    const [matched, h, mm, suffix] = single;
    if (matched.length <= 2 && !suffix && !matched.includes(":")) return { start: "", end: "" };
    const minutes = suffix === "時半" ? "30" : (mm || "00");
    return { start: formatTime(h, minutes), end: "" };
  }
  return { start: "", end: "" };
}

function parseDuration(text) {
  const hoursWord = text.match(/(\d+(?:\.\d+)?)\s*時間/);
  if (hoursWord) return Math.round(Number(hoursWord[1]) * 60);
  const hourShort = text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*h(?:$|\s)/i);
  if (hourShort) return Math.round(Number(hourShort[1]) * 60);
  const minutesWord = text.match(/(\d+)\s*分/);
  if (minutesWord) return Number(minutesWord[1]);
  const minuteShort = text.match(/(?:^|\s)(\d+)\s*m(?:$|\s)/i);
  if (minuteShort) return Number(minuteShort[1]);
  return 0;
}

function parsePriority(text) {
  if (/必須/.test(text)) return "高";
  return "中";
}
function parseImportance(text) {
  if (/必須/.test(text)) return "必須";
  if (/後回し/.test(text)) return "後回し";
  return "できれば";
}
function parseCategory(text) {
  const match = text.match(/分類[:：]\s*([^\s]+)/);
  return match ? match[1].trim() : "";
}
function cleanupTitle(text) {
  return text.replace(/(今夜|今日中|午前|午後|必須|後回し|\d+(?:\.\d+)?\s*h|\d+\s*m|\d+\s*分|\d+(?:\.\d+)?\s*時間)/gi, " ").replace(/\s+/g, " ").trim();
}
function inferTaskDeadlineDate(baseDate, timeInfo, raw) {
  if (/今日中|今夜/.test(raw)) return baseDate;
  return timeInfo.start ? baseDate : "";
}
function inferTaskDeadlineTime(timeInfo, raw) {
  if (timeInfo.start) return timeInfo.start;
  if (/今日中/.test(raw)) return "23:59";
  if (/今夜/.test(raw)) return "21:00";
  return "";
}
function inferEventStartTime(timeInfo, raw) {
  if (timeInfo.start) return timeInfo.start;
  if (/午前/.test(raw)) return "09:00";
  if (/午後/.test(raw)) return "13:00";
  if (/今夜/.test(raw)) return "19:00";
  return "";
}
function buildQuickNote(text) { return `クイック追加: ${text.trim()}`; }
function formatTime(h, m) { return `${String(Number(h)).padStart(2, "0")}:${String(Number(m)).padStart(2, "0")}`; }
function addMinutesToTime(timeStr, minutesToAdd) {
  const [h, m] = timeStr.split(":").map(Number);
  const total = h * 60 + m + minutesToAdd;
  const safe = ((total % (24 * 60)) + (24 * 60)) % (24 * 60);
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}
