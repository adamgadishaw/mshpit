// Platform-neutral input normalization shared by the client UX and the server
// trust boundary. Keeping the character policy and field limits here prevents
// a client preview/reconciliation path from describing a different payload than
// the API will accept.

export const LIMITS = Object.freeze({
  name: 40,
  bio: 240,
  message: 1000,
  review: 2000,
  note: 500,
  search: 80,
  artist: 80,
  playlist: 60,
  venue: 80,
  city: 60,
  date: 20,
});

export function clean(value, { max = 500, newlines = false } = {}) {
  if (typeof value !== "string") return "";
  let out = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    // Strip C0/C1 controls, retaining only newline/tab in long-form text.
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      if (newlines && (codePoint === 0x0a || codePoint === 0x09)) out += character;
      continue;
    }
    // Zero-width and bidi-control characters can spoof visible text identity.
    if ((codePoint >= 0x200b && codePoint <= 0x200f)
      || (codePoint >= 0x202a && codePoint <= 0x202e)
      || (codePoint >= 0x2066 && codePoint <= 0x2069)
      || codePoint === 0xfeff) continue;
    out += character;
  }
  if (newlines) {
    out = out.replace(/\r\n?/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n");
  } else {
    out = out.replace(/\s+/g, " ");
  }
  return out.trim().slice(0, max);
}

export const cleanEmail = (value) => clean(value, { max: 120 }).toLowerCase();
export const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail(value));

export const cleanName = (value) => clean(value, { max: LIMITS.name });
export const isName = (value) => {
  const name = cleanName(value);
  return name.length >= 1
    && /\p{L}|\p{N}/u.test(name)
    && /^[\p{L}\p{N} .,'’&!\-]+$/u.test(name);
};

export const cleanHandle = (value) => clean(value, { max: 20 }).toLowerCase().replace(/[^a-z0-9_]/g, "");
export const isHandle = (value) => /^[a-z0-9_]{3,20}$/.test(cleanHandle(value));

export const isPassword = (value) => typeof value === "string"
  && value.length >= 8
  && value.length <= 100
  && /[a-zA-Z]/.test(value)
  && /[0-9]/.test(value);

export function clampRating(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(5, Math.round(number * 2) / 2));
}
