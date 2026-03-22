:root {
  --bg: #0b1020;
  --card: #151b2f;
  --card-2: #1b2340;
  --text: #eef2ff;
  --muted: #b7c1e0;
  --line: rgba(255, 255, 255, 0.12);
  --accent: #7c9cff;
  --accent-2: #9ce0ff;
  --danger: #ff8f8f;
  --ok: #95e3a3;
  --shadow: 0 16px 50px rgba(0, 0, 0, 0.35);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: linear-gradient(180deg, #080c18 0%, #0b1020 100%);
  color: var(--text);
}

button,
input,
select,
textarea {
  font: inherit;
}

button {
  cursor: pointer;
  border: 1px solid var(--line);
  background: #20294b;
  color: var(--text);
  border-radius: 12px;
  padding: 0.8rem 1rem;
  transition: 0.18s ease;
}

button:hover,
.file-label:hover {
  transform: translateY(-1px);
  border-color: rgba(255, 255, 255, 0.24);
}

button.primary {
  background: linear-gradient(135deg, var(--accent), #5c76ff);
  border: none;
}

button.ghost,
.file-label {
  background: transparent;
}

.topbar {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.6rem;
  border-bottom: 1px solid var(--line);
  position: sticky;
  top: 0;
  backdrop-filter: blur(16px);
  background: rgba(11, 16, 32, 0.86);
  z-index: 10;
}

.eyebrow {
  margin: 0 0 0.3rem;
  font-size: 0.8rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent-2);
}

h1,
h2,
h3,
p {
  margin-top: 0;
}

h1 {
  margin-bottom: 0.4rem;
  font-size: 2rem;
}

.sub {
  margin-bottom: 0;
  color: var(--muted);
}

.header-actions {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.file-label {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 0.8rem 1rem;
  display: inline-flex;
  align-items: center;
}

.container {
  max-width: 1220px;
  margin: 0 auto;
  padding: 1.5rem;
}

.grid {
  display: grid;
  gap: 1rem;
}

.two-col {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.card {
  background: linear-gradient(180deg, var(--card), var(--card-2));
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
  border-radius: 24px;
  padding: 1.25rem;
  margin-bottom: 1rem;
}

.card-header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
  margin-bottom: 1rem;
}

.card-header.compact {
  margin-bottom: 0.75rem;
}

.date-wrap label,
.conditions-grid label,
.form-grid label,
.prompt-label {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  color: var(--muted);
}

input,
select,
textarea {
  width: 100%;
  color: var(--text);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 0.85rem 0.95rem;
}

textarea {
  min-height: 220px;
  resize: vertical;
}

.conditions-grid,
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.9rem;
}

.task-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.full-span {
  grid-column: 1 / -1;
}

.summary-grid {
  margin: 1.25rem 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.9rem;
}

.summary-box {
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: 1rem;
}

.summary-box h3 {
  margin-bottom: 0.75rem;
  font-size: 1rem;
}

.summary-list {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.summary-list.empty,
.list-wrap.empty {
  color: var(--muted);
}

.summary-chip {
  background: rgba(124, 156, 255, 0.12);
  border: 1px solid rgba(124, 156, 255, 0.24);
  color: var(--text);
  border-radius: 12px;
  padding: 0.7rem 0.8rem;
}

.prompt-actions {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.list-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.list-item {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.04);
  border-radius: 18px;
  padding: 0.9rem 1rem;
}

.list-main {
  min-width: 0;
}

.item-title {
  display: block;
  margin-bottom: 0.3rem;
  font-size: 1.02rem;
}

.item-meta,
.item-note {
  margin: 0;
  color: var(--muted);
  word-break: break-word;
}

.item-note {
  margin-top: 0.35rem;
}

.list-actions {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.mini-btn {
  padding: 0.55rem 0.75rem;
  border-radius: 10px;
}

.status-select {
  min-width: 120px;
}

.tag-ok {
  color: var(--ok);
}

.tag-danger {
  color: var(--danger);
}

@media (max-width: 920px) {
  .two-col,
  .summary-grid,
  .task-grid,
  .conditions-grid,
  .form-grid {
    grid-template-columns: 1fr;
  }

  .topbar,
  .card-header,
  .list-item {
    flex-direction: column;
  }

  .list-actions {
    justify-content: flex-start;
  }
}
