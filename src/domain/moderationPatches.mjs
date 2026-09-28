// The two moderation helpers the app store needs at startup. The rest of the
// moderation console (moderationConsole.mjs) loads only with the staff screens.

const safeText = (value) => (typeof value === "string" ? value.trim() : "");
const ACCOUNT_ROLES = new Set(["fan", "artist", "moderator", "admin"]);

// A successful request is not necessarily an applied mutation: privileged
// transitions return `pending: true` until the Founder acts. Only the exact
// role and handle echoed by an applied server response may update local state.
export function confirmedRoleMutationPatch(result) {
  if (!result || result.ok === false || result.pending === true) return null;
  const role = safeText(result.role).toLowerCase();
  const handle = safeText(result.handle).replace(/^@+/, "");
  return ACCOUNT_ROLES.has(role) && handle ? { role, handle } : null;
}

export function patchModerationMemberContext(consoleState, memberId, patch) {
  if (!consoleState || !memberId || !patch || typeof patch !== "object") return consoleState;
  const patchPerson = (person) => person?.id === memberId ? { ...person, ...patch } : person;
  const patchReport = (report) => {
    if (!report || typeof report !== "object") return report;
    const content = report.content && typeof report.content === "object" ? report.content : null;
    const nextContent = content ? {
      ...content,
      ...(content.author ? { author: patchPerson(content.author) } : {}),
      ...(content.user ? { user: patchPerson(content.user) } : {}),
    } : content;
    return {
      ...report,
      ...(report.reporter ? { reporter: patchPerson(report.reporter) } : {}),
      ...(nextContent ? { content: nextContent } : {}),
    };
  };
  return {
    ...consoleState,
    reports: Array.isArray(consoleState.reports) ? consoleState.reports.map(patchReport) : consoleState.reports,
    recentActions: Array.isArray(consoleState.recentActions)
      ? consoleState.recentActions.map((action) => ({ ...action, actor: patchPerson(action.actor) }))
      : consoleState.recentActions,
  };
}
