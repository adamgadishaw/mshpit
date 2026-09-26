// Established music press the news desk reads. A story needs reports from at
// least two independent publishers, so outlets owned by the same company share
// a `group` and count once: Billboard, Rolling Stone and Variety are all
// Penske Media.
export const NEWS_SOURCES = Object.freeze([
  { id: "billboard", name: "Billboard", group: "pmc", url: "https://www.billboard.com/c/music/music-news/feed/" },
  { id: "rollingstone", name: "Rolling Stone", group: "pmc", url: "https://www.rollingstone.com/music/music-news/feed/" },
  { id: "variety", name: "Variety", group: "pmc", url: "https://variety.com/v/music/feed/" },
  { id: "pitchfork", name: "Pitchfork", group: "pitchfork", url: "https://pitchfork.com/feed/feed-news/rss" },
  { id: "nme", name: "NME", group: "nme", url: "https://www.nme.com/news/music/feed" },
  { id: "consequence", name: "Consequence", group: "consequence", url: "https://consequence.net/category/music/feed/" },
  { id: "stereogum", name: "Stereogum", group: "stereogum", url: "https://www.stereogum.com/category/news/feed/" },
  { id: "guardian", name: "The Guardian", group: "guardian", url: "https://www.theguardian.com/music/rss" },
]);

export const newsSourceById = (id) => NEWS_SOURCES.find((source) => source.id === id) || null;
