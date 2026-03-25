(() => {
  const pendingGoogleSignals = { gapi: false, gis: false };
  let googleApi = null;

  window.gapiLoaded = () => {
    if (googleApi?.gapiLoaded) { googleApi.gapiLoaded(); return; }
    pendingGoogleSignals.gapi = true;
  };

  window.gisLoaded = () => {
    if (googleApi?.gisLoaded) { googleApi.gisLoaded(); return; }
    pendingGoogleSignals.gis = true;
  };

  bootstrap().catch((error) => {
    console.error('Day Manager bootstrap failed:', error);
    showBootstrapError(error);
  });

  async function bootstrap() {
    const [stateModule, utilsModule, timeModule, renderModule, actionsModule, googleModule] = await Promise.all([
      import('./js/state.js'),
      import('./js/utils.js'),
      import('./js/time.js'),
      import('./js/render.js'),
      import('./js/actions.js'),
      import('./js/google-calendar.js')
    ]);

    googleApi = googleModule;
    await import('./js/product-ui-tune.js');
    await import('./js/main-screen-layout.js');

    googleModule.configureGoogleUi({
      renderAll: renderModule.renderAll,
      updateGoogleStatus: renderModule.updateGoogleStatus,
      updateGoogleConnectionBadge: renderModule.updateGoogleConnectionBadge,
      hydrateGoogleConfigInputs: renderModule.hydrateGoogleConfigInputs
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
    renderModule.hydrateGoogleConfigInputs();
    renderModule.hydratePlannerMode();
    renderModule.renderCurrentClock();
    renderModule.renderAll();
    renderModule.updateGoogleConnectionBadge();

    if (googleModule.googleState.config.clientId && googleModule.googleState.config.apiKey) {
      renderModule.updateGoogleStatus('連携設定は保存されています。Googleで接続すると対象日の予定を読み込めます。');
    } else {
      renderModule.updateGoogleStatus('未接続です。Client ID と API Key を保存してから Google で接続してください。');
    }

    registerServiceWorker();
    googleModule.maybePrepareTokenClient();
    await import('./js/ai-gemini-assist.js');

    timeModule.startClock(() => {
      renderModule.renderCurrentClock();
      if (timeModule.isSelectedDateToday(utilsModule.$('selectedDate')?.value)) {
        renderModule.renderCurrentState();
        renderModule.renderSummaries();
        renderModule.renderAutoPlan();
      }
    });

    if (pendingGoogleSignals.gapi) { pendingGoogleSignals.gapi = false; googleModule.gapiLoaded(); }
    if (pendingGoogleSignals.gis) { pendingGoogleSignals.gis = false; googleModule.gisLoaded(); }
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  function showBootstrapError(error) {
    const existing = document.getElementById('bootstrapErrorBanner');
    if (existing) {
      existing.hidden = false;
      const message = existing.querySelector('.bootstrap-error-banner__message');
      if (message) message.textContent = formatBootstrapError(error);
      return;
    }

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

  function formatBootstrapError(error) {
    return error?.message || '初期化に失敗しました。再読み込みするか、直前に追加した設定を見直してください。';
  }

  function escapeHtml(text) {
    return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }
})();