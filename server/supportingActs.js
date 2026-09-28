// Openers and "times seen" for concert reviews.
//
// A review can list the other acts the person saw that night: the openers of a
// headline show, or the acts they caught at a festival. Each one counts as an
// artist they have seen live. When they also reviewed one of those acts on the
// same night, the main review links to that review.
//
// "Times seen" is how many times the author has seen an artist live up to a
// given show, counted by show date: their reviews of the artist, the times the
// artist opened a show they reviewed, and a per-artist number of earlier shows
// they never logged (set from the review form). One number per person and
// artist, so every later review keeps counting from it.

export const MAX_SUPPORTING_ACTS = 12;
const MAX_NAME = 120;
export const MAX_TIMES_SEEN = 999;

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

// Stored form: [{ name, artistKey }]. Catalog keys come from an exact match on
// the catalog's normalized name, never a guess.
export function resolveSupportingActs(database, names, { normName }) {
  const byNorm = database.prepare("SELECT norm FROM artists WHERE norm=?");
  return names.map((name) => ({ name, artistKey: byNorm.get(normName(name))?.norm || null }));
}

export function storedSupportingActs(value) {
  let parsed;
  try { parsed = JSON.parse(value || "[]"); }
  catch { return []; } // architecture: allow-ambiguous-result -- a damaged column shows no openers rather than breaking the post
  return (Array.isArray(parsed) ? parsed : [])
    .filter((item) => item && typeof item.name === "string" && collapse(item.name))
    .slice(0, MAX_SUPPORTING_ACTS)
    .map((item) => ({ name: collapse(item.name).slice(0, MAX_NAME), artistKey: typeof item.artistKey === "string" && item.artistKey ? item.artistKey : null }));
}

export const supportingActNames = (value) => storedSupportingActs(value).map((act) => act.name);

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

// Openers as the app shows them: artist page slugs, and a link to the
// author's own review of that act from the same night when there is one.
export function projectSupportingActs(database, post) {
  const acts = storedSupportingActs(post.supporting_acts);
  if (!acts.length) return [];
  const slug = database.prepare("SELECT public_slug FROM artists WHERE norm=?");
  const review = database.prepare(`SELECT id FROM posts WHERE user_id=? AND id<>? AND removed=0 AND COALESCE(kind,'review')='review'
    AND date=? AND date<>'' AND ${artistMatch("artist_key", "?", "artist", "?")}
    ORDER BY created_at LIMIT 1`);
  return acts.map((act) => ({
    name: act.name,
    artistKey: act.artistKey,
    artistPublicSlug: act.artistKey ? slug.get(act.artistKey)?.public_slug || null : null,
    reviewPostId: review.get(post.user_id, post.id, post.date || "", act.artistKey, act.artistKey, act.name)?.id || null,
  }));
}
