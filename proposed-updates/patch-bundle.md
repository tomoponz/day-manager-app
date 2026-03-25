# Day Manager patch bundle

以下は、そのまま既存ファイルへ反映するための置換案です。

---

## 1. `sw.js`

```js
const CACHE_NAME = "day-manager-cache-v6";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./calendar-test.html",
  "./calendar-test.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./js/actions.js",
  "./js/ai-drafts.js",
  "./js/ai-gemini-assist.js",
  "./js/date-nav-ui.js",
  "./js/google-calendar.js",
  "./js/main-screen-layout.js",
  "./js/planner.js",
  "./js/product-ui-tune.js",
  "./js/prompt.js",
  "./js/quick-add.js",
  "./js/render.js",
  "./js/state.js",
  "./js/time.js",
  "./js/ui-feedback.js",
  "./js/utils.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(staleWhileRevalidate(event.request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request);
    return cached || caches.match("./index.html");
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || fetchPromise || Response.error();
}
```

---

## 2. `js/quick-add.js`

主な変更点:
- `今夜`
- `今日中`
- `1h`
- `30m`
- `午前`
- `午後`

```js
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
```

---

## 3. `js/actions.js`

主な変更点:
- `alert` → `showToast`
- `confirm` → `confirmDialog`
- 追加/削除後のUI一貫性向上

差し替え方針:
- `import { showToast, confirmDialog } from './ui-feedback.js';` を追加
- 各 `alert(...)` を `showToast(..., { variant: 'warn' })` へ変更
- 各 `confirm(...)` を `await confirmDialog({...})` へ変更

具体例:

```js
if (!payload.title) {
  showToast('タスク名を入力してください。', { variant: 'warn' });
  return;
}
```

```js
const ok = await confirmDialog({
  title: 'タスクを削除',
  message: `「${item.title}」を削除します。`,
  confirmText: '削除',
  danger: true
});
if (!ok) return;
```

---

## 4. `js/render.js`

主な変更点:
- 文字列連結中心の meta をバッジ化
- タスク状態 / 優先度 / 重要度 / 同期状態を視覚優先表示

差し替え方針:
- `createListItem` を `badges`, `detail`, `className` を受け取れる形に変更
- `.item-badge` を使ってレンダリングする

---

## 5. `js/google-calendar.js`

主な変更点:
- ローカル削除確認を `confirmDialog` に統一
- UIメッセージは `notifyStatus` に統一

具体例:

```js
const proceed = await confirmDialog({
  title: 'ローカルだけ削除',
  message: 'この予定は Google Calendar と同期されています。現在は未接続なので、ローカルだけ削除されます。',
  confirmText: '続ける',
  danger: true
});
if (!proceed) return;
```

---

## 6. `js/product-ui-tune.js`

追加スタイル:

```js
.bootstrap-error-banner {
  position: sticky;
  top: 0;
  z-index: 1001;
  margin: 1rem auto 0;
  width: min(1100px, calc(100% - 2rem));
  background: #fff8f8;
  color: var(--danger);
  border: 1px solid rgba(185, 28, 28, 0.24);
  border-radius: var(--r);
  box-shadow: var(--shadow-sm);
  padding: 0.9rem 1rem;
  display: grid;
  gap: 0.5rem;
}
```

---

## 7. `app.js`

主な変更点:
- bootstrap 失敗時に `console.error` だけで終わらせず、画面上にエラーバナー表示

具体例:

```js
bootstrap().catch((error) => {
  console.error('Day Manager bootstrap failed:', error);
  showBootstrapError(error);
});
```

```js
function showBootstrapError(error) {
  const banner = document.createElement('section');
  banner.id = 'bootstrapErrorBanner';
  banner.className = 'bootstrap-error-banner';
  banner.innerHTML = `
    <strong>起動エラー</strong>
    <p class="bootstrap-error-banner__message">${escapeHtml(formatBootstrapError(error))}</p>
    <button type="button" class="primary">再読み込み</button>
  `;
  banner.querySelector('button')?.addEventListener('click', () => window.location.reload());
  document.body.prepend(banner);
}
```
