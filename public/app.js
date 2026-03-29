(() => {
  const APP_VERSION = "v0.7.0";

  bootstrap().catch((error) => {
    console.error("Day Manager bootstrap failed:", error);
    showBootstrapError(error);
  });

  async function bootstrap() {
    mountAppVersion();

    const [utilsModule, timeModule, renderModule, actionsModule, googleModule, calendarModule, studyModule, onboardingModule] = await Promise.all([
      import("./js/utils.js"),
      import("./js/time.js"),
      import("./js/render.js"),
      import("./js/actions.js"),
      import("./js/google-calendar.js"),
      import("./js/calendar-ui.js"),
      import("./js/study-manager.js"),
      import("./js/onboarding.js")
    ]);

    await import("./js/main-screen-layout.js");

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
    await import("./js/ai-gemini-assist.js");
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
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    let isRefreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (isRefreshing) return;
      isRefreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker.register("./sw.js").then((registration) => {
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
      <button type="button" class="primary">再読み込み</button>
    `;
    banner.querySelector("button")?.addEventListener("click", () => window.location.reload());
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
