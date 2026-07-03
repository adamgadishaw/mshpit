// Server-side input guarding — the authoritative twin of src/lib/validate.js.
// The client copy is UX; THIS is the trust boundary. Every route cleans and
// validates through these before anything touches the database.

export function clean(s, { max = 500, newlines = false } = {}) {
  if (typeof s !== "string") return "";
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0);
    // strip C0/C1 control chars (keep \n when newlines allowed)
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) {
      if (newlines && (c === 0x0a || c === 0x09)) out += ch;
      continue;
    }
    // zero-width + bidi-override + BOM (text spoofing)
    if ((c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff) continue;
    out += ch;
  }
  if (newlines) {
    out = out.replace(/\r\n?/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n");
  } else {
    out = out.replace(/\s+/g, " ");
  }
  return out.trim().slice(0, max);
}

export const LIMITS = { name: 40, bio: 240, message: 1000, review: 2000, note: 500, artist: 80, venue: 80, city: 60, date: 20 };

export const cleanEmail = (s) => clean(s, { max: 120 }).toLowerCase();
export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail(s));

export const cleanName = (s) => clean(s, { max: LIMITS.name });
export const isName = (s) => {
  const n = cleanName(s);
  return n.length >= 1 && /\p{L}|\p{N}/u.test(n) && /^[\p{L}\p{N} .,'’&!\-]+$/u.test(n);
};

export const cleanHandle = (s) => clean(s, { max: 20 }).toLowerCase().replace(/[^a-z0-9_]/g, "");
export const isHandle = (s) => /^[a-z0-9_]{3,20}$/.test(cleanHandle(s));

export const isPassword = (s) =>
  typeof s === "string" && s.length >= 8 && s.length <= 100 && /[a-zA-Z]/.test(s) && /[0-9]/.test(s);

export const clampRating = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(5, Math.round(v * 2) / 2));
};

// Bounded string array (photos, setlist, genres…): every item cleaned + capped.
export function cleanStringArray(v, { maxItems = 20, maxLen = 300 } = {}) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string").map((x) => clean(x, { max: maxLen })).filter(Boolean).slice(0, maxItems);
}

// Route-level schema check: { field: (value) => cleanedValue | undefined }.
// Returns [errors, cleaned]. Unknown fields are DROPPED (never passed through).
export function shape(body, spec) {
  const errors = [];
  const out = {};
  for (const [key, rule] of Object.entries(spec)) {
    const { required = false, parse } = rule;
    const raw = body?.[key];
    if (raw === undefined || raw === null || raw === "") {
      if (required) errors.push(`${key} is required`);
      continue;
    }
    const val = parse(raw);
    if (val === undefined) errors.push(`${key} is invalid`);
    else out[key] = val;
  }
  return [errors, out];
}
