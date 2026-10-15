// Lineups and "times seen" for concert reviews.
//
// A review has a show format: a headline show (one headliner plus openers), a
// co-headline show (two or more headliners, plus openers), or a festival (the
// post's artist is the festival's name and every act is a set the person saw).
// The lineup is stored on the post as JSON, one object per act:
//   { name, artistKey, role, rating, review, day, stage }
// role is co_headliner, opener or festival_set; rating (half stars) and review
// are the person's take on that one set; day and stage are festival-only.
// Entries written before roles existed ({ name, artistKey }) read as unrated
// openers. Database triggers copy each act into post_lineup_acts so an artist
// page can find every set it played without scanning every post.
//
// Each act counts as an artist the person has seen live. When they also
// reviewed one of those acts on the same night, the lineup links to it.
//
// "Times seen" is how many times the author has seen an artist live up to a
// given show, counted by show date: their reviews of the artist, the times the
// artist opened a show they reviewed, and a per-artist number of earlier shows
// they never logged (set from the review form). One number per person and
// artist, so every later review keeps counting from it.

export const MAX_SUPPORTING_ACTS = 12;
const MAX_NAME = 120;
export const MAX_TIMES_SEEN = 999;
export const SHOW_FORMATS = Object.freeze(["headline", "co_headline", "festival"]);
export const LINEUP_ROLES = Object.freeze(["co_headliner", "opener", "festival_set"]);
export const LINEUP_LIMITS = Object.freeze({ acts: 40, openers: MAX_SUPPORTING_ACTS, coHeadliners: 4, review: 600, stage: 60, festivalDays: 14 });
const ROLES_BY_FORMAT = Object.freeze({
  headline: ["opener"],
  co_headline: ["co_headliner", "opener"],
  festival: ["festival_set"],
});
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

const collapse = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
const nameKey = (value) => collapse(value).toLowerCase();

// Names from a request. `null`/`undefined` means "not sent"; anything else
// must be an array of strings. Duplicates and the headliner are dropped.
export function cleanSupportingActNames(value, { mainArtist = "" } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  const main = nameKey(mainArtist);
  const seen = new Set();
  const names = [];
  for (const raw of value) {
    const name = collapse(raw).slice(0, MAX_NAME);
    const key = name.toLowerCase();
    if (!name || key === main || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= MAX_SUPPORTING_ACTS) break;
  }
  return names;
}

// A whole number from 1 to 999, `null` to clear, `undefined` when not sent;
// `false` marks an invalid value.
export function cleanTimesSeen(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return false;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 && number <= MAX_TIMES_SEEN ? number : false;
}

// "headline" when not sent; `false` for an unknown format.
export function cleanShowFormat(value) {
  if (value === undefined || value === null || value === "") return "headline";
  return SHOW_FORMATS.includes(value) ? value : false;
}

