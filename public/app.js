(() => {
  const APP_VERSION = "v0.7.6";
  const APP_RELEASE_NOTE = "最新更新: 起動エラー対策としてモジュール読込を安定化";
  const MODULE_VERSION = APP_VERSION;
  const FORCE_REFRESH_FLAG = "day-manager-force-refresh-once";

  bootstrap().then(() => {
    try {
      sessionStorage.removeItem(FORCE_REFRESH_FLAG);
    } catch {}
  }).catch(async (error) => {
    console.error("Day Manager bootstrap failed:", error);
    const recovered = await tryRecoverFromStaleAssets(error);
    if (!recovered) {
      showBootstrapError(error);
    }
  });

  async function importModule(path, label) {
    const url = `${path}?v=${encodeURIComponent(MODULE_VERSION)}`;
    try {
      return await import(url);
    } catch (error) {
      const reason = error?.message || String(error);
      throw new Error(`${label} の読み込みに失敗しました: ${reason}`);
    }
  }

  async function bootstrap() {
    mountAppVersion();

    const utilsModule = await importModule("./js/utils.js", "utils.js");
    const timeModule = await importModule("./js/time.js", "time.js");
    const renderModule = await importModule("./js/render.js", "render.js");
    const actionsModule = await importModule("./js/actions.js", "actions.js");
    const googleModule = await importModule("./js/google-calendar.js", "google-calendar.js");
    const calendarModule = await importModule("./js/calendar-ui.js", "calendar-ui.js");
    const studyModule = await importModule("./js/study-manager.js", "study-manager.js");
    const onboardingModule = await importModule("./js/onboarding.js", "onboarding.js");
    await importModule("./js/main-screen-layout.js", "main-screen-layout.js");

    googleModule.configureGoogleUi({
      renderAll: renderModule.renderAll,
      updateGoogleStatus: renderModule.updateGoogleStatus,
      updateGoogleConnectionBadge: renderModule.updateGoogleConnectionBadge
    });

    calendarModule.configureCalendarUiHandlers({
      openEventFormForCreate: actionsModule.openEventFormForCreate,
      populateEventForm: actionsModule.populateEventForm,
      populateFixedForm: actionsModule.populateFixedForm,
      deleteEvent: actionsModule.deleteEvent
    });

    renderModule.configureRenderHandlers({
      onEditFixed: actionsModule.populateFixedForm,
      onDuplicateFixed: actionsModule.duplicateFixedSchedule,
      onDeleteFixed: actionsModule.deleteFixedSchedule,
      onCreateFixed: actionsModule.openFixedFormForCreate,
      onEditEvent: actionsModule.populateEventForm,
      onDuplicateEvent: actionsModule.duplicateOneOffEvent,
      onSyncEvent: actionsModule.syncEvent,
      onSyncUpdatedEvent: actionsModule.syncUpdatedEvent,
      onDeleteEvent: actionsModule.deleteEvent,
      onCreateEvent: actionsModule.openEventFormForCreate,
      onQuickSetTaskStatus: actionsModule.quickSetTaskStatus,
      onDeferTaskToTomorrow: actionsModule.deferTaskToTomorrow,
      onEditTask: actionsModule.populateTaskForm,
      onDeleteTask: actionsModule.deleteTask,
      onCreateTask: actionsModule.openTaskFormForCreate,
      onEditStudyLocation: actionsModule.populateStudyLocationForm,
      onDeleteStudyLocation: actionsModule.deleteStudyLocation,
      onCreateStudyLocation: actionsModule.openStudyLocationFormForCreate,
      onOpenStudyLocationSourceUrl: actionsModule.openStudyLocationSourceUrl,
      onMarkStudyLocationCheckedOpen: actionsModule.markStudyLocationCheckedOpen,
      onMarkStudyLocationCheckedClosed: actionsModule.markStudyLocationCheckedClosed,
      onMarkStudyLocationCheckedShortened: actionsModule.markStudyLocationCheckedShortened,
      onClearStudyLocationDateCheck: actionsModule.clearStudyLocationDateCheck,
      onDeleteGoogleEvent: actionsModule.deleteGoogleEvent
    });

    actionsModule.setToday();
    actionsModule.bindEvents();
    renderModule.hydratePlannerMode();
    renderModule.renderCurrentClock();
    calendarModule.initializeCalendarUi();
    studyModule.initializeStudyManager();
    renderModule.renderAll();
    onboardingModule.initializeOnboarding({
      getGoogleConnected: () => Boolean(googleModule.googleState?.connected),
      onConnectGoogle: googleModule.onConnectGoogle,
      onDisconnectGoogle: googleModule.onDisconnectGoogle
    });

    registerServiceWorker();
    await importModule("./js/ai-gemini-assist.js", "ai-gemini-assist.js");
    await googleModule.initializeGoogleBackgroundSync();

    timeModule.startClock(() => {
      renderModule.renderCurrentClock();
      if (timeModule.isSelectedDateToday(utilsModule.$("selectedDate")?.value)) {
        renderModule.renderCurrentState();
        renderModule.renderSummaries();
        renderModule.renderAutoPlan();
      }
    });
  }

  function mountAppVersion() {
    document.documentElement.dataset.appVersion = APP_VERSION;
    const versionTargets = [
      document.getElementById("appVersionMount"),
      document.getElementById("appVersionText")
    ];
    versionTargets.forEach((node) => {
      if (node) node.textContent = APP_VERSION;
    });

    const releaseTargets = [
      document.getElementById("appReleaseNoteMount"),
      document.getElementById("appReleaseNoteText")
    ];
    releaseTargets.forEach((node) => {
      if (node) node.textContent = APP_RELEASE_NOTE;
    });
  }

  async function tryRecoverFromStaleAssets(error) {
    const message = formatBootstrapError(error);
    const looksLikeStaleAssetIssue = /missing \) after argument list|Unexpected token|Unexpected identifier|読み込みに失敗/i.test(message);
    if (!looksLikeStaleAssetIssue) return false;

    try {
      if (sessionStorage.getItem(FORCE_REFRESH_FLAG) === "1") {
        return false;
      }
      sessionStorage.setItem(FORCE_REFRESH_FLAG, "1");
    } catch {
      return false;
    }

    await clearClientCaches();
    const url = new URL(window.location.href);
    url.searchParams.set("hard_reload", String(Date.now()));
    window.location.replace(url.toString());
    return true;
  }

  async function clearClientCaches() {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));
    }

    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key).catch(() => false)));
    }
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    let isRefreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (isRefreshing) return;
      isRefreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker.register(`./sw.js?v=${encodeURIComponent(MODULE_VERSION)}`).then((registration) => {
      if (registration.waiting) {
        showAppUpdateBanner(registration);
      }

      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            showAppUpdateBanner(registration);
          }
        });
      });
    }).catch(() => {});
  }

  function showAppUpdateBanner(registration) {
    const existing = document.getElementById("appUpdateBanner");
    if (existing) {
      existing.hidden = false;
      return;
    }

    const banner = document.createElement("section");
    banner.id = "appUpdateBanner";
    banner.className = "app-update-banner";
    banner.innerHTML = `
      <div class="app-update-banner__text">
        <strong>${APP_VERSION}</strong> より新しい更新があります。表示が古いときは、このまま更新して最新のJS/CSSへ切り替えてください。
      </div>
      <div class="app-update-banner__actions">
        <button type="button" class="primary">更新して再読込</button>
        <button type="button" class="ghost">あとで</button>
      </div>
    `;

    const [reloadButton, laterButton] = banner.querySelectorAll("button");
    reloadButton?.addEventListener("click", () => {
      if (registration.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      } else {
        window.location.reload();
      }
    });
    laterButton?.addEventListener("click", () => banner.remove());
    document.body.appendChild(banner);
  }

  function showBootstrapError(error) {
    const existing = document.getElementById("bootstrapErrorBanner");
    if (existing) {
      existing.hidden = false;
      const message = existing.querySelector(".bootstrap-error-banner__message");
      if (message) message.textContent = formatBootstrapError(error);
      return;
    }

    const banner = document.createElement("section");
    banner.id = "bootstrapErrorBanner";
    banner.className = "bootstrap-error-banner";
    banner.innerHTML = `
      <strong>起動エラー</strong>
      <p class="bootstrap-error-banner__message">${escapeHtml(formatBootstrapError(error))}</p>
      <div class="bootstrap-error-banner__actions">
        <button type="button" class="primary" data-action="reload">再読み込み</button>
        <button type="button" class="ghost" data-action="force-refresh">強制更新</button>
      </div>
    `;
    banner.querySelector('[data-action="reload"]')?.addEventListener("click", () => window.location.reload());
    banner.querySelector('[data-action="force-refresh"]')?.addEventListener("click", async () => {
      await clearClientCaches();
      const url = new URL(window.location.href);
      url.searchParams.set("hard_reload", String(Date.now()));
      window.location.replace(url.toString());
    });
    document.body.prepend(banner);
  }

  function formatBootstrapError(error) {
    return error?.message || "初期化に失敗しました。再読み込みするか、Cloudflare Worker の設定を見直してください。";
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
})();
