boot();

function boot() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectStyles, { once: true });
  } else {
    injectStyles();
  }
}

function injectStyles() {
  if (document.getElementById('productUiTuneStyles')) return;
  const style = document.createElement('style');
  style.id = 'productUiTuneStyles';
  style.textContent = `
.feedback-toast-region {
  position: fixed;
  right: 16px;
  bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  z-index: 9999;
}
.feedback-toast {
  min-width: 240px;
  max-width: 360px;
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 0.5rem;
  align-items: start;
  background: #fff;
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  box-shadow: var(--shadow-md);
  padding: 0.8rem 0.9rem;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity var(--ease), transform var(--ease);
}
.feedback-toast.is-visible { opacity: 1; transform: translateY(0); }
.feedback-toast.is-ok { border-color: rgba(61,122,85,.25); background: var(--ok-bg); }
.feedback-toast.is-warn { border-color: rgba(185,28,28,.2); background: var(--danger-bg); }
.feedback-toast__text { font-size: .86rem; }
.feedback-toast__action, .feedback-toast__close {
  border: none; background: transparent; box-shadow: none; padding: 0; min-width: auto;
}
.feedback-toast__action { color: var(--accent); font-weight: 600; }
.feedback-toast__close { color: var(--muted); }
.feedback-confirm {
  position: fixed; inset: 0; z-index: 9998; display: grid; place-items: center;
}
.feedback-confirm__backdrop { position:absolute; inset:0; background: rgba(28,25,23,.28); }
.feedback-confirm__dialog {
  position: relative; width: min(92vw, 420px); background: var(--card); color: var(--text);
  border: 1px solid var(--line); border-radius: var(--r); box-shadow: var(--shadow-md); padding: 1.2rem;
}
.feedback-confirm__title { margin-bottom: .5rem; }
.feedback-confirm__message { color: var(--muted); margin-bottom: 1rem; white-space: pre-wrap; }
.feedback-confirm__actions { display:flex; justify-content:flex-end; gap:.6rem; flex-wrap:wrap; }
button.danger { background: var(--danger); color:#fff; border:none; }
.main-list-slot > .list-wrap { margin-top: .15rem; }
.item-meta {
  margin: 0 0 0.35rem 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.item-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  border: 1px solid var(--line);
  padding: 0.15rem 0.5rem;
  font-size: 0.74rem;
  font-weight: 600;
  color: var(--muted);
  background: #fff;
}
.item-badge.is-ok {
  color: var(--ok);
  background: var(--ok-bg);
  border-color: rgba(61, 122, 85, 0.2);
}
.item-badge.is-danger {
  color: var(--danger);
  background: var(--danger-bg);
  border-color: rgba(185, 28, 28, 0.2);
}
.item-badge.is-warn {
  color: var(--accent-hover);
  background: var(--accent-light);
  border-color: rgba(192, 83, 58, 0.22);
}
.item-detail {
  margin: 0 0 0.2rem 0;
  font-size: 0.82rem;
  color: var(--muted);
}
.item-detail:empty { display:none; }
.task-item.is-completed { opacity: 0.62; }
.task-item.is-overdue { border-color: rgba(185, 28, 28, 0.45); background: #fff8f8; }
.task-item.is-deadline-soon:not(.is-overdue) { border-color: rgba(192, 83, 58, 0.35); }
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
.bootstrap-error-banner__message {
  margin: 0;
  color: var(--danger);
}
@media (max-width: 640px) {
  .feedback-toast-region { left: 12px; right: 12px; bottom: 12px; }
  .feedback-toast { max-width: none; }
}
`;
  document.head.appendChild(style);
}