// A festival's last day: "" when not sent or not a festival; `false` when it is
// not a date on or after the first day, within two weeks.
export function cleanEndDate(value, { showFormat, date }) {
  if (value === undefined || value === null || value === "" || showFormat !== "festival") return "";
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return false;
  if (!date) return false;
  const span = (Date.parse(`${value}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000;
  if (span < 0 || span >= LINEUP_LIMITS.festivalDays) return false;
  return span === 0 ? "" : value;
}

function setRating(value) {
  if (value === undefined || value === null || value === "" || value === 0) return null;
  const number = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(number) || number < 0.5 || number > 5) return false;
  return Math.round(number * 2) / 2;
}

function setReview(value) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return false;
  const text = value.replace(/\r\n?/gu, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/gu, " ")
    .split("\n").map((line) => line.replace(/\s+/gu, " ").trim()).join("\n").replace(/\n{3,}/gu, "\n\n").trim();
  return [...text].length > LINEUP_LIMITS.review ? false : text;
}

// The lineup from a request. Returns { acts } or { error } with a message for
// the person. `value` is the new `lineup` list; `legacyNames` is the older
// `supportingActs` list of names, used only when `lineup` is absent.
export function cleanLineup(value, { legacyNames, mainArtist = "", showFormat = "headline", date = "", endDate = "" } = {}) {
  const allowed = ROLES_BY_FORMAT[showFormat] || ROLES_BY_FORMAT.headline;
  let source = value;
  if (source === undefined || source === null) {
    const names = cleanSupportingActNames(legacyNames, { mainArtist });
    if (names === null) return { error: "Openers must be a list of artist names." };
    source = names.map((name) => ({ name }));
  }
  if (!Array.isArray(source) || source.length > LINEUP_LIMITS.acts * 2) return { error: "The lineup must be a list of acts." };
  const main = nameKey(mainArtist);
  const seen = new Set();
  const acts = [];
  const counts = { co_headliner: 0, opener: 0, festival_set: 0 };
  const lastDay = endDate || date;
  for (const item of source) {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.name !== "string") {
      return { error: "Each act in the lineup needs a name." };
    }
    const name = collapse(item.name).slice(0, MAX_NAME);
    const key = name.toLowerCase();
    if (!name || key === main || seen.has(key)) continue;
    const role = item.role === undefined || item.role === null ? allowed[allowed.length - 1] : item.role;
    if (!allowed.includes(role)) {
      return { error: showFormat === "festival" ? "Every act at a festival is a set you saw." : "An act can be a co-headliner or an opener." };
    }
    const rating = setRating(item.rating);
    if (rating === false) return { error: `Rate ${name}'s set from half a star to 5 stars.` };
    const review = setReview(item.review);
    if (review === false) return { error: `Keep what you say about ${name}'s set under ${LINEUP_LIMITS.review} characters.` };
    let day = null;
    let stage = null;
    if (showFormat === "festival") {
      if (item.day !== undefined && item.day !== null && item.day !== "") {
        if (typeof item.day !== "string" || !DATE.test(item.day) || (date && (item.day < date || item.day > lastDay))) {
          return { error: `Pick a festival day for ${name} between the first and last day.` };
        }
        day = item.day;
      }
      if (item.stage !== undefined && item.stage !== null && item.stage !== "") {
        if (typeof item.stage !== "string") return { error: `The stage for ${name} must be text.` };
        stage = collapse(item.stage).slice(0, LINEUP_LIMITS.stage) || null;
      }
    }
    counts[role] += 1;
    if (counts.co_headliner > LINEUP_LIMITS.coHeadliners) return { error: `A show can list up to ${LINEUP_LIMITS.coHeadliners + 1} headliners.` };
    if (counts.opener > LINEUP_LIMITS.openers) return { error: `A show can list up to ${LINEUP_LIMITS.openers} openers.` };
    seen.add(key);
    acts.push({ name, role, rating, review, day, stage });
    if (acts.length >= LINEUP_LIMITS.acts) break;
  }
  if (showFormat === "co_headline" && !counts.co_headliner) return { error: "Add the other headliner, or switch to a regular concert." };
  return { acts };
}

// Switching a saved review's format keeps its acts: every act at a festival
// is a set; openers stay openers elsewhere, and a festival's sets become
// openers (or the co-headliner, for the first one, on a co-headline show).
export function adaptLineupToFormat(acts, showFormat) {
  const allowed = ROLES_BY_FORMAT[showFormat] || ROLES_BY_FORMAT.headline;
  let needsHeadliner = showFormat === "co_headline" && !acts.some((act) => act.role === "co_headliner");
  return acts.map((act) => {
    if (needsHeadliner) { needsHeadliner = false; return { ...act, role: "co_headliner", day: null, stage: null }; }
    if (allowed.includes(act.role)) return showFormat === "festival" ? act : { ...act, day: null, stage: null };
    return { ...act, role: allowed[allowed.length - 1], ...(showFormat === "festival" ? {} : { day: null, stage: null }) };
  });
}

export const storedShowFormat = (row) => (SHOW_FORMATS.includes(row?.show_format) ? row.show_format : "headline");

// Stored form adds artistKey: the catalog key from an exact match on the
// catalog's normalized name, never a guess.
export function resolveLineup(database, acts, { normName }) {
  const byNorm = database.prepare("SELECT norm FROM artists WHERE norm=?");
  return acts.map((act) => ({ name: act.name, artistKey: byNorm.get(normName(act.name))?.norm || null,
    role: act.role, rating: act.rating ?? null, review: act.review || "", day: act.day ?? null, stage: act.stage ?? null }));
}

// A request that only lists opener names (older clients) keeps the ratings and
// notes already saved for those same acts instead of wiping them.
export function mergeLegacyLineup(nextActs, storedActs) {
  const previous = new Map(storedActs.map((act) => [nameKey(act.name), act]));
  return nextActs.map((act) => {
    const kept = previous.get(nameKey(act.name));
    return kept && kept.role === act.role ? { ...act, rating: kept.rating, review: kept.review, day: kept.day, stage: kept.stage } : act;
  });
}

function storedAct(item) {
  if (!item || typeof item.name !== "string" || !collapse(item.name)) return null;
  const rating = setRating(item.rating);
  const review = setReview(item.review);
  return {
    name: collapse(item.name).slice(0, MAX_NAME),
    artistKey: typeof item.artistKey === "string" && item.artistKey ? item.artistKey : null,
    role: LINEUP_ROLES.includes(item.role) ? item.role : "opener",
    rating: rating === false ? null : rating,
    review: review === false ? "" : review,
    day: typeof item.day === "string" && DATE.test(item.day) ? item.day : null,
    stage: typeof item.stage === "string" && collapse(item.stage) ? collapse(item.stage).slice(0, LINEUP_LIMITS.stage) : null,
  };
}

function parsedLineup(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; } // architecture: allow-ambiguous-result -- a damaged column shows no lineup rather than breaking the post
}

