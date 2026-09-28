// Owner controls for writing a news story on demand. Browsing and searching
// are free; each draft is one metered Claude call on the server.
export const NEWS_EDITOR_PATH = "/api/moderation/news-desk/editor";
export const MAX_NEWS_LINKS = 3;

function actor(accountId) {
  if (typeof accountId !== "string" || !accountId.trim()) throw new TypeError("The news editor requires an administrator account.");
  return accountId.trim();
}
function transport(apiCall) {
  if (typeof apiCall !== "function") throw new TypeError("The news editor transport is unavailable.");
  return apiCall;
}

export function validateNewsEditor(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.candidates) || !payload.budget || !payload.drafts) {
    throw new TypeError("The news editor returned an invalid response. Refresh and try again.");
  }
  return payload;
}

export async function readNewsEditor({ accountId, query = "", signal } = {}, { apiCall } = {}) {
  const expectedAccountId = actor(accountId);
  const text = String(query || "").trim().slice(0, 120);
  return validateNewsEditor(await transport(apiCall)(`${NEWS_EDITOR_PATH}${text ? `?q=${encodeURIComponent(text)}` : ""}`, {
    expectedAccountId, signal, silent: true, context: text ? "Searching news coverage" : "Reading the news editor",
  }));
}

export async function writeNewsDraft({ accountId, reportUrls = [], links = [], signal } = {}, { apiCall } = {}) {
  const expectedAccountId = actor(accountId);
  const payload = await transport(apiCall)(`${NEWS_EDITOR_PATH}/drafts`, {
    method: "POST", body: { reportUrls, links }, expectedAccountId, signal, silent: true, context: "Writing a news draft",
  });
  if (!payload?.draft?.id) throw new TypeError("The draft could not be confirmed. Refresh before trying again.");
  return payload.draft;
}

export async function publishNewsDraft({ accountId, id } = {}, { apiCall } = {}) {
  const expectedAccountId = actor(accountId);
  const payload = await transport(apiCall)(`${NEWS_EDITOR_PATH}/drafts/${encodeURIComponent(id)}/publish`, {
    method: "POST", body: {}, expectedAccountId, silent: true, context: "Publishing a news draft",
  });
  if (payload?.draft?.status !== "published") throw new TypeError("Publishing could not be confirmed. Refresh to check the story.");
  return payload;
}

export async function discardNewsDraft({ accountId, id } = {}, { apiCall } = {}) {
  const expectedAccountId = actor(accountId);
  const payload = await transport(apiCall)(`${NEWS_EDITOR_PATH}/drafts/${encodeURIComponent(id)}/discard`, {
    method: "POST", body: {}, expectedAccountId, silent: true, context: "Discarding a news draft",
  });
  return payload?.draft;
}

// Up to three distinct https links from pasted text.
export function parseNewsLinks(text) {
  return [...new Set(String(text || "").split(/[\s,]+/u).map((item) => item.trim()).filter((item) => /^https:\/\/\S+$/u.test(item)))]
    .slice(0, MAX_NEWS_LINKS);
}

const hoursAgo = (hours) => (hours < 1 ? "under an hour ago" : hours === 1 ? "1 hour ago" : `${hours} hours ago`);
// "NME, Stereogum, Pitchfork · 3 outlets · 5 hours ago"
export function newsCandidateLine(candidate) {
  const names = [...new Set((candidate?.outlets || []).map((outlet) => outlet.name))].join(", ");
  const outlets = candidate?.groups === 1 ? "1 outlet" : `${candidate?.groups || 0} outlets`;
  return `${names} · ${outlets} · ${hoursAgo(Number(candidate?.ageHours) || 0)}`;
}
export function newsCandidateNeed(candidate) {
  if (!candidate || candidate.ready) return "";
  const missing = Math.max(1, (candidate.needed || 2) - (candidate.groups || 0));
  return missing === 1 ? "Needs one more outlet: paste a link below." : `Needs ${missing} more outlets: paste links below.`;
}

export function newsDraftStatus(draft) {
  if (!draft) return "";
  if (draft.status === "published") return "Published";
  if (draft.status === "declined") return `Claude turned it down: ${draft.reason || "not publishable"}`;
  if (draft.expired) return "More than a day old: write a fresh one";
  return "Ready to publish";
}

const money = (value) => `$${Number(value || 0).toFixed(2)}`;
export function newsEditorCostLine(overview) {
  if (!overview?.budget) return "";
  const cents = Math.max(1, Math.round(Number(overview.budget.typicalDraftUsd || 0.02) * 100));
  return `Finding stories is free. A draft is one Claude call, about ${cents} cent${cents === 1 ? "" : "s"}, from the news budget: ${money(overview.budget.leftTodayUsd)} left today. ${overview.drafts?.last24h || 0} of ${overview.drafts?.limit || 0} drafts used in the last 24 hours.`;
}

// Live coverage of a big night: outlet headlines plus the owner's updates.
export const NEWS_LIVE_PATH = "/api/moderation/news-desk/live";
async function liveCall(apiCall, path, { accountId, body = {}, context }) {
  const payload = await transport(apiCall)(path, { method: "POST", body, expectedAccountId: actor(accountId), silent: true, context });
  if (!Array.isArray(payload?.live)) throw new TypeError("Live coverage could not be confirmed. Refresh to check it.");
  return payload.live;
}
export const startNewsLive = ({ accountId, title, keywords, hours } = {}, { apiCall } = {}) =>
  liveCall(apiCall, NEWS_LIVE_PATH, { accountId, body: { title, keywords, hours: Number(hours) }, context: "Starting live coverage" });
export const postNewsLiveUpdate = ({ accountId, id, text, url = "" } = {}, { apiCall } = {}) =>
  liveCall(apiCall, `${NEWS_LIVE_PATH}/${encodeURIComponent(id)}/notes`, { accountId, body: { text, ...(url.trim() ? { url: url.trim() } : {}) }, context: "Posting a live update" });
export const endNewsLive = ({ accountId, id } = {}, { apiCall } = {}) =>
  liveCall(apiCall, `${NEWS_LIVE_PATH}/${encodeURIComponent(id)}/end`, { accountId, context: "Ending live coverage" });
export const removeNewsLiveUpdate = ({ accountId, noteId } = {}, { apiCall } = {}) =>
  liveCall(apiCall, `${NEWS_LIVE_PATH}/notes/${encodeURIComponent(noteId)}/remove`, { accountId, context: "Removing a live update" });

// "Live until 11:30 PM · 14 updates" (local time)
export function newsLiveStatus(event, { formatTime = (at) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) } = {}) {
  if (!event) return "";
  const updates = event.count === 1 ? "1 update" : `${event.count || 0} updates`;
  return event.live ? `Live until ${formatTime(event.endsAt)} · ${updates}` : `Ended · ${updates}`;
}
