// Minimal RSS 2.0 / Atom reader for the news desk. It keeps only what a story
// needs (headline, link, date and the publisher's own teaser) and never the
// article body or images, which stay on the publisher's site.

const MAX_ITEMS = 60;
const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

export function decodeEntities(value) {
  return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (match, code) => {
    if (code[0] === "#") {
      const point = code[1] === "x" || code[1] === "X" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isSafeInteger(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

const unwrap = (value) => String(value || "").replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/u, "$1");
// Entities are decoded twice because feeds often escape HTML inside CDATA.
export const plainText = (value, max = 600) => decodeEntities(decodeEntities(unwrap(value))
  .replace(/<[^>]*>/gu, " "))
  .replace(/\s+/gu, " ").trim().slice(0, max);

const tag = (block, name) => {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "iu"));
  return match ? match[1] : "";
};

// Publishers' links, minus tracking parameters (utm_*, fbclid and the like).
const httpsLink = (value) => {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_|ref$|cmpid$)/iu.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
};

const timestamp = (value) => {
  const parsed = Date.parse(plainText(value, 80));
  return Number.isFinite(parsed) ? parsed : null;
};

export function parseNewsFeed(xml, { sourceId } = {}) {
  const text = String(xml || "");
  const items = [];
  const blocks = [...text.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/giu)].map((match) => match[1]);
  const atom = blocks.length ? [] : [...text.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/giu)].map((match) => match[1]);
  for (const block of blocks) {
    items.push({
      title: plainText(tag(block, "title"), 300),
      url: httpsLink(plainText(tag(block, "link"), 2000)),
      publishedAt: timestamp(tag(block, "pubDate") || tag(block, "dc:date")),
      description: plainText(tag(block, "description"), 600),
    });
  }
  for (const block of atom) {
    const href = block.match(/<link\b[^>]*href="([^"]+)"/iu)?.[1];
    items.push({
      title: plainText(tag(block, "title"), 300),
      url: httpsLink(decodeEntities(href)),
      publishedAt: timestamp(tag(block, "published") || tag(block, "updated")),
      description: plainText(tag(block, "summary") || tag(block, "content"), 600),
    });
  }
  return items.filter((item) => item.title && item.url && item.publishedAt)
    .slice(0, MAX_ITEMS)
    .map((item) => ({ ...item, sourceId }));
}
