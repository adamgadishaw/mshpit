import { cityPath } from "../../../src/domain/urls.mjs";
import { DEFAULT_CITY_COPY } from "../cities/cityCopy.js";
import { publicCityMetadata, publicEventTimeLabel } from "./publicMetadataPresentation.js";

const text = (value, max = 8000) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const path = (value) => typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !/[\\\u0000-\u001f]/.test(value) ? value : null;
const format = (value, city) => text(value).replaceAll("{city}", city);
function mediaUrl(value, origin) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, origin);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function projectCityGuideDocument(guide, { origin = "https://www.mshpit.com" } = {}) {
  if (!guide?.city) return null;
  const canonicalPath = cityPath(guide.city);
  if (!canonicalPath) return null;
  const city = text(guide.city.city, 120), copy = { ...DEFAULT_CITY_COPY, ...guide.copy }, editorial = guide.editorial || {};
  const locationLabel = [city, text(guide.city.region, 100)].filter(Boolean).join(", ");
  const canonicalUrl = new URL(canonicalPath, origin).href;
  const heading = text(editorial.title, 180) || format(copy.cityTitle, locationLabel) || locationLabel;
  const photoRows = [...(guide.photos || []).filter((photo) => photo.kind !== "city").slice(0, 9),
    ...(guide.photos || []).filter((photo) => photo.kind === "city").slice(0, 1)];
  const photos = photoRows.flatMap((photo) => {
    const url = mediaUrl(photo.uri || photo.url, origin);
    return url ? [{ ...photo, url, alt: text(photo.alt || photo.altText || city, 240) }] : [];
  });
  // Only untouched defaults become evidence-aware. Managed city SEO copy and
  // long editorial introductions retain their existing precedence and limits.
  const defaults = publicCityMetadata(locationLabel, guide, photos);
  const searchTitle = text(editorial.seoTitle, 80)
    || (copy.citySeoTitle === DEFAULT_CITY_COPY.citySeoTitle ? defaults.title : format(copy.citySeoTitle, locationLabel)) || heading;
  const description = text(editorial.seoDescription, 200) || text(editorial.intro, 300)
    || (copy.citySeoDescription === DEFAULT_CITY_COPY.citySeoDescription ? defaults.description : format(copy.citySeoDescription || copy.cityDescription, locationLabel));
  const list = [...(guide.venues || []), ...(guide.artists || []), ...(guide.performingArtists || []), ...(guide.today || []), ...(guide.upcoming || [])];
  const linked = [...new Map(list.flatMap((item) => path(item.path)
    && text(item.name || item.artist || item.eventName, 180)
    ? [[item.path, { name: text(item.name || item.artist || item.eventName, 180), path: item.path }]] : [])).values()].slice(0, 100);
  const indexable = !!(text(editorial.intro).length >= 80 || text(editorial.history).length >= 80 || text(editorial.influence).length >= 80
    || (guide.venues || []).some((row) => path(row.path)) || linked.length);
  const breadcrumbs = [{ name: "Mshpit", path: "/" }, { name: text(copy.citiesTitle, 80), path: "/cities" }, { name: locationLabel, path: canonicalPath }];
  const country = { "@type": "Country", name: text(guide.city.country || guide.city.countryCode, 100) };
  const place = { "@type": "City", "@id": `${canonicalUrl}#city`, name: city,
    containedInPlace: guide.city.region ? { "@type": "AdministrativeArea", name: text(guide.city.region, 100), containedInPlace: country } : country };
  const citations = [...new Set((editorial.sources || []).map((row) => mediaUrl(row.url, origin)).filter(Boolean))];
  return {
    kind: "city", siteName: "Mshpit", heading, title: `${searchTitle} | Mshpit`, description,
    canonicalPath, canonicalUrl, indexable, image: photos[0]?.url || null, imageAlt: photos[0]?.alt || null,
    cityGuide: { ...guide, copy, photos },
    breadcrumbs,
    jsonLd: [{
      "@context": "https://schema.org", "@type": "CollectionPage", "@id": canonicalUrl,
      name: heading, description, url: canonicalUrl,
      about: place,
      isPartOf: { "@type": "WebSite", name: "Mshpit", url: new URL("/", origin).href },
      ...(citations.length ? { citation: citations } : {}),
      ...(photos.length ? { image: photos.map((photo) => photo.url) } : {}),
      mainEntity: { "@type": "ItemList", numberOfItems: linked.length, itemListElement: linked.map((row, index) => ({
        "@type": "ListItem", position: index + 1, name: row.name, url: new URL(row.path, origin).href,
      })) },
    }, {
      "@context": "https://schema.org", "@type": "BreadcrumbList",
      itemListElement: breadcrumbs.map((row, index) => ({ "@type": "ListItem", position: index + 1, name: row.name, item: new URL(row.path, origin).href })),
    }],
  };
}