// Every act as saved, with the defaults older rows lack.
export const storedLineup = (value) => parsedLineup(value).map(storedAct).filter(Boolean).slice(0, LINEUP_LIMITS.acts);

// One act by its position in the saved list (post_lineup_acts.position).
export const storedLineupAct = (value, position) => storedAct(parsedLineup(value)[position]);

export const storedSupportingActs = (value) => storedLineup(value).map(({ name, artistKey }) => ({ name, artistKey }));
export const supportingActNames = (value) => storedLineup(value).map((act) => act.name);

// The part of a post's retry fingerprint that describes its lineup. A plain
// list of unrated openers keeps the older `supportingActs` shape so hashes made
// before lineups existed still match.
export function canonicalLineupFields({ showFormat = "headline", endDate = "", acts = [] }) {
  const legacy = showFormat === "headline"
    && acts.every((act) => act.role === "opener" && act.rating == null && !act.review && !act.day && !act.stage);
  return {
    ...(legacy
      ? (acts.length ? { supportingActs: acts.map((act) => act.name) } : {})
      : { lineup: acts.map(({ name, role, rating, review, day, stage }) => ({ name, role, rating: rating ?? null, review: review || "", day: day ?? null, stage: stage ?? null })) }),
    ...(showFormat !== "headline" ? { showFormat } : {}),
    ...(endDate ? { endDate } : {}),
  };
}

const lineupActRefSql = (value) => `CASE WHEN COALESCE(json_extract(${value},'$.artistKey'),'')<>''
  THEN json_extract(${value},'$.artistKey') ELSE 'name:' || lower(trim(json_extract(${value},'$.name'))) END`;
const lineupInsertSql = (row) => `INSERT OR REPLACE INTO post_lineup_acts (post_id,position,artist_ref,name,role,rating)
  SELECT ${row}.id, CAST(act.key AS INTEGER), ${lineupActRefSql("act.value")}, trim(json_extract(act.value,'$.name')),
    CASE WHEN json_extract(act.value,'$.role') IN ('co_headliner','opener','festival_set') THEN json_extract(act.value,'$.role') ELSE 'opener' END,
    CASE WHEN typeof(json_extract(act.value,'$.rating')) IN ('integer','real') THEN json_extract(act.value,'$.rating') ELSE NULL END
  FROM json_each(CASE WHEN json_valid(${row}.supporting_acts) AND json_type(${row}.supporting_acts)='array' THEN ${row}.supporting_acts ELSE '[]' END) act
  WHERE act.type='object' AND trim(COALESCE(json_extract(act.value,'$.name'),''))<>''`;

