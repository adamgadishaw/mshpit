// Established music press the news desk reads. A story needs reports from at
// least three independent publishers, so outlets owned by the same company
// share a `group` and count once: Billboard, Rolling Stone and Variety are all
// Penske Media; Loudwire and XXL are both Townsquare Media. Checked 2026-09-27;
// when an owner is unclear, group the outlets together (undercounting only
// delays a story). Left out: Alternative Press (Live Nation's Veeps, staff laid
// off in August 2026) and outlets without a working https feed (Exclaim!,
// Complex, BrooklynVegan's feed is stale, HipHopDX's stopped in April).
export const NEWS_SOURCES = Object.freeze([
  { id: "billboard", name: "Billboard", group: "pmc", domain: "billboard.com", url: "https://www.billboard.com/c/music/music-news/feed/" },
  { id: "rollingstone", name: "Rolling Stone", group: "pmc", domain: "rollingstone.com", url: "https://www.rollingstone.com/music/music-news/feed/" },
  { id: "variety", name: "Variety", group: "pmc", domain: "variety.com", url: "https://variety.com/v/music/feed/" },
  { id: "pitchfork", name: "Pitchfork", group: "pitchfork", domain: "pitchfork.com", url: "https://pitchfork.com/feed/feed-news/rss" },
  { id: "nme", name: "NME", group: "nme", domain: "nme.com", url: "https://www.nme.com/news/music/feed" },
  { id: "consequence", name: "Consequence", group: "consequence", domain: "consequence.net", url: "https://consequence.net/category/music/feed/" },
  { id: "stereogum", name: "Stereogum", group: "stereogum", domain: "stereogum.com", url: "https://www.stereogum.com/category/news/feed/" },
  { id: "guardian", name: "The Guardian", group: "guardian", domain: "theguardian.com", url: "https://www.theguardian.com/music/rss" },
  { id: "loudwire", name: "Loudwire", group: "townsquare", domain: "loudwire.com", url: "https://loudwire.com/category/news/feed/" },
  { id: "xxl", name: "XXL", group: "townsquare", domain: "xxlmag.com", url: "https://www.xxlmag.com/feed/" },
  { id: "spin", name: "SPIN", group: "spin", domain: "spinmagazine.com", url: "https://spinmagazine.com/feed/" },
  { id: "clash", name: "Clash", group: "clash", domain: "clashmusic.com", url: "https://www.clashmusic.com/feed/" },
  { id: "diy", name: "DIY", group: "diy", domain: "diymag.com", url: "https://diymag.com/feeds/all" },
  { id: "hotnewhiphop", name: "HotNewHipHop", group: "hotnewhiphop", domain: "hotnewhiphop.com", url: "https://www.hotnewhiphop.com/feed" },
  { id: "fader", name: "The FADER", group: "fader", domain: "thefader.com", url: "https://www.thefader.com/feed" },
  { id: "pollstar", name: "Pollstar", group: "pollstar", domain: "pollstar.com", url: "https://news.pollstar.com/feed/" },
  { id: "jambase", name: "JamBase", group: "jambase", domain: "jambase.com", url: "https://www.jambase.com/feed" },
]);

export const newsSourceById = (id) => NEWS_SOURCES.find((source) => source.id === id) || null;

// Only an https page on the outlet's own site is ever fetched for a story.
export function sourceOwnsUrl(source, value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !!source?.domain
      && (host === source.domain || host.endsWith(`.${source.domain}`));
  } catch {
    return false;
  }
}
