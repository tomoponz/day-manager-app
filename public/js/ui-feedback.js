let isInitialized = false;
let feedbackReadyPromise = null;

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

export async function confirmDialog(options = {}) {
  const {
    title = '確認',
    message = '',
    danger = false
  } = options;

  // Temporary hard fallback: native confirm is ugly but reliable.
  // We prefer a working confirmation flow over a broken custom modal.
  const body = message ? `${title}\n\n${message}` : title;
  return Promise.resolve(window.confirm(body));
}

function dismissToast(toast) {
  if (!toast || !toast.isConnected) return;
  toast.classList.remove('is-visible');
  window.setTimeout(() => toast.remove(), 180);
}

async function ensureFeedbackUi() {
  if (isInitialized && document.getElementById('feedbackToastRegion')) {
    return;
  }

  if (!document.body) {
    if (!feedbackReadyPromise) {
      feedbackReadyPromise = new Promise((resolve) => {
        document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
      }).then(() => {
        feedbackReadyPromise = null;
        return ensureFeedbackUi();
      });
    }
    return feedbackReadyPromise;
  }

  if (!document.getElementById('feedbackToastRegion')) {
    const region = document.createElement('div');
    region.id = 'feedbackToastRegion';
    region.className = 'feedback-toast-region';
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'false');
    document.body.appendChild(region);
  }

  isInitialized = true;
}