const esc = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const link = (href, label) => path(href) ? `<a href="${esc(href)}">${esc(label)}</a>` : esc(label);
const external = (href, label) => mediaUrl(href, "https://www.mshpit.com") ? `<a href="${esc(mediaUrl(href, "https://www.mshpit.com"))}" rel="noopener noreferrer">${esc(label)}</a>` : esc(label);
const paragraphs = (value) => String(value || "").split(/\n{2,}/).filter((row) => row.trim()).map((row) => `<p>${esc(row)}</p>`).join("");
export function renderCityGuideMain(document) {
  const guide = document.cityGuide, copy = guide.copy || {}, editorial = guide.editorial || {};
  const city = [guide.city.city, guide.city.region].filter(Boolean).join(", ");
  const label = (key) => format(copy[key], city);
  const section = (id, heading, body, className = "") => body
    ? `<section id="${id}" class="section city-section ${className}"><h2>${esc(heading)}</h2>${body}</section>` : "";
  const figure = (photo, index, className = "") => {
    const reviewPath = photo.kind === "fan" && /^\/post\/[^/]+$/.test(photo.path || "") ? path(photo.path) : null;
    const image = `<img src="${esc(photo.url)}" alt="${esc(photo.alt)}" loading="${index ? "lazy" : "eager"}" decoding="async"${index ? "" : ' fetchpriority="high"'} width="720" height="480" />`;
    const credit = photo.credit || photo.by;
    const caption = [reviewPath ? link(reviewPath, label("openReview")) : "",
      credit ? external(photo.sourceUrl || photo.sourcePage, credit) : "",
      photo.licenseUrl ? external(photo.licenseUrl, copy.photoLicense) : ""].filter(Boolean).join(" · ");
    return `<figure class="media-item ${className}">${reviewPath ? `<a href="${esc(reviewPath)}" aria-label="${esc(label("openReview") + ": " + photo.alt)}">${image}</a>` : image}${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`;
  };
  const events = (rows) => `<ol class="event-list city-show-list">${rows.map((row) => {
    const title = row.artist || row.eventName || row.name;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(row.date || "") ? new Date(row.date + "T00:00:00Z") : null;
    const validDate = date && Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === row.date;
    const dateLabel = validDate ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date) : row.date;
    const timeLabel = publicEventTimeLabel(row.startLocalTime);
    return `<li><time datetime="${esc(row.date)}">${esc(dateLabel)}</time><div><h3>${link(row.path, title)}</h3>${row.eventName && row.eventName !== title ? `<p>${esc(row.eventName)}</p>` : ""}<p>${link(row.venuePath, row.venue)}${timeLabel ? " · " + esc(timeLabel) : ""}</p></div></li>`;
  }).join("")}</ol>`;
  const venues = (guide.venues || []).map((row) => `<li><h3>${link(row.path, row.name)}</h3>${row.place ? `<p>${esc(row.place)}</p>` : ""}</li>`).join("");
  const artists = (guide.artists || []).map((row) => `<li><h3>${link(row.path, row.name)}</h3>${row.description ? paragraphs(row.description) : ""}</li>`).join("");
  const performing = (guide.performingArtists || []).map((row) => `<li><h3>${link(row.path, row.name)}</h3></li>`).join("");
  const jumpLinks = [["today", "todayTitle"], ...(guide.upcoming?.length ? [["upcoming", "upcomingTitle"]] : []),
    ...(venues ? [["venues", "venuesTitle"]] : []), ...(editorial.history ? [["history", "historyTitle"]] : [])];
  const counts = [
    text(copy.venueCount).replaceAll("{count}", guide.city.venueCount || 0),
    text(copy.upcomingCount).replaceAll("{count}", guide.city.upcomingCount || 0),
  ];
  return `<main id="main" class="city-guide"><nav class="breadcrumbs" aria-label="Breadcrumb"><ol>${document.breadcrumbs.map((row, index) => `<li>${index === document.breadcrumbs.length - 1 ? `<span aria-current="page">${esc(row.name)}</span>` : link(row.path, row.name)}</li>`).join("")}</ol></nav>
    <section class="city-marquee"><div class="city-marquee-copy"><p class="eyebrow">${esc(label("guideLabel"))} · ${esc([guide.city.region, guide.city.country].filter(Boolean).join(", "))}</p><h1>${esc(document.heading)}</h1><div class="hero-copy">${paragraphs(editorial.intro || document.description)}</div></div>${guide.photos[0] ? figure(guide.photos[0], 0, "city-hero-photo") : ""}
      <div class="city-ticket-stub">${counts.map((count) => `<span>${esc(count)}</span>`).join("")}</div></section>
    <nav class="city-section-links" aria-label="${esc(label("guideLabel"))}">${jumpLinks.map(([id, key]) => `<a href="#${id}">${esc(label(key))}</a>`).join("")}</nav>
    ${section("today", label("todayTitle"), guide.today?.length ? events(guide.today) : `<p>${esc(label("noShowsToday"))}</p>`)}
    ${guide.upcoming?.length ? section("upcoming", label("upcomingTitle"), events(guide.upcoming)) : ""}
    ${guide.photos.length > 1 ? section("photos", label("photosTitle"), `<div class="media-grid city-photo-strip">${guide.photos.slice(1).map((photo, index) => figure(photo, index + 1)).join("")}</div>`) : ""}
    <div class="city-programme">${section("history", label("historyTitle"), paragraphs(editorial.history))}${section("influence", label("influenceTitle"), paragraphs(editorial.influence))}</div>
    ${section("artists", label("artistsTitle"), artists ? `<ul class="artist-grid">${artists}</ul>` : "")}
    ${section("venues", label("venuesTitle"), venues ? `<ul class="artist-grid">${venues}</ul>` : "")}
    ${section("performing-artists", label("performingArtistsTitle"), performing ? `<ul class="artist-grid">${performing}</ul>` : "")}
    ${section("sources", label("sourcesTitle"), (editorial.sources || []).map((row) => `<p>${external(row.url, row.title)}</p>`).join(""))}
  </main>`;
}

