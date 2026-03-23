export const $ = (id) => document.getElementById(id);

export function getFormValue(formId, fieldName) {
  return $(formId)?.elements?.[fieldName]?.value || "";
}
