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
  .news-dates li{padding:.2rem 0;color:#d8d0c5}.news-dates time{display:inline-block;min-width:6.5rem;color:var(--gold);font-weight:700}`;

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

export function projectNewsDocument({ origin = "https://www.mshpit.com", items = [], at = Date.now() } = {}) {
  const canonicalPath = "/news";
  const canonicalUrl = new URL(canonicalPath, origin).href;
  const day = new Date(at).toISOString().slice(0, 10);
  const releases = items.filter((item) => item.kind === "release").slice(0, 30);
  const shows = items.filter((item) => item.kind === "shows").slice(0, 30);
  const names = [...new Set(items.map((item) => item.artist.name))].slice(0, 4);
  const description = items.length
    ? `New albums, EPs and singles and newly added tour dates${names.length ? ` from ${names.join(", ")} and more` : ""}. Follow artists on Mshpit to hear first.`
    : "New albums, EPs and singles and newly added tour dates from the artists fans follow on Mshpit.";
  return {
    kind: "news",
    siteName: "Mshpit",
    heading: "New music and tour dates",
    title: "New Music & Tour Announcements This Week | Mshpit",
    description,
    canonicalPath,
    canonicalUrl,
    // An empty news page is not worth a search result yet.
    indexable: items.length >= 3,
    news: { releases, shows, day },
    jsonLd: [{
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": `${canonicalUrl}#page`,
      name: "New music and tour dates",
      url: canonicalUrl,
      description,
      ...(releases.length ? { mainEntity: {
        "@type": "ItemList",
        name: "New releases",
        numberOfItems: releases.length,
        itemListElement: releases.map((item, index) => ({ "@type": "ListItem", position: index + 1, item: albumSchema(item, origin) })),
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

export function renderNewsMain(document) {
  if (document?.kind !== "news") return null;
  const { releases, shows, day } = document.news;
  return `<main id="main" class="news-page">
    <nav class="breadcrumbs" aria-label="Breadcrumb"><ol><li><a href="/">Mshpit</a></li><li><span aria-current="page">News</span></li></ol></nav>
    <section class="hero"><p class="eyebrow">Mshpit news</p><h1>New music and tour dates</h1>
      <p class="hero-copy">${esc(document.description)}</p>
      <div class="actions"><a class="button primary" href="/signup">Follow your artists</a><a class="button" href="/events">Browse upcoming shows</a></div></section>
    ${releases.length ? `<section class="section"><div class="section-heading"><div><p class="eyebrow">Just released</p><h2>New albums, EPs and singles</h2></div></div>${renderNewsItems(releases, day)}</section>` : ""}
    ${shows.length ? `<section class="section"><div class="section-heading"><div><p class="eyebrow">Just added</p><h2>New tour dates</h2></div></div>${renderNewsItems(shows, day)}</section>` : ""}
    ${!releases.length && !shows.length ? `<section class="section empty-state"><h2>News arrives as artists announce it.</h2><p>New releases and tour dates for the artists fans follow show up here.</p></section>` : ""}
  </main>`;
}

// The "Latest news" block on an artist's public page.
export function renderArtistNewsSection(document) {
  const items = Array.isArray(document?.news) ? document.news : [];
  if (!items.length) return "";
  const day = new Date().toISOString().slice(0, 10);
  return `<section class="section"><div class="section-heading"><div><p class="eyebrow">Latest news</p><h2>What's new with ${esc(document.artist?.name || "this artist")}</h2></div></div>${renderNewsItems(items, day)}
    <p class="muted"><a href="/news">More music news</a></p></section>`;
}
