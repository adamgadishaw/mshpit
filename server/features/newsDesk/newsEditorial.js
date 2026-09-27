// The news desk's editorial policy, set by the owner on 2026-09-26: big music
// news only (to save money and for how the site is seen), the more outlets the
// better, and among those, what people are most engaged with.
//
// A story needs at least three independent outlets. Candidates are ranked by
// coverage, internet buzz (how many people are reading the artist's Wikipedia
// article compared with a normal day), the artist's size and how much Mshpit
// members follow, review and play them.
//
// The day's stories are spread over five publishing slots in Toronto time
// (8am, 11am, 2pm, 5pm, 8pm), so the day is not used up in the morning, at
// noon or at night: each slot takes the top story available at that moment
// and later slots stay free for news that breaks later. A slot with nothing
// good enough stays open until something is, but stories are never bunched
// (two hours apart). Breaking news goes out at once and uses the next slot.

const HOUR = 60 * 60 * 1000;

export const EDITORIAL = Object.freeze({
  minOutlets: 3,
  timeZone: "America/Toronto",
  slotHours: Object.freeze([8, 11, 14, 17, 20]),
  minGapMs: 2 * HOUR,
  breakingScore: 55,
  breakingGapMs: 30 * 60 * 1000,
  maxAgeMs: 36 * HOUR,
  // Claude calls one pass may spend finding a story Claude agrees to publish.
  callsPerPass: 3,
  // Candidates whose Wikipedia buzz is looked up in one pass.
  buzzLookups: 8,
});

const round = (value) => Math.round(value * 10) / 10;

// The local calendar day and hour (with minutes as a fraction) of a moment.
export function localClock(at, timeZone = EDITORIAL.timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(at)).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) + Number(parts.minute) / 60 };
}

// May a story with this score go out now? `published` holds the times of
// recent published stories. Returns { open, breaking?, reason? }.
export function publishingSlot({ at, published = [], score = 0, editorial = EDITORIAL } = {}) {
  const now = localClock(at, editorial.timeZone);
  const today = published.filter((time) => localClock(time, editorial.timeZone).day === now.day).length;
  const gap = published.length ? at - Math.max(...published) : Infinity;
  if (today >= editorial.slotHours.length) return { open: false, reason: "day_full" };
  if (score >= editorial.breakingScore) {
    return gap >= editorial.breakingGapMs ? { open: true, breaking: true } : { open: false, reason: "too_soon" };
  }
  const due = editorial.slotHours.filter((hour) => now.hour >= hour).length;
  if (today >= due) return { open: false, reason: "next_slot" };
  if (gap < editorial.minGapMs) return { open: false, reason: "too_soon" };
  return { open: true };
}

// Coverage counts most: each independent outlet is worth 10, and extra outlets
// from the same company 2. Buzz adds up to 20 (8 per doubling of Wikipedia
// readers), artist size up to 10, Mshpit fans up to 15, and a story loses a
// point for every six hours since it was first reported.
export function storyScore({ groups = 0, outlets = 0, wikiRatio = null, popularity = 0, fans = 0, ageHours = 0 } = {}) {
  const coverage = 10 * groups + 2 * Math.max(0, outlets - groups);
  const buzz = Number(wikiRatio) > 1 ? Math.min(20, 8 * Math.log2(Number(wikiRatio))) : 0;
  const size = Math.max(0, Math.min(100, Number(popularity) || 0)) / 10;
  const community = Math.min(15, 5 * Math.log2(1 + Math.max(0, Number(fans) || 0)));
  const age = Math.max(0, Number(ageHours) || 0) / 6;
  return round(coverage + buzz + size + community - age);
}

// "Top stories" for the news panel: the editorial score plus how Mshpit
// members engage with the post (likes, comments, views), halving every day.
export function topStoryScore({ score = 0, likes = 0, comments = 0, views = 0, ageHours = 0 } = {}) {
  const engagement = 3 * Math.max(0, likes) + 5 * Math.max(0, comments) + 0.1 * Math.max(0, views);
  return round((Math.max(0, Number(score) || 0) + engagement) * 0.5 ** (Math.max(0, ageHours) / 24));
}