// The per-act index behind artist pages. Triggers keep it in step with the
// post's JSON on every write path; the first start fills it from old posts.
export function ensureLineupSchema(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS post_lineup_acts (
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    artist_ref TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('co_headliner','opener','festival_set')),
    rating REAL,
    PRIMARY KEY (post_id, position)
  );
  CREATE INDEX IF NOT EXISTS idx_post_lineup_acts_artist ON post_lineup_acts(artist_ref, post_id);
  CREATE TRIGGER IF NOT EXISTS trg_post_lineup_insert AFTER INSERT ON posts BEGIN
    ${lineupInsertSql("NEW")};
  END;
  CREATE TRIGGER IF NOT EXISTS trg_post_lineup_update AFTER UPDATE OF supporting_acts ON posts BEGIN
    DELETE FROM post_lineup_acts WHERE post_id=NEW.id;
    ${lineupInsertSql("NEW")};
  END;`);
  const marker = "schema:post-lineup-acts:v1";
  if (database.prepare("SELECT 1 FROM app_meta WHERE key=?").get(marker)) return;
  database.exec("BEGIN IMMEDIATE");
  try {
    if (!database.prepare("SELECT 1 FROM app_meta WHERE key=?").get(marker)) {
      database.exec("DELETE FROM post_lineup_acts");
      database.exec(lineupInsertSql("posts").replace("FROM json_each(", "FROM posts, json_each("));
      database.prepare("INSERT OR IGNORE INTO app_meta (key,value) VALUES (?,?)").run(marker, String(Date.now()));
    }
    database.exec("COMMIT");
  } catch (error) {
    try { database.exec("ROLLBACK"); }
    catch { /* architecture: allow-empty-catch -- keep the original migration failure if rollback also fails */ }
    throw error;
  }
}

// The per-person artist identity for the "seen before logging" number: the
// catalog key when there is one, otherwise the lowercased name.
export const seenArtistKey = (artist, artistKey) => (artistKey ? artistKey : `name:${nameKey(artist)}`);

export function ensureSeenBaselineSchema(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS artist_seen_baselines (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    artist_ref TEXT NOT NULL,
    count INTEGER NOT NULL CHECK (count BETWEEN 0 AND ${MAX_TIMES_SEEN}),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, artist_ref)
  );`);
}

// Is post `s` at or before post `p`? Show date first; a review without a date
// falls back to when it was posted.
const atOrBefore = (s, p) => `(
  (${s}.date<>'' AND ${p}.date<>'' AND (${s}.date<${p}.date OR (${s}.date=${p}.date AND (${s}.created_at<${p}.created_at
    OR (${s}.created_at=${p}.created_at AND ${s}.id<=${p}.id)))))
  OR ((${s}.date='' OR ${p}.date='') AND (${s}.created_at<${p}.created_at OR (${s}.created_at=${p}.created_at AND ${s}.id<=${p}.id))))`;

// An opener sighting counts only from an earlier night: the same date is the
// same show, already counted by the review of that act if there is one.
const earlierNight = (o, p) => `(
  (${o}.date<>'' AND ${p}.date<>'' AND ${o}.date<${p}.date)
  OR ((${o}.date='' OR ${p}.date='') AND (${o}.created_at<${p}.created_at OR (${o}.created_at=${p}.created_at AND ${o}.id<${p}.id))))`;

// Known catalog identities outrank display text. Two different acts can share
// a name; only an unbound side may use the legacy name fallback.
const artistMatch = (leftKey, rightKey, leftName, rightName) => `(CASE
  WHEN NULLIF(${leftKey},'') IS NOT NULL AND NULLIF(${rightKey},'') IS NOT NULL
  THEN ${leftKey}=${rightKey} ELSE LOWER(TRIM(${leftName}))=LOWER(TRIM(${rightName})) END)`;
const sameArtist = (s, p) => artistMatch(`${s}.artist_key`, `${p}.artist_key`, `${s}.artist`, `${p}.artist`);
const inPersonReview = (s) => `${s}.removed=0 AND COALESCE(${s}.kind,'review')='review' AND COALESCE(${s}.experience_type,'in_person')='in_person'`;

