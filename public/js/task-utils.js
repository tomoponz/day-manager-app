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
