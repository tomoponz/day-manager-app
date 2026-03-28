export const $ = (id) => document.getElementById(id);

export function getFormValue(formId, fieldName) {
  return $(formId)?.elements?.[fieldName]?.value ?? '';
}

export function debounce(callback, wait = 300) {
  let timerId = null;
  return (...args) => {
    if (timerId !== null) {
      window.clearTimeout(timerId);
    }
    timerId = window.setTimeout(() => {
      timerId = null;
      callback(...args);
    }, wait);
  };
}