export function projectCityDirectoryDocument({ cities = [], copy = {} } = {}, { origin = "https://www.mshpit.com" } = {}) {
  copy = { ...DEFAULT_CITY_COPY, ...copy };
  const canonicalPath = "/cities", canonicalUrl = new URL(canonicalPath, origin).href;
  const items = cities.flatMap((row) => cityPath(row) ? [{ ...row, path: cityPath(row) }] : []).slice(0, 500);
  const heading = text(copy.citiesTitle, 180), description = text(copy.citiesDescription, 300);
  return { kind: "city-directory", siteName: "Mshpit", canonicalPath, canonicalUrl, heading,
    title: `${text(copy.citiesSeoTitle, 180) || heading} | Mshpit`, description, indexable: items.some((row) => row.venueCount || row.upcomingCount || row.hasEditorial),
    cityDirectory: { cities: items, copy }, jsonLd: [{
      "@context": "https://schema.org", "@type": "CollectionPage", "@id": canonicalUrl, name: heading, description, url: canonicalUrl,
      mainEntity: { "@type": "ItemList", numberOfItems: items.length, itemListElement: items.map((row, index) => ({
        "@type": "ListItem", position: index + 1, name: [row.city, row.region, row.country || row.countryCode].filter(Boolean).join(", "), url: new URL(row.path, origin).href,
      })) },
    }] };
}

export function renderCityDirectoryMain(document) {
  const { cities, copy } = document.cityDirectory;
  return `<main id="main" class="city-guide city-directory"><section class="hero"><h1>${esc(document.heading)}</h1><p>${esc(document.description)}</p></section><section class="section"><ul class="artist-grid">${cities.map((row) => `<li><h2>${link(row.path, row.city)}</h2><p>${esc([row.region, row.country || row.countryCode].filter(Boolean).join(", "))}</p><p>${esc(String(copy.venueCount || "").replaceAll("{count}", row.venueCount || 0))} · ${esc(String(copy.upcomingCount || "").replaceAll("{count}", row.upcomingCount || 0))}</p></li>`).join("")}</ul></section></main>`;
}
