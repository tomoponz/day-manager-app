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

  const iso = text.match(/(20\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return {
      date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      explicit: true
    };
  }

  const md = text.match(/(\d{1,2})[\/\-](\d{1,2})/);
  if (md) {
    const year = fallbackDate.slice(0, 4);
    const [, m, d] = md;
    return {
      date: `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      explicit: true
    };
  }

  const weekday = text.match(/(今週|来週)?([日月火水木金土])曜?/);
  if (weekday) {
    const [, prefix = "今週", dayChar] = weekday;
    return {
      date: resolveWeekdayDate(fallbackDate, WEEKDAY_MAP[dayChar], prefix === "来週"),
      explicit: true
    };
  }

  return { date: "", explicit: false };
}

function resolveWeekdayDate(baseDateStr, targetWeekday, forceNextWeek = false) {
  const date = new Date(`${baseDateStr}T00:00:00`);
  const current = date.getDay();
  let diff = targetWeekday - current;
  if (diff < 0 || forceNextWeek) diff += 7;
  if (diff === 0 && forceNextWeek) diff = 7;
  date.setDate(date.getDate() + diff);
  return formatDateInput(date);
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
  const explicit = text.match(/優先度[:：]?\s*(高|中|低)/);
  if (explicit) return explicit[1];
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
  let title = text;
  title = title.replace(/^(タスク|task|課題|todo)[:：]\s*/i, "");
  title = title.replace(/(20\d{2}[\/\-]\d{1,2}[\/\-]\d{1,2})|(\d{1,2}[\/\-]\d{1,2})|(明後日|明日|今日)|(今週|来週)?[日月火水木金土]曜?/g, " ");
  title = title.replace(/\d{1,2}(?::\d{2})?\s*[〜~\-]\s*\d{1,2}(?::\d{2})?/g, " ");
  title = title.replace(/\d{1,2}(?::\d{2})?\s*(時半|時)?/g, " ");
  title = title.replace(/(今夜|今日中|午前|午後|必須|後回し|\d+(?:\.\d+)?\s*h|\d+\s*m|\d+\s*分|\d+(?:\.\d+)?\s*時間)/gi, " ");
  title = title.replace(/優先度[:：]?(高|中|低)|進行中|完了|保護|守る|固定/g, " ");
  title = title.replace(/分類[:：]\s*[^\s]+/g, " ");
  title = title.replace(/[()（）]/g, " ");
  return title.replace(/\s+/g, " ").trim();
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

function buildQuickNote(text) {
  return `クイック追加: ${text.trim()}`;
}

function formatTime(h, m) {
  return `${String(Number(h)).padStart(2, "0")}:${String(Number(m)).padStart(2, "0")}`;
}

function addMinutesToTime(timeStr, minutesToAdd) {
  const [h, m] = timeStr.split(":").map(Number);
  const total = h * 60 + m + minutesToAdd;
  const safe = ((total % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
