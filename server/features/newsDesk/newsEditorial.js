// The news desk's editorial policy, set by the owner on 2026-09-26: big music
// news only (to save money and for how the site is seen), the more outlets the
// better, and among those, what people are most engaged with.
//
// A story needs at least three independent outlets. Candidates are ranked by
// coverage, internet buzz (how many people are reading the artist's Wikipedia
// article compared with a normal day), the artist's size and how much Mshpit
// members follow, review and play them. The desk publishes the best one at a
// time, at most one every three hours unless it is breaking news, and at most
// five a day.

const HOUR = 60 * 60 * 1000;

export const EDITORIAL = Object.freeze({
  minOutlets: 3,
  dailyLimit: 5,
  spacingMs: 3 * HOUR,
  breakingScore: 55,
  maxAgeMs: 36 * HOUR,
  // Claude calls one pass may spend finding a story Claude agrees to publish.
  callsPerPass: 3,
  // Candidates whose Wikipedia buzz is looked up in one pass.
  buzzLookups: 8,
});

const round = (value) => Math.round(value * 10) / 10;

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
