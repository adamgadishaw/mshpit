import { newsDateLabel, releaseAvailability, releaseTypeLabel } from "../../../src/domain/artistNews.mjs";

// The public /news page and the "Latest news" block on artist pages. Search
// engines see what fans see: new albums, EPs and singles, and new tour dates,
// each linked to the artist and event pages that hold the details.

const esc = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const safePath = (value) => (typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : null);
const safeHttps = (value) => (typeof value === "string" && /^https:\/\/[^\s"'<>]+$/u.test(value) ? value : null);
const link = (href, label) => (safePath(href) ? `<a href="${esc(href)}">${esc(label)}</a>` : esc(label));

function releaseItem(item, day) {
  const release = item.release;
  const cover = safeHttps(release.cover);
  const listen = safeHttps(release.url);
  return `<li class="news-item news-release">
      ${cover ? `<img src="${esc(cover)}" alt="${esc(`${release.title} cover art`)}" width="96" height="96" loading="lazy" decoding="async" />` : ""}
      <div><p class="eyebrow">New ${esc(releaseTypeLabel(release.type))} · ${esc(releaseAvailability(release.releaseDate, day) || newsDateLabel(release.releaseDate))}</p>
      <h3>${link(item.artist.path, item.artist.name)}: ${esc(release.title)}</h3>
      <p class="muted">Released ${esc(newsDateLabel(release.releaseDate))}${listen ? ` · <a href="${esc(listen)}" rel="nofollow noopener noreferrer">Listen on Deezer</a>` : ""}</p></div>
    </li>`;
}

function showsItem(item) {
  const dates = item.shows.dates.slice(0, 6);
  return `<li class="news-item news-shows">
      <div><p class="eyebrow">${esc(item.title)}</p>
      <h3>${link(item.artist.path, item.artist.name)}</h3>
      <ul class="news-dates">${dates.map((date) => `<li><time datetime="${esc(date.date)}">${esc(newsDateLabel(date.date))}</time> ${link(date.path, [date.venue, date.city].filter(Boolean).join(", "))}</li>`).join("")}</ul>
      ${item.shows.count > dates.length ? `<p class="muted">${link(item.artist.path, `See all ${item.shows.count} new dates`)}</p>` : ""}</div>
    </li>`;
}

export function renderNewsItems(items, day) {
  return `<ul class="news-list">${items.map((item) => (item.kind === "release" ? releaseItem(item, day) : showsItem(item))).join("")}</ul>`;
}

export const NEWS_STYLES = `.news-list,.news-dates{list-style:none;margin:0;padding:0}.news-item{display:flex;gap:1rem;padding:1.1rem 0;border-top:1px solid var(--line)}
  .news-item img{width:96px;height:96px;border-radius:.6rem;object-fit:cover;flex-shrink:0}.news-item h3{margin:.2rem 0;font-size:1.2rem}
  .news-dates li{padding:.2rem 0;color:#d8d0c5}.news-dates time{display:inline-block;min-width:6.5rem;color:var(--gold);font-weight:700}
  .news-story{padding:1.4rem 0;border-top:1px solid var(--line)}.news-story h2{margin:.35rem 0 .5rem;font-size:1.45rem;line-height:1.25}.news-story p{max-width:760px}.news-sources{color:var(--muted);font-size:.9rem}`;

function albumSchema(item, origin) {
  const release = item.release;
  return {
    "@type": "MusicAlbum",
    name: release.title,
    ...(release.releaseDate ? { datePublished: release.releaseDate } : {}),
    ...(safeHttps(release.cover) ? { image: release.cover } : {}),
    albumReleaseType: release.type === "single" ? "https://schema.org/SingleRelease" : release.type === "ep" ? "https://schema.org/EPRelease" : "https://schema.org/AlbumRelease",
    byArtist: { "@type": "MusicGroup", name: item.artist.name, ...(safePath(item.artist.path) ? { url: new URL(item.artist.path, origin).href } : {}) },
  };
}

// An empty news page is not worth a search result yet.
export const NEWS_INDEX_MIN_ITEMS = 3;

// /news: stories from the Mshpit News desk, each confirmed by at least two
// independent music outlets, with links to every outlet's report.
export function projectNewsDocument({ origin = "https://www.mshpit.com", stories = [], at = Date.now() } = {}) {
  const canonicalPath = "/news";
  const canonicalUrl = new URL(canonicalPath, origin).href;
  const shown = (Array.isArray(stories) ? stories : []).filter((story) => story?.headline).slice(0, 40);
  const lead = shown.slice(0, 2).map((story) => story.headline);
  const description = lead.length
    ? `Confirmed music news: ${lead.join(". ")}. Every story is reported by at least two independent outlets.`
    : "Confirmed music news on Mshpit: tours, releases, festivals and the music business, each reported by at least two independent outlets.";
  const organization = { "@type": "Organization", name: "Mshpit News", url: new URL("/", origin).href };
  return {
    kind: "news",
    siteName: "Mshpit",
    heading: "Music news",
    title: "Music News: Tours, Releases & Festivals | Mshpit",
    description: description.slice(0, 300),
    canonicalPath,
    canonicalUrl,
    indexable: shown.length >= NEWS_INDEX_MIN_ITEMS,
    news: { stories: shown, at },
    jsonLd: [{
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": `${canonicalUrl}#page`,
      name: "Music news",
      url: canonicalUrl,
      description,
      ...(shown.length ? { mainEntity: {
        "@type": "ItemList",
        name: "Confirmed music news",
        numberOfItems: shown.length,
        itemListElement: shown.map((story, index) => ({ "@type": "ListItem", position: index + 1, item: {
          "@type": "NewsArticle",
          headline: story.headline.slice(0, 110),
          ...(story.summary ? { description: story.summary } : {}),
          datePublished: new Date(story.publishedAt).toISOString(),
          author: organization,
          publisher: organization,
          ...(story.sources?.length ? { citation: story.sources.map((source) => source.url) } : {}),
          ...(story.artists?.length ? { about: story.artists.map((artist) => ({ "@type": "MusicGroup", name: artist.name,
            ...(safePath(artist.publicSlug ? `/artist/${artist.publicSlug}` : null) ? { url: new URL(`/artist/${artist.publicSlug}`, origin).href } : {}) })) } : {}),
        } })),
      } } : {}),
    }, {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Mshpit", item: new URL("/", origin).href },
        { "@type": "ListItem", position: 2, name: "News", item: canonicalUrl },
      ],
    }],
  };
}

function renderStory(story) {
  const artists = (story.artists || []).map((artist) => artist.publicSlug && safePath(`/artist/${artist.publicSlug}`)
    ? `<a href="/artist/${esc(artist.publicSlug)}">${esc(artist.name)}</a>` : esc(artist.name)).join(", ");
  const sources = (story.sources || []).filter((source) => safeHttps(source.url))
    .map((source) => `<a href="${esc(source.url)}" rel="nofollow noopener noreferrer">${esc(source.name)}</a>`).join(", ");
  const published = new Date(story.publishedAt);
  return `<article class="news-story">
    <p class="eyebrow">${esc(String(story.category || "news").replace(/^\w/u, (letter) => letter.toUpperCase()))} · <time datetime="${esc(published.toISOString())}">${esc(published.toISOString().slice(0, 10))}</time></p>
    <h2>${esc(story.headline)}</h2>
    ${story.summary ? `<p>${esc(story.summary)}</p>` : ""}
    ${artists ? `<p class="muted">About ${artists}</p>` : ""}
    ${sources ? `<p class="news-sources">Confirmed by ${sources}</p>` : ""}
  </article>`;
}

export function renderNewsMain(document) {
  if (document?.kind !== "news") return null;
  const stories = document.news?.stories || [];
  return `<main id="main" class="news-page">
    <nav class="breadcrumbs" aria-label="Breadcrumb"><ol><li><a href="/">Mshpit</a></li><li><span aria-current="page">News</span></li></ol></nav>
    <section class="hero"><p class="eyebrow">Mshpit News</p><h1>Music news</h1>
      <p class="hero-copy">Tours, releases, festivals and the music business. Every story here is reported by at least two independent music outlets, with links to each report.</p>
      <div class="actions"><a class="button primary" href="/signup">Join Mshpit</a><a class="button" href="/events">Browse upcoming shows</a></div></section>
    ${stories.length ? `<section class="section news-stories">${stories.map(renderStory).join("")}</section>`
      : `<section class="section empty-state"><h2>No confirmed stories yet.</h2><p>A story appears here once at least two independent outlets report it.</p></section>`}
  </main>`;
}

// The "Latest news" block on an artist's public page.
// "In the news": Mshpit News stories about this artist, each linking to its
// story page, newest first.
export function renderArtistHeadlinesSection(document) {
  const stories = Array.isArray(document?.headlines) ? document.headlines : [];
  if (!stories.length) return "";
  const items = stories.map((story) => {
    const published = new Date(story.publishedAt);
    const date = Number.isFinite(published.valueOf()) ? published.toISOString().slice(0, 10) : "";
    const outlets = story.sources?.length ? `Confirmed by ${story.sources.slice(0, 4).join(", ")}` : "";
    return `<li><h3>${safePath(story.path) ? `<a href="${esc(story.path)}">${esc(story.headline)}</a>` : esc(story.headline)}</h3>
      ${story.summary ? `<p>${esc(story.summary)}</p>` : ""}
      <p class="muted">${[date ? `<time datetime="${esc(date)}">${esc(date)}</time>` : "", esc(outlets)].filter(Boolean).join(" · ")}</p></li>`;
  }).join("");
  return `<section class="section"><div class="section-heading"><div><p class="eyebrow">Mshpit News</p><h2>${esc(document.artist?.name || "This artist")} in the news</h2></div></div><ul class="news-list">${items}</ul>
    <p class="muted"><a href="/news">More music news</a></p></section>`;
}

export function renderArtistNewsSection(document) {
  const items = Array.isArray(document?.news) ? document.news : [];
  if (!items.length) return "";
  const day = new Date().toISOString().slice(0, 10);
  return `<section class="section"><div class="section-heading"><div><p class="eyebrow">Latest news</p><h2>What's new with ${esc(document.artist?.name || "this artist")}</h2></div></div>${renderNewsItems(items, day)}
    <p class="muted"><a href="/news">More music news</a></p></section>`;
}