// The "Nth time seeing them" number for post `p`, as an SQL expression: the
// author's reviews of the artist up to this one, the times the artist opened
// an earlier show they reviewed, and their "seen before logging" number.
export function seenOrdinalSql(p = "p") {
  return `(CASE WHEN COALESCE(${p}.kind,'review')='review' AND COALESCE(${p}.experience_type,'in_person')='in_person' THEN
    (SELECT COUNT(*) FROM posts s WHERE s.user_id=${p}.user_id AND ${inPersonReview("s")} AND ${sameArtist("s", p)} AND ${atOrBefore("s", p)})
    + (SELECT COUNT(DISTINCT CASE WHEN o.date<>'' THEN 'date:' || o.date ELSE 'post:' || o.id END)
        FROM posts o, json_each(CASE WHEN json_valid(o.supporting_acts) THEN o.supporting_acts ELSE '[]' END) act
        WHERE o.user_id=${p}.user_id AND o.id<>${p}.id AND ${inPersonReview("o")} AND ${earlierNight("o", p)}
          AND ${artistMatch("json_extract(act.value,'$.artistKey')", `${p}.artist_key`, "json_extract(act.value,'$.name')", `${p}.artist`)}
          -- Seen open for someone and reviewed the same night is one sighting.
          AND NOT EXISTS (SELECT 1 FROM posts r WHERE r.user_id=o.user_id AND ${inPersonReview("r")} AND r.date<>'' AND r.date=o.date
            AND ${sameArtist("r", p)}))
    + COALESCE((SELECT b.count FROM artist_seen_baselines b WHERE b.user_id=${p}.user_id
        AND b.artist_ref=CASE WHEN ${p}.artist_key IS NOT NULL AND ${p}.artist_key<>'' THEN ${p}.artist_key ELSE 'name:' || LOWER(TRIM(${p}.artist)) END), 0)
    ELSE NULL END)`;
}

// Times seen up to and including one post (the number the review shows).
export function seenOrdinalForPost(database, postId) {
  return Number(database.prepare(`SELECT ${seenOrdinalSql("p")} AS n FROM posts p WHERE p.id=?`).get(postId)?.n) || 0;
}

// The review form's starting number for a show not saved yet: everything
// before that date, plus this show.
export function seenCountForNewShow(database, { userId, artist, artistKey = null, date = "" }) {
  const row = database.prepare(`SELECT ${seenOrdinalSql("p")} AS n FROM (SELECT '__new__' AS id, ? AS user_id, ? AS artist, ? AS artist_key,
      ? AS date, 9007199254740991 AS created_at, 'review' AS kind, 'in_person' AS experience_type) p`)
    .get(userId, collapse(artist), artistKey || null, date || "");
  return (Number(row?.n) || 0) + 1;
}

// The person says a saved review was their Nth time: keep the number of
// unlogged earlier shows that makes it so. Runs inside the write transaction.
export function applyTimesSeen(database, { userId, postId, artist, artistKey, timesSeen, at }) {
  const ref = seenArtistKey(artist, artistKey);
  database.prepare("DELETE FROM artist_seen_baselines WHERE user_id=? AND artist_ref=?").run(userId, ref);
  const counted = seenOrdinalForPost(database, postId);
  const baseline = Math.max(0, Math.min(MAX_TIMES_SEEN, timesSeen - counted));
  if (baseline > 0) {
    database.prepare("INSERT INTO artist_seen_baselines (user_id,artist_ref,count,updated_at) VALUES (?,?,?,?)").run(userId, ref, baseline, at);
  }
  return counted + baseline;
}

// The lineup as the app shows it: artist page slugs, and a link to the
// author's own full review of that act from the same night (or festival day)
// when there is one.
export function projectLineup(database, post) {
  const acts = storedLineup(post.supporting_acts);
  if (!acts.length) return [];
  const slug = database.prepare("SELECT public_slug FROM artists WHERE norm=?");
  const review = database.prepare(`SELECT id FROM posts WHERE user_id=? AND id<>? AND removed=0 AND COALESCE(kind,'review')='review'
    AND date=? AND date<>'' AND ${artistMatch("artist_key", "?", "artist", "?")}
    ORDER BY created_at LIMIT 1`);
  return acts.map((act) => ({
    ...act,
    artistPublicSlug: act.artistKey ? slug.get(act.artistKey)?.public_slug || null : null,
    reviewPostId: review.get(post.user_id, post.id, act.day || post.date || "", act.artistKey, act.artistKey, act.name)?.id || null,
  }));
}

// The older projection, kept for app versions that predate lineups.
export const projectSupportingActs = (database, post) => projectLineup(database, post)
  .map(({ name, artistKey, artistPublicSlug, reviewPostId }) => ({ name, artistKey, artistPublicSlug, reviewPostId }));
