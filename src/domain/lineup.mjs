// Lineups on concert reviews: the show's format (a headline show, a
// co-headline show or a festival) and every act on it, each with the person's
// own rating and note for that set. A festival's sets also carry the day and
// stage. The server applies the same rules (server/supportingActs.js).

export const SHOW_FORMATS = Object.freeze(["headline", "co_headline", "festival"]);
export const SHOW_FORMAT_LABELS = Object.freeze({ headline: "Concert", co_headline: "Co-headline", festival: "Festival" });
export const LINEUP_LIMITS = Object.freeze({ acts: 40, openers: 12, coHeadliners: 4, review: 600, stage: 60, festivalDays: 14 });
const ROLES = Object.freeze(["co_headliner", "opener", "festival_set"]);
const ROLES_BY_FORMAT = Object.freeze({ headline: ["opener"], co_headline: ["co_headliner", "opener"], festival: ["festival_set"] });
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const DAY_MS = 86_400_000;
const collapse = (value) => String(value ?? "").replace(/\s+/gu, " ").trim();
const nameKey = (value) => collapse(value).toLowerCase();
const isDate = (value) => typeof value === "string" && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export const cleanShowFormat = (value) => (SHOW_FORMATS.includes(value) ? value : "headline");
export const defaultRoleFor = (showFormat) => (showFormat === "festival" ? "festival_set" : "opener");

export function setRating(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0.5) return null;
  return Math.min(5, Math.round(number * 2) / 2);
}

// The note on one set, cleaned the way the server stores it: spaces collapsed
// on each line, at most one blank line in a row.
export function normalizeSetReview(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n?/gu, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/gu, " ")
    .split("\n").map((line) => line.replace(/\s+/gu, " ").trim()).join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}

// One act as the app holds it. Strings are older name-only entries.
export function lineupAct(value, fallbackRole = "opener") {
  const source = typeof value === "string" ? { name: value } : value;
  const name = collapse(source?.name).slice(0, 120);
  if (!name) return null;
  return {
    name,
    role: ROLES.includes(source.role) ? source.role : fallbackRole,
    rating: setRating(source.rating),
    review: typeof source.review === "string" ? source.review.slice(0, LINEUP_LIMITS.review) : "",
    day: isDate(source.day) ? source.day : null,
    stage: typeof source.stage === "string" && collapse(source.stage) ? collapse(source.stage).slice(0, LINEUP_LIMITS.stage) : null,
    artistKey: typeof source.artistKey === "string" && source.artistKey ? source.artistKey : null,
    artistPublicSlug: typeof source.artistPublicSlug === "string" && /^[a-z0-9-]{1,160}$/u.test(source.artistPublicSlug) ? source.artistPublicSlug : null,
    reviewPostId: typeof source.reviewPostId === "string" && /^p_[A-Za-z0-9_-]{1,80}$/u.test(source.reviewPostId) ? source.reviewPostId : null,
  };
}

// A list of acts: no blanks, no repeats, never the headliner itself.
export function lineupActs(value, { mainArtist = "", showFormat = "headline" } = {}) {
  const main = nameKey(mainArtist);
  const seen = new Set();
  const acts = [];
  for (const item of Array.isArray(value) ? value : []) {
    const act = lineupAct(item, defaultRoleFor(showFormat));
    if (!act) continue;
    const key = act.name.toLowerCase();
    if (key === main || seen.has(key)) continue;
    seen.add(key);
    acts.push(act);
    if (acts.length >= LINEUP_LIMITS.acts) break;
  }
  return acts;
}

// The lineup from a server post, or from an older post's opener names.
export function lineupFromPost(post) {
  const showFormat = cleanShowFormat(post?.showFormat);
  const source = Array.isArray(post?.lineup) && post.lineup.length ? post.lineup : post?.supportingActs;
  return lineupActs(source, { mainArtist: post?.artist, showFormat });
}

// Only roles the format allows; switching keeps every act (the server does the same).
export function adaptLineupToFormat(acts, showFormat) {
  const allowed = ROLES_BY_FORMAT[showFormat] || ROLES_BY_FORMAT.headline;
  let needsHeadliner = showFormat === "co_headline" && !acts.some((act) => act.role === "co_headliner");
  return acts.map((act) => {
    if (needsHeadliner) { needsHeadliner = false; return { ...act, role: "co_headliner", day: null, stage: null }; }
    if (allowed.includes(act.role)) return showFormat === "festival" ? act : { ...act, day: null, stage: null };
    return { ...act, role: allowed[allowed.length - 1], ...(showFormat === "festival" ? {} : { day: null, stage: null }) };
  });
}

// The API's `lineup` list: the person's own fields only.
export function lineupPayload(acts, { showFormat = "headline", mainArtist = "" } = {}) {
  const festival = showFormat === "festival";
  return lineupActs(acts, { mainArtist, showFormat }).map((act) => ({
    name: act.name,
    role: act.role,
    rating: act.rating,
    review: normalizeSetReview(act.review).slice(0, LINEUP_LIMITS.review),
    day: festival ? act.day : null,
    stage: festival ? act.stage : null,
  }));
}

