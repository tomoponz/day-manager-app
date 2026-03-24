let isInitialized = false;
let activeConfirm = null;

export function showToast(message, options = {}) {
  ensureFeedbackUi();
  const {
    variant = 'info',
    duration = 4000,
    actionLabel = '',
    onAction = null
  } = options;

  const region = document.getElementById('feedbackToastRegion');
  if (!region) return;

  const toast = document.createElement('div');
  toast.className = `feedback-toast ${variant ? `is-${variant}` : ''}`.trim();

  const text = document.createElement('div');
  text.className = 'feedback-toast__text';
  text.textContent = message;
  toast.appendChild(text);

  if (actionLabel && typeof onAction === 'function') {
    const actionButton = document.createElement('button');
    actionButton.type = 'button';
    actionButton.className = 'feedback-toast__action';
    actionButton.textContent = actionLabel;
    actionButton.addEventListener('click', () => {
      try {
        onAction();
      } finally {
        dismissToast(toast);
      }
    });
    toast.appendChild(actionButton);
  }

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'feedback-toast__close';
  closeButton.setAttribute('aria-label', '閉じる');
  closeButton.textContent = '×';
  closeButton.addEventListener('click', () => dismissToast(toast));
  toast.appendChild(closeButton);

  region.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));

  if (duration > 0) {
    window.setTimeout(() => dismissToast(toast), duration);
  }
}

export function confirmDialog(options = {}) {
  ensureFeedbackUi();
  const {
    title = '確認',
    message = '',
    confirmText = 'OK',
    cancelText = 'キャンセル',
    danger = false
  } = options;

  if (activeConfirm?.resolver) {
    activeConfirm.resolver(false);
    activeConfirm = null;
  }

  const root = document.getElementById('feedbackConfirmRoot');
  const titleEl = document.getElementById('feedbackConfirmTitle');
  const messageEl = document.getElementById('feedbackConfirmMessage');
  const confirmBtn = document.getElementById('feedbackConfirmOk');
  const cancelBtn = document.getElementById('feedbackConfirmCancel');

  if (!root || !titleEl || !messageEl || !confirmBtn || !cancelBtn) {
    return Promise.resolve(window.confirm(message || title));
  }

  titleEl.textContent = title;
  messageEl.textContent = message;
  confirmBtn.textContent = confirmText;
  cancelBtn.textContent = cancelText;
  confirmBtn.classList.toggle('primary', !danger);
  confirmBtn.classList.toggle('danger', danger);

  root.hidden = false;
  root.setAttribute('aria-hidden', 'false');

  return new Promise((resolve) => {
    const cleanup = (result) => {
      root.hidden = true;
      root.setAttribute('aria-hidden', 'true');
      confirmBtn.replaceWith(confirmBtn.cloneNode(true));
      cancelBtn.replaceWith(cancelBtn.cloneNode(true));
      bindDialogButtonHandlers();
      activeConfirm = null;
      resolve(result);
    };

    activeConfirm = { resolver: resolve };

    document.getElementById('feedbackConfirmOk')?.addEventListener('click', () => cleanup(true), { once: true });
    document.getElementById('feedbackConfirmCancel')?.addEventListener('click', () => cleanup(false), { once: true });

    const backdrop = root.querySelector('.feedback-confirm__backdrop');
    backdrop?.addEventListener('click', () => cleanup(false), { once: true });

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        document.removeEventListener('keydown', onKeyDown);
        cleanup(false);
      }
    };
    document.addEventListener('keydown', onKeyDown, { once: true });
  });
}

function dismissToast(toast) {
  if (!toast || !toast.isConnected) return;
  toast.classList.remove('is-visible');
  window.setTimeout(() => toast.remove(), 180);
}

function ensureFeedbackUi() {
  if (isInitialized) return;
  isInitialized = true;

  if (!document.getElementById('feedbackToastRegion')) {
    const region = document.createElement('div');
    region.id = 'feedbackToastRegion';
    region.className = 'feedback-toast-region';
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'false');
    document.body.appendChild(region);
  }

  if (!document.getElementById('feedbackConfirmRoot')) {
    const root = document.createElement('div');
    root.id = 'feedbackConfirmRoot';
    root.className = 'feedback-confirm';
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
      <div class="feedback-confirm__backdrop"></div>
      <div class="feedback-confirm__dialog" role="dialog" aria-modal="true" aria-labelledby="feedbackConfirmTitle">
        <h3 id="feedbackConfirmTitle" class="feedback-confirm__title">確認</h3>
        <p id="feedbackConfirmMessage" class="feedback-confirm__message"></p>
        <div class="feedback-confirm__actions">
          <button id="feedbackConfirmCancel" type="button" class="ghost">キャンセル</button>
          <button id="feedbackConfirmOk" type="button" class="primary">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    bindDialogButtonHandlers();
  }
}

function bindDialogButtonHandlers() {
  // placeholder: listeners are attached per open via once handlers
}
