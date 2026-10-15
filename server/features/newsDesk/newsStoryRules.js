// Pure rules for the news desk: what counts as music news, which reports
// describe the same story, and when a story is confirmed.
//
// Confirmation means at least three independent publishers (see
// newsEditorial.js): the more outlets, the bigger the news.

import { EDITORIAL } from "./newsEditorial.js";
import { newsSourceById } from "./newsSources.js";

export const NEWS_CATEGORIES = Object.freeze(["release", "tour", "festival", "awards", "charts", "industry", "lineup", "death", "legal", "other"]);
// What Mshpit News publishes: real music news. Industry stories, film and TV,
// and anything else stay out however widely they are covered.
export const PUBLISHABLE_CATEGORIES = Object.freeze(["release", "tour", "festival", "lineup", "awards", "charts", "legal", "death"]);
export const SENSITIVE_CATEGORIES = new Set(["death", "legal"]);

const CATEGORY_RULES = [
  ["death", /\b(dies|died|dead at|death of|passed away|obituary|rip|in memoriam)\b/iu],
  ["legal", /\b(lawsuit|sues|sued|court|trial|arrest(?:ed)?|charged|indict(?:ed|ment)|allegation|accus(?:ed|es|er)|settle(?:s|d|ment)|verdict|sentenced|plead)\b/iu],
  ["awards", /\b(grammy|grammys|brit awards?|vmas?|amas?|award|awards|nominat(?:ed|ions?)|wins best|hall of fame|mercury prize|polaris)\b/iu],
  ["charts", /\b(billboard 200|hot 100|no\. 1|number one|chart|charts|debuts at|tops|streaming record|spotify record)\b/iu],
  ["festival", /\b(festivals?|lineups?|line-ups?|headline[rs]?|coachella|glastonbury|lollapalooza|bonnaroo|reading and leeds|primavera)\b/iu],
  ["tour", /\b(tour|tours|touring|tour dates|residency|stadium|arena shows|reunion shows|concerts?|live dates|world tour)\b/iu],
  ["release", /\b(album|ep|single|song|track|video|mixtape|announces? new|shares new|releases?|drops?|deluxe|reissue|remaster)\b/iu],
  ["lineup", /\b(joins|quits|leaves|departs?|new drummer|new singer|new bassist|reunite[sd]?|reunion|split|breakup|hiatus|retir(?:es|ing|ement)|disband)\b/iu],
  ["industry", /\b(label|signs? (?:to|with)|record deal|catalog|catalogue|rights|royalt(?:y|ies)|streaming|spotify|ticketmaster|live nation|tickets?|ticket prices|venue)\b/iu],
];

// Not news: opinion, reviews, lists, gossip, personal life, one artist
// criticising another, and film or TV work.
const NOT_NEWS = /\b(review|reviewed|ranked|ranking|best (?:albums?|songs?)|worst|every .* ranked|songs? you need|new music friday|the week in|playlist|quiz|poll|vote|your favou?rite|podcast|op-ed|opinion|interview|in conversation|listen to|watch:|photos?:|gallery|dating|girlfriend|boyfriend|romance|wedding|divorce|pregnan|baby|outfit|red carpet look|fashion|feud|slams|claps back|shades|reacts? to|trolls|tweet|instagram post|tiktok trend|net worth|horoscope|ruined|disses|beef|blasts|calls out|hits back|criticis(?:es|ed|ing)|criticiz(?:es|ed|ing)|biopic|casting|cast as|actor|actress|box office|tv series|sitcom|trailer)\b/iu;

export function newsCategory(text) {
  const value = String(text || "");
  for (const [category, rule] of CATEGORY_RULES) if (rule.test(value)) return category;
  return "other";
}

export const looksLikeNews = (title) => !!String(title || "").trim() && !NOT_NEWS.test(String(title));

const STOPWORDS = new Set(("a an and are as at be but by for from has have he her his in into is it its new of on or our "
  + "out over she so that the their them they this to up was we were will with you your after about announce announces "
  + "announced share shares shared says said reveal reveals revealed first more than just now how why what who when "
  + "releases release album song single video tour dates details").split(" "));

// Distinctive words of a headline: lower-case, no punctuation or stopwords,
// light plural folding so "Tours" and "Tour" agree.
export function headlineTokens(text) {
  return new Set(String(text || "").normalize("NFKD").replace(/[̀-ͯ]/gu, "").toLowerCase()
    .replace(/['’]s\b/gu, "").split(/[^a-z0-9]+/u)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word))
    .map((word) => (word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word)));
}

export function similarity(left, right) {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

// Two reports tell the same story when they name a shared artist and their
// headlines overlap, or when the headlines alone overlap strongly.
export function sameStory(left, right) {
  if (left.group === right.group && left.sourceId === right.sourceId) return false;
  const score = similarity(left.tokens, right.tokens);
  const sharedArtist = left.artistKeys.some((key) => right.artistKeys.includes(key));
  // Same artist: a loose overlap is enough when the headlines agree on the kind
  // of story, a strong one when they do not ("U2 play their old school" read as
  // a release by one outlet and a tour date by another).
  if (sharedArtist) return score >= 0.35 || (score >= 0.2 && (left.category === right.category || left.category === "other" || right.category === "other"));
  return score >= 0.45;
}

// Groups reports into stories. A report joins the group it matches best, and
// only when it matches at least half of that group, so one catch-all article
// (a weekly roundup naming several artists) cannot chain unrelated stories.
export function clusterReports(reports) {
  const ordered = [...reports].sort((left, right) => left.publishedAt - right.publishedAt);
  const clusters = [];
  for (const report of ordered) {
    let best = null;
    let bestShare = 0;
    for (const cluster of clusters) {
      const matches = cluster.filter((member) => sameStory(member, report)).length;
      const share = matches / cluster.length;
      if (matches && share >= 0.5 && share > bestShare) { best = cluster; bestShare = share; }
    }
    if (best) best.push(report);
    else clusters.push([report]);
  }
  return clusters;
}

export const independentGroups = (reports) => new Set((Array.isArray(reports) ? reports : [])
  .map((report) => report?.group).filter((group) => typeof group === "string" && group)).size;

// Only reports actually supplied to the editor may support its output. Resolve
// publisher ownership from our registry, never from model-supplied group names.
export function validatedSupportingReports(reports, supporting) {
  const allowed = new Map(reports.map((report) => [`${report.sourceId}\n${report.url}`, report]));
  const seen = new Set();
  return (Array.isArray(supporting) ? supporting : []).flatMap((claim) => {
    const report = allowed.get(`${claim?.sourceId}\n${claim?.url}`);
    const source = report && newsSourceById(report.sourceId);
    if (!source || seen.has(report.url)) return [];
    seen.add(report.url);
    return [{ ...report, group: source.group }];
  });
}

export function storyCategory(reports) {
  const counts = new Map();
  for (const report of reports) counts.set(report.category, (counts.get(report.category) || 0) + 1);
  // A single report calling it a death or legal story is enough to demand the
  // stricter bar; otherwise the most common category wins.
  for (const sensitive of SENSITIVE_CATEGORIES) if (counts.has(sensitive)) return sensitive;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "other";
}

export const isConfirmed = (reports, { minPublishers = EDITORIAL.minOutlets } = {}) =>
  independentGroups(reports) >= Math.max(2, Number(minPublishers) || EDITORIAL.minOutlets);
