// ==UserScript==
// @name         manaba → Day Manager 同期
// @namespace    https://tomoponz.github.io/
// @version      2.0.0
// @description  manaba の未提出課題を Day Manager へ半自動同期します
// @match        https://*.manaba.jp/*
// @match        https://*.manaba.net/*
// @match        https://manaba.*.ac.jp/*
// @connect      *
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const STORE_KEYS = {
    workerUrl: "workerUrl",
    syncToken: "syncToken",
    lastSyncHash: "lastSyncHash",
    lastSyncAt: "lastSyncAt"
  };
  const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
  const UNSUBMITTED_PATTERNS = ["受付中", "提出可", "未提出", "受付前", "未評価"];
  const SUBMITTED_PATTERNS = ["提出済", "採点済", "終了", "受付終了", "閉鎖", "closed", "complete"];

  GM_addStyle(`
    #dm-sync-panel {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 99999;
      width: 290px;
      max-width: calc(100vw - 24px);
      background: rgba(15, 23, 42, 0.94);
      color: #e5e7eb;
      border: 1px solid rgba(148, 163, 184, 0.25);
      border-radius: 14px;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.35);
      padding: 12px 14px;
      font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      backdrop-filter: blur(6px);
    }
    #dm-sync-panel h4 {
      margin: 0 0 6px;
      font-size: 14px;
      color: #93c5fd;
    }
    #dm-sync-panel .dm-row {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }
    #dm-sync-panel button {
      flex: 1 1 auto;
      min-height: 34px;
      border-radius: 9px;
      border: none;
      cursor: pointer;
      font-size: 12px;
    }
    #dm-sync-panel button[data-kind="primary"] {
      background: #2563eb;
      color: white;
    }
    #dm-sync-panel button[data-kind="ghost"] {
      background: rgba(51, 65, 85, 0.9);
      color: #e5e7eb;
    }
    #dm-sync-panel button:disabled {
      opacity: 0.6;
      cursor: default;
    }
    #dm-sync-status {
      white-space: pre-line;
      color: #cbd5e1;
      min-height: 2.8em;
    }
    #dm-sync-meta {
      margin-top: 6px;
      font-size: 11px;
      color: #94a3b8;
    }
  `);

  function getSetting(key, fallback = "") {
    return String(GM_getValue(key, fallback) || "").trim();
  }

  function setSetting(key, value) {
    GM_setValue(key, String(value || "").trim());
  }

  function buildPanel() {
    if (document.getElementById("dm-sync-panel")) return;
    const panel = document.createElement("div");
    panel.id = "dm-sync-panel";
    panel.innerHTML = `
      <h4>Day Manager / manaba</h4>
      <div id="dm-sync-status">初期化中…</div>
      <div id="dm-sync-meta"></div>
      <div class="dm-row">
        <button id="dm-sync-btn" data-kind="primary" type="button">今すぐ同期</button>
        <button id="dm-config-btn" data-kind="ghost" type="button">設定</button>
      </div>
    `;
    document.body.appendChild(panel);
    panel.querySelector("#dm-sync-btn")?.addEventListener("click", () => syncNow({ manual: true }));
    panel.querySelector("#dm-config-btn")?.addEventListener("click", openConfig);
    renderMeta();
  }

  function setStatus(message, level = "info") {
    const node = document.getElementById("dm-sync-status");
    if (!node) return;
    node.textContent = message;
    node.style.color = level === "ok" ? "#86efac" : level === "warn" ? "#fde68a" : level === "error" ? "#fca5a5" : "#cbd5e1";
  }

  function renderMeta() {
    const node = document.getElementById("dm-sync-meta");
    if (!node) return;
    const workerUrl = getSetting(STORE_KEYS.workerUrl);
    const token = getSetting(STORE_KEYS.syncToken);
    const lastSyncAt = getSetting(STORE_KEYS.lastSyncAt);
    node.textContent = [
      workerUrl ? `Worker: ${workerUrl}` : "Worker: 未設定",
      token ? `Token: ${token.slice(0, 6)}…${token.slice(-4)}` : "Token: 未設定",
      lastSyncAt ? `Last: ${new Date(lastSyncAt).toLocaleString("ja-JP")}` : "Last: なし"
    ].join(" / ");
  }

  function openConfig() {
    const nextWorkerUrl = prompt("Cloudflare Worker のURLを入力してください", getSetting(STORE_KEYS.workerUrl));
    if (nextWorkerUrl !== null) setSetting(STORE_KEYS.workerUrl, nextWorkerUrl.replace(/\/$/, ""));
    const nextToken = prompt("Day Manager の manaba 同期トークンを入力してください", getSetting(STORE_KEYS.syncToken));
    if (nextToken !== null) setSetting(STORE_KEYS.syncToken, nextToken);
    renderMeta();
    evaluateReadiness();
  }

  function evaluateReadiness() {
    const workerUrl = getSetting(STORE_KEYS.workerUrl);
    const token = getSetting(STORE_KEYS.syncToken);
    const syncBtn = document.getElementById("dm-sync-btn");
    const ready = Boolean(workerUrl && token);
    if (syncBtn) syncBtn.disabled = !ready;
    if (!ready) {
      setStatus("Worker URL と同期トークンを設定すると、manaba を開いたときに未提出課題を自動送信します。", "warn");
      return false;
    }
    setStatus("準備完了。manaba のページを開くと自動同期します。", "info");
    return true;
  }

  function shouldAutoSync() {
    const lastSyncAt = getSetting(STORE_KEYS.lastSyncAt);
    if (!lastSyncAt) return true;
    const diff = Date.now() - new Date(lastSyncAt).getTime();
    return diff >= AUTO_SYNC_INTERVAL_MS;
  }

  async function syncNow({ manual = false } = {}) {
    if (!evaluateReadiness()) {
      if (manual) openConfig();
      return;
    }

    const workerUrl = getSetting(STORE_KEYS.workerUrl).replace(/\/$/, "");
    const syncToken = getSetting(STORE_KEYS.syncToken);
    const syncBtn = document.getElementById("dm-sync-btn");
    if (syncBtn) syncBtn.disabled = true;

    try {
      setStatus("未提出課題を集約中…");
      const payload = await collectCurrentSnapshot();
      if (!payload.courses.length) {
        setStatus("課題一覧をまだ取得できていません。manaba のホームまたは課題一覧を開いてから再試行してください。", "warn");
        return;
      }

      const hash = JSON.stringify(payload.courses);
      if (!manual && hash === getSetting(STORE_KEYS.lastSyncHash)) {
        setStatus("内容が前回同期と同じため送信を省略しました。", "info");
        return;
      }

      setStatus(`Worker へ送信中…\n科目 ${payload.courses.length} 件`);
      const response = await requestJson(`${workerUrl}/api/manaba/push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Manaba-Token": syncToken
        },
        body: JSON.stringify(payload)
      });

      setSetting(STORE_KEYS.lastSyncHash, hash);
      setSetting(STORE_KEYS.lastSyncAt, response.receivedAt || new Date().toISOString());
      renderMeta();
      setStatus(`同期完了\n科目 ${response.courseCount} 件 / 課題 ${response.assignmentCount} 件`, "ok");
    } catch (error) {
      setStatus(`同期失敗: ${error.message || error}`, "error");
    } finally {
      if (syncBtn) syncBtn.disabled = false;
    }
  }

  async function collectCurrentSnapshot() {
    const courseMap = new Map();

    readAssignmentsFromCurrentPage().forEach((entry) => mergeAssignment(courseMap, entry));

    const homeCourses = await scrapeHomeCourses();
    for (const course of homeCourses) {
      const assignments = await scrapeCourseAssignments(course);
      assignments.forEach((assignment) => mergeAssignment(courseMap, { ...assignment, course }));
    }

    return {
      manabaUrl: location.origin,
      scrapedAt: new Date().toISOString(),
      courses: Array.from(courseMap.values())
    };
  }

  function mergeAssignment(courseMap, entry) {
    const courseTitle = normalizeText(entry?.course?.title || entry?.courseTitle || "");
    if (!courseTitle) return;
    const courseUrl = String(entry?.course?.url || entry?.courseUrl || "").trim();
    const courseExternalId = String(entry?.course?.externalId || courseUrl || courseTitle).trim();
    const assignmentTitle = normalizeText(entry?.title || "");
    if (!assignmentTitle) return;

    const status = normalizeText(entry?.status || "");
    if (isSubmittedStatus(status)) return;
    if (status && !isUnsubmittedStatus(status) && isLikelyClosed(status)) return;

    const due = parseDeadline(entry?.deadlineText || entry?.dueText || "", entry?.dueDate, entry?.dueTime);
    const externalUrl = String(entry?.url || courseUrl || "").trim();
    const externalId = String(entry?.externalId || externalUrl || `${courseExternalId}::${assignmentTitle}::${due.dueDate}::${due.dueTime}`).trim();

    const courseRecord = courseMap.get(courseExternalId) || {
      title: courseTitle,
      url: courseUrl,
      externalId: courseExternalId,
      assignments: []
    };

    const duplicate = courseRecord.assignments.some((item) => String(item.externalId || "") === externalId);
    if (!duplicate) {
      courseRecord.assignments.push({
        title: assignmentTitle,
        dueDate: due.dueDate,
        dueTime: due.dueTime,
        status,
        url: externalUrl,
        externalId,
        type: inferType(assignmentTitle)
      });
    }

    courseMap.set(courseExternalId, courseRecord);
  }

  function readAssignmentsFromCurrentPage() {
    const rows = Array.from(document.querySelectorAll("table.reportlist tr, table.stdlist tr, table.small tr, .report-list tr, .assignment-list tr"));
    if (!rows.length) return [];

    const fallbackCourse = detectCourseFromPage();
    return rows.map((row) => {
      const cells = Array.from(row.querySelectorAll("td"));
      const firstLink = row.querySelector("a[href]");
      const title = normalizeText(firstLink?.textContent || cells[0]?.textContent || "");
      const deadlineText = normalizeText(row.querySelector(".deadline, .endtime")?.textContent || cells[2]?.textContent || cells[1]?.textContent || "");
      const status = normalizeText(row.querySelector(".submissionstatus, .status")?.textContent || cells[cells.length - 1]?.textContent || "");
      return {
        course: fallbackCourse,
        title,
        deadlineText,
        status,
        url: firstLink?.href || fallbackCourse.url || ""
      };
    }).filter((item) => item.title);
  }

  function detectCourseFromPage() {
    const titleNode = document.querySelector(".course-title, .coursename, h1, h2");
    const linkNode = document.querySelector("a[href*='course_']");
    const title = normalizeText(titleNode?.textContent || linkNode?.textContent || document.title.replace(/\s*\|.*$/, ""));
    const url = linkNode?.href || location.href;
    return {
      title,
      url,
      externalId: url || title
    };
  }

  async function scrapeHomeCourses() {
    const currentRows = extractHomeCourseRows(document);
    if (currentRows.length) return currentRows;

    const homeUrl = new URL("/s/home", location.origin).toString();
    const html = await requestText(homeUrl);
    const doc = new DOMParser().parseFromString(html, "text/html");
    return extractHomeCourseRows(doc);
  }

  function extractHomeCourseRows(root) {
    const rows = [
      ...root.querySelectorAll(".courselist-table-td"),
      ...root.querySelectorAll("tr.course"),
      ...root.querySelectorAll(".courselistrow"),
      ...root.querySelectorAll("a[href*='course_']")
    ];
    const seen = new Map();
    rows.forEach((row) => {
      const link = row.matches?.("a[href]") ? row : row.querySelector?.("a[href*='course_'], a.course-title, td.courselist-name a");
      if (!link) return;
      const url = link.href;
      const title = normalizeText(link.textContent);
      if (!url || !title) return;
      seen.set(url, {
        title,
        url,
        externalId: url
      });
    });
    return Array.from(seen.values());
  }

  async function scrapeCourseAssignments(course) {
    const candidates = buildCandidateUrls(course.url);
    for (const url of candidates) {
      try {
        const html = await requestText(url);
        const doc = new DOMParser().parseFromString(html, "text/html");
        const assignments = readAssignmentsFromDocument(doc, course);
        if (assignments.length) return assignments;
      } catch {
        // ignore and continue
      }
    }
    return [];
  }

  function buildCandidateUrls(courseUrl) {
    const normalized = String(courseUrl || "").trim();
    if (!normalized) return [];
    const urls = new Set([normalized]);
    if (/course_\d+$/.test(normalized)) {
      urls.add(`${normalized}_report`);
      urls.add(`${normalized}_query`);
      urls.add(`${normalized}_assignments`);
    }
    return Array.from(urls);
  }

  function readAssignmentsFromDocument(doc, course) {
    const rows = Array.from(doc.querySelectorAll("table.reportlist tr, table.stdlist tr, table.small tr, .report-list tr, .assignment-list tr"));
    return rows.map((row) => {
      const cells = Array.from(row.querySelectorAll("td"));
      const firstLink = row.querySelector("a[href]");
      const title = normalizeText(firstLink?.textContent || cells[0]?.textContent || "");
      if (!title) return null;
      return {
        course,
        title,
        deadlineText: normalizeText(row.querySelector(".deadline, .endtime")?.textContent || cells[2]?.textContent || cells[1]?.textContent || ""),
        status: normalizeText(row.querySelector(".submissionstatus, .status")?.textContent || cells[cells.length - 1]?.textContent || ""),
        url: firstLink?.href || course.url || ""
      };
    }).filter(Boolean);
  }

  function parseDeadline(text, explicitDate = "", explicitTime = "") {
    const normalizedDate = String(explicitDate || "").trim();
    const normalizedTime = String(explicitTime || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
      return {
        dueDate: normalizedDate,
        dueTime: /^\d{2}:\d{2}$/.test(normalizedTime) ? normalizedTime : ""
      };
    }
    const raw = String(text || "").replace(/[年月]/g, "-").replace(/日/g, "").replace(/[時]/g, ":").replace(/[分]/g, "").replace(/\s+/g, " ").trim();
    const match = raw.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:\D+(\d{1,2}):(\d{2}))?/);
    if (!match) {
      return { dueDate: "", dueTime: "" };
    }
    const dueDate = `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
    const dueTime = match[4] ? `${String(Number(match[4])).padStart(2, "0")}:${match[5]}` : "";
    return { dueDate, dueTime };
  }

  function inferType(title) {
    if (/試験|期末|中間/.test(title)) return "exam";
    if (/小テスト|クイズ|テスト/.test(title)) return "quiz";
    if (/発表|プレゼン/.test(title)) return "presentation";
    if (/宿題/.test(title)) return "homework";
    return "report";
  }

  function isSubmittedStatus(status) {
    return SUBMITTED_PATTERNS.some((pattern) => status.includes(pattern));
  }

  function isUnsubmittedStatus(status) {
    if (!status) return true;
    return UNSUBMITTED_PATTERNS.some((pattern) => status.includes(pattern));
  }

  function isLikelyClosed(status) {
    return /終了|closed|締切/.test(status);
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function requestText(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        onload(response) {
          if (response.status >= 200 && response.status < 300) {
            resolve(response.responseText);
            return;
          }
          reject(new Error(`${response.status} ${response.statusText || ""}`.trim()));
        },
        onerror() {
          reject(new Error("ページ取得に失敗しました。"));
        }
      });
    });
  }

  function requestJson(url, options = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: options.method || "GET",
        url,
        headers: options.headers || {},
        data: options.body || undefined,
        onload(response) {
          if (response.status < 200 || response.status >= 300) {
            try {
              const payload = JSON.parse(response.responseText || "{}");
              reject(new Error(payload.error || `${response.status} ${response.statusText || ""}`.trim()));
            } catch {
              reject(new Error(`${response.status} ${response.statusText || ""}`.trim()));
            }
            return;
          }
          try {
            resolve(JSON.parse(response.responseText || "{}"));
          } catch {
            reject(new Error("JSON解析に失敗しました。"));
          }
        },
        onerror() {
          reject(new Error("Worker への接続に失敗しました。"));
        }
      });
    });
  }

  buildPanel();
  const ready = evaluateReadiness();
  if (ready && shouldAutoSync()) {
    syncNow({ manual: false });
  }
})();
