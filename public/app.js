(() => {
  bootstrap().catch((error) => {
    console.error("Day Manager bootstrap failed:", error);
    showBootstrapError(error);
  });

  async function bootstrap() {
    const [utilsModule, timeModule, renderModule, actionsModule, googleModule, calendarModule, studyModule] = await Promise.all([
      import("./js/utils.js"),
      import("./js/time.js"),
      import("./js/render.js"),
      import("./js/actions.js"),
      import("./js/google-calendar.js"),
      import("./js/calendar-ui.js"),
      import("./js/study-manager.js")
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
      onDeleteGoogleEvent: actionsModule.deleteGoogleEvent
    });

    actionsModule.setToday();
    actionsModule.bindEvents();
    renderModule.hydratePlannerMode();
    renderModule.renderCurrentClock();
    calendarModule.initializeCalendarUi();
    studyModule.initializeStudyManager();
    renderModule.renderAll();

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

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
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
