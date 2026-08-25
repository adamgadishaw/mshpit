// Two independently fetched server projections must agree that a template is
// editable. Missing or stale flags fail closed so security/account email cannot
// briefly become writable while the overview and detail requests disagree.
export function emailTemplateEditable(summary, detail) {
  if (!summary || !detail) return false;
  return summary.key === detail.key && summary.editable === true && detail.editable === true;
}
