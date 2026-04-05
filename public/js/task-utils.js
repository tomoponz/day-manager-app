/**
 * @param {{ repeatDaily?: boolean, completedDates?: string[] }} task
 * @param {string} dateStr
 * @returns {boolean}
 */
export function isTaskCompletedOnDate(task, dateStr = "") {
  return Boolean(task?.repeatDaily && Array.isArray(task?.completedDates) && task.completedDates.includes(dateStr));
}

/**
 * @param {{ repeatDaily?: boolean, completedDates?: string[], status?: string }} task
 * @param {string} dateStr
 * @returns {string}
 */
export function getTaskEffectiveStatus(task, dateStr = "") {
  if (isTaskCompletedOnDate(task, dateStr)) return "完了";
  if (task?.repeatDaily && task?.status === "完了") return "未着手";
  return task?.status || "未着手";
}

/**
 * @param {Array<any>} items
 * @param {string} dateStr
 * @returns {Array<any>}
 */
export function sortTasksForDisplay(items = [], dateStr = "") {
  const priorityOrder = { 高: 0, 中: 1, 低: 2 };
  const statusRank = { 未着手: 0, 進行中: 1, 完了: 2 };
  const importanceRank = { 必須: 0, できれば: 1, 後回し: 2 };

  return [...items].sort((a, b) => {
    const statusA = getTaskEffectiveStatus(a, dateStr);
    const statusB = getTaskEffectiveStatus(b, dateStr);
    if (statusRank[statusA] !== statusRank[statusB]) {
      return statusRank[statusA] - statusRank[statusB];
    }
    if (importanceRank[a.importance] !== importanceRank[b.importance]) {
      return importanceRank[a.importance] - importanceRank[b.importance];
    }
    const deadlineA = `${a.deadlineDate || "9999-99-99"} ${a.deadlineTime || "99:99"}`;
    const deadlineB = `${b.deadlineDate || "9999-99-99"} ${b.deadlineTime || "99:99"}`;
    if (deadlineA !== deadlineB) return deadlineA.localeCompare(deadlineB);
    return (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99);
  });
}