// The fields a create or edit request carries. `supportingActs` repeats the
// names for a server from before lineups (it is ignored when `lineup` is sent).
export function lineupRequestFields(post, { online = false } = {}) {
  if (online) return { showFormat: "headline", endDate: "", lineup: [], supportingActs: [] };
  const showFormat = cleanShowFormat(post?.showFormat);
  const lineup = lineupPayload(post?.lineup ?? post?.supportingActs, { showFormat, mainArtist: post?.artist });
  return {
    showFormat,
    endDate: showFormat === "festival" && isDate(post?.endDate) && post.endDate !== post?.date ? post.endDate : "",
    lineup,
    supportingActs: lineup.map((act) => act.name),
  };
}

export function addLineupActs(acts, typed, { showFormat = "headline", mainArtist = "", role, day = null } = {}) {
  const names = (Array.isArray(typed) ? typed : String(typed ?? "").split(/[,\n]/u)).map(collapse).filter(Boolean);
  const nextRole = role || defaultRoleFor(showFormat);
  return lineupActs([...acts, ...names.map((name) => ({ name, role: nextRole, day: showFormat === "festival" ? day : null }))], { mainArtist, showFormat });
}

export const updateLineupAct = (acts, name, patch) => acts.map((act) => (act.name === name ? lineupAct({ ...act, ...patch }, act.role) : act));
export const removeLineupAct = (acts, name) => acts.filter((act) => act.name !== name);

// Moves an act past the next act with the same role (openers reorder among
// openers, headliners among headliners).
export function moveLineupAct(acts, name, direction) {
  const index = acts.findIndex((act) => act.name === name);
  if (index < 0) return acts;
  const step = direction === "up" ? -1 : 1;
  let target = index + step;
  while (target >= 0 && target < acts.length && acts[target].role !== acts[index].role) target += step;
  if (target < 0 || target >= acts.length) return acts;
  const next = acts.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// Every day of a festival from its first to its last day (at most two weeks).
export function festivalDays(date, endDate) {
  if (!isDate(date)) return [];
  const start = Date.parse(`${date}T00:00:00Z`);
  const end = isDate(endDate) ? Date.parse(`${endDate}T00:00:00Z`) : start;
  const days = [];
  for (let at = start; at <= end && days.length < LINEUP_LIMITS.festivalDays; at += DAY_MS) days.push(new Date(at).toISOString().slice(0, 10));
  return days;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "Fri, Jul 24" for a festival day; "Day 2" style numbering is festivalDayNumber.
export function formatFestivalDay(day) {
  if (!isDate(day)) return "";
  const at = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[at.getUTCDay()]}, ${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}`;
}
export function festivalDayNumber(day, date) {
  if (!isDate(day) || !isDate(date)) return null;
  const number = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS) + 1;
  return number >= 1 ? number : null;
}

// The name a card leads with: the festival, "Chris Brown & Usher", or the headliner.
export function postHeadline(post) {
  const main = collapse(post?.artist);
  if (cleanShowFormat(post?.showFormat) !== "co_headline") return main;
  const names = [main, ...lineupFromPost(post).filter((act) => act.role === "co_headliner").map((act) => act.name)].filter(Boolean);
  if (names.length <= 1) return main;
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

// Acts grouped for display. Festival sets run in day order, then list order.
export function lineupSections(post) {
  const showFormat = cleanShowFormat(post?.showFormat);
  const acts = lineupFromPost(post);
  if (showFormat === "festival") {
    const sets = acts.map((act, index) => ({ act, index }))
      .sort((a, b) => (a.act.day || "9999").localeCompare(b.act.day || "9999") || a.index - b.index)
      .map(({ act }) => act);
    return sets.length ? [{ key: "sets", title: sets.length === 1 ? "Set seen" : `${sets.length} sets seen`, acts: sets }] : [];
  }
  const sections = [];
  const coHeadliners = acts.filter((act) => act.role === "co_headliner");
  const openers = acts.filter((act) => act.role === "opener");
  if (coHeadliners.length) sections.push({ key: "co_headliners", title: coHeadliners.length === 1 ? "Co-headliner" : "Co-headliners", acts: coHeadliners });
  if (openers.length) sections.push({ key: "openers", title: openers.length === 1 ? "Opener" : "Openers", acts: openers });
  return sections;
}

// Short labels for a set's role on another artist's page.
export function setRoleLabel(role) {
  return role === "co_headliner" ? "Co-headlined" : role === "festival_set" ? "Festival set" : "Opened";
}

// The comparable form of a lineup, for checking that an edit landed.
export const lineupComparable = (value) => (Array.isArray(value) ? value : []).map((act) => ({
  name: collapse(act?.name).slice(0, 120),
  role: ROLES.includes(act?.role) ? act.role : "opener",
  rating: setRating(act?.rating),
  review: normalizeSetReview(act?.review),
  day: isDate(act?.day) ? act.day : null,
  stage: typeof act?.stage === "string" && collapse(act.stage) ? collapse(act.stage).slice(0, LINEUP_LIMITS.stage) : null,
}));

export function supportedShowFormats(online) {
  return online ? ["headline"] : SHOW_FORMATS;
}
