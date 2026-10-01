// Owner controls for writing a news story on demand. Browsing and searching
// are free; each draft is one metered Claude call on the server.
export const NEWS_EDITOR_PATH = "/api/moderation/news-desk/editor";
export const MAX_NEWS_LINKS = 3;
export const NEWS_SELF_WRITTEN_PATH = `${NEWS_EDITOR_PATH}/drafts/self-written`;

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

// Which photo a story's share card uses: "auto", "artist" (with its key) or "none".
export async function setNewsStoryPhoto({ accountId, postId, choice, artistKey = null } = {}, { apiCall } = {}) {
  const expectedAccountId = actor(accountId);
  const payload = await transport(apiCall)(`${NEWS_EDITOR_PATH}/stories/${encodeURIComponent(String(postId || ""))}/photo`, {
    method: "PUT", body: { choice, artistKey }, expectedAccountId, silent: true, context: "Choosing a news card photo",
  });
  if (!payload?.photo || typeof payload.photo.choice !== "string") throw new TypeError("The photo choice was not confirmed. Refresh and try again.");
  return payload.photo;
}

export async function writeNewsDraft({ accountId, reportUrls = [], links = [], signal } = {}, { apiCall } = {}) {
  const expectedAccountId = actor(accountId);
  const payload = await transport(apiCall)(`${NEWS_EDITOR_PATH}/drafts`, {
    method: "POST", body: { reportUrls, links }, expectedAccountId, signal, silent: true, context: "Writing a news draft",
  });
  if (!payload?.draft?.id) throw new TypeError("The draft could not be confirmed. Refresh before trying again.");
  return payload.draft;
}

export async function writeSelfWrittenNewsDraft({ accountId, headline, summary, body, category = "other", sources = [], photo, idempotencyKey, signal } = {}, { apiCall } = {}) {
  const expectedAccountId = actor(accountId);
  const payload = await transport(apiCall)(NEWS_SELF_WRITTEN_PATH, {
    method: "POST", body: { headline, summary, body, category, sources, photo, idempotencyKey }, expectedAccountId, signal, silent: true,
    context: "Saving a self-written news draft",
  });
  if (!payload?.draft?.id || payload.draft.origin !== "self_written") throw new TypeError("The self-written draft could not be confirmed. Refresh before trying again.");
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
  if (draft.origin === "self_written" && draft.status === "draft") return "Self-written draft";
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
// `startsAt` (epoch ms) schedules a future show; left out, it starts now.
export const startNewsLive = ({ accountId, title, keywords, hours, startsAt = null } = {}, { apiCall } = {}) =>
  liveCall(apiCall, NEWS_LIVE_PATH, { accountId, body: { title, keywords, hours: Number(hours), ...(startsAt ? { startsAt } : {}) },
    context: startsAt ? "Scheduling live coverage" : "Starting live coverage" });
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

// Award show winners: paste categories once, then mark winners as they land.
export const setNewsLiveCategories = ({ accountId, id, text } = {}, { apiCall } = {}) =>
  liveCall(apiCall, `${NEWS_LIVE_PATH}/${encodeURIComponent(id)}/categories`, { accountId, body: { text }, context: "Saving award categories" });
export const markNewsLiveWinner = ({ accountId, id, categoryId, nominee } = {}, { apiCall } = {}) =>
  liveCall(apiCall, `${NEWS_LIVE_PATH}/${encodeURIComponent(id)}/categories/${encodeURIComponent(categoryId)}/winner`,
    { accountId, body: { nominee: nominee ?? null }, context: nominee ? "Marking an award winner" : "Clearing an award winner" });

// The categories back as pasteable text, for editing.
export const categoriesText = (event) => (event?.winners?.categories || [])
  .map((category) => `${category.name}: ${category.nominees.join("; ")}`).join("\n");

// "2027-02-01 20:00" in the person's own time zone, or null for "now".
export function parseStartTime(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/u.exec(text);
  if (!match) return Number.NaN;
  const [, year, month, day, hour, minute] = match.map(Number);
  const at = new Date(year, month - 1, day, hour, minute).getTime();
  return Number.isFinite(at) ? at : Number.NaN;
}

export const livePageUrl = (slug, origin = "https://www.mshpit.com") => `${origin}/news/live/${slug}`;
