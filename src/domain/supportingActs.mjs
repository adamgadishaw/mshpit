// Openers (or the other acts seen at a festival) on a concert review, and the
// "times seen" number (server/supportingActs.js holds the counting rules).

export const MAX_SUPPORTING_ACTS = 12;
export const MAX_TIMES_SEEN = 999;
const collapse = (value) => String(value ?? "").replace(/\s+/gu, " ").trim();

// Names from anything the app or server holds: strings or { name } objects.
export function supportingActNames(value, { mainArtist = "" } = {}) {
  const main = collapse(mainArtist).toLowerCase();
  const seen = new Set();
  const names = [];
  for (const item of Array.isArray(value) ? value : []) {
    const name = collapse(typeof item === "string" ? item : item?.name).slice(0, 120);
    const key = name.toLowerCase();
    if (!name || key === main || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= MAX_SUPPORTING_ACTS) break;
  }
  return names;
}

// Typed text can hold several names: "Muna, Phoebe Bridgers".
export function addSupportingActs(current, typed, { mainArtist = "" } = {}) {
  const extra = String(typed ?? "").split(/[,\n]/u);
  return supportingActNames([...supportingActNames(current), ...extra], { mainArtist });
}

// The server's projection: [{ name, artistKey, artistPublicSlug, reviewPostId }].
export function supportingActsForDisplay(value) {
  return (Array.isArray(value) ? value : []).filter((act) => act && typeof act.name === "string" && collapse(act.name)).map((act) => ({
    name: collapse(act.name).slice(0, 120),
    artistPublicSlug: typeof act.artistPublicSlug === "string" && /^[a-z0-9-]{1,160}$/u.test(act.artistPublicSlug) ? act.artistPublicSlug : null,
    reviewPostId: typeof act.reviewPostId === "string" && /^p_[A-Za-z0-9_-]{1,80}$/u.test(act.reviewPostId) ? act.reviewPostId : null,
  }));
}

// A festival lists the acts you saw; a headline show lists who opened.
export const supportingActsHeading = ({ festival = false } = {}) => (festival ? "Also saw" : "Openers");

export function ordinalWord(value) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number) || number < 1) return "";
  const lastTwo = number % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[number % 10] || "th");
  return `${number}${suffix}`;
}

// "Your 3rd time seeing Radiohead", counting this show.
export function timesSeenSentence(count, artist) {
  const ordinal = ordinalWord(count);
  if (!ordinal || !collapse(artist)) return "";
  return count === 1 ? `Your first time seeing ${collapse(artist)}` : `Your ${ordinal} time seeing ${collapse(artist)}`;
}

// A whole number from 1 to 999 typed by the person, or null.
export function parseTimesSeen(value) {
  const number = Number(String(value ?? "").trim());
  return Number.isSafeInteger(number) && number >= 1 && number <= MAX_TIMES_SEEN ? number : null;
}
