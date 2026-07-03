/**
 * Final-tier image source: the **open web**.
 *
 * This is the last resort after Commons + Openverse can't fill a gallery. Unlike
 * those, these results are NOT license-cleared — they are used under a
 * **takedown-on-request** policy and tagged so the app can show a "source: web"
 * caption and pull a single image the moment a rights-holder asks (store
 * `removePhoto`). See `DATA_SOURCES.md`.
 *
 * Two engines, picked automatically:
 *   1. **Google Programmable Search JSON API** — when GOOGLE_CSE_KEY +
 *      GOOGLE_CSE_CX are set. Clean, no scraping, returns original image URLs.
 *      Tagged `source:"google"`.
 *   2. **Bing Images** — keyless fallback that still returns original image URLs
 *      (`murl`) in plain HTML, so galleries fill without any API key. Tagged
 *      `source:"web"`. (Google's own image page is now fully JS-gated and returns
 *      nothing to a server-side fetch, so it can't be scraped without a key.)
 */

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const isPhoto = (u) => /\.(jpe?g|png)(\?|$)/i.test(u);

// Engine 1: Google Programmable Search (only if keys are configured).
async function viaGoogleCSE(query, n) {
  const key = process.env.GOOGLE_CSE_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!key || !cx) return null;
  const url =
    `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}` +
    `&searchType=image&num=${Math.min(n, 10)}&safe=active&q=${encodeURIComponent(query)}`;
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const d = await r.json();
    return (d.items || [])
      .filter((it) => it.link && isPhoto(it.link))
      .map((it) => ({ uri: it.link, credit: `Source: ${it.displayLink || "web"} (Google)`, source: "google" }));
  } catch {
    return null;
  }
}

// Engine 2: Bing Images, keyless. Original URLs ride in the `murl` field.
async function viaBing(query, n) {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9" } });
    if (!r.ok) return [];
    const html = await r.text();
    const out = [];
    const seen = new Set();
    for (const m of html.matchAll(/murl&quot;:&quot;(.*?)&quot;/g)) {
      const uri = m[1].replace(/\\u002f/gi, "/").replace(/&amp;/g, "&");
      if (!isPhoto(uri) || seen.has(uri)) continue;
      seen.add(uri);
      out.push({ uri, credit: "Source: web", source: "web" });
      if (out.length >= n) break;
    }
    return out;
  } catch {
    return [];
  }
}

export async function webImages(query, n = 8) {
  const g = await viaGoogleCSE(query, n);
  if (g && g.length) return g;
  return viaBing(query, n);
}
