import { editionDays } from "./festivalEditions.js";

// The public pages search engines and link previews read: one per festival
// (/festival/<slug>) and the festivals hub (/festivals). A festival page leads
// with its next edition: "<Name> <year> Lineup, Dates & Tickets", the lineup
// by day in the HTML, and Festival structured data (an Event type) with its
// dates, place, performers and ticket link.

const esc = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const safeHttps = (value) => (typeof value === "string" && /^https:\/\/[^\s"'<>]+$/u.test(value) ? value : null);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const at = (value) => new Date(`${value}T00:00:00Z`);

export const festivalPagePath = (slug) => `/festival/${encodeURIComponent(slug)}`;
export const FESTIVALS_HUB_PATH = "/festivals";

export function festivalDateRange(startDate, endDate) {
  if (!startDate) return "";
  const start = at(startDate);
  const end = endDate && endDate > startDate ? at(endDate) : null;
  const month = (value) => MONTHS[value.getUTCMonth()];
  if (!end) return `${month(start)} ${start.getUTCDate()}, ${start.getUTCFullYear()}`;
  if (start.getUTCFullYear() !== end.getUTCFullYear()) return `${month(start)} ${start.getUTCDate()}, ${start.getUTCFullYear()} to ${month(end)} ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
  if (start.getUTCMonth() === end.getUTCMonth()) return `${month(start)} ${start.getUTCDate()} to ${end.getUTCDate()}, ${start.getUTCFullYear()}`;
  return `${month(start)} ${start.getUTCDate()} to ${month(end)} ${end.getUTCDate()}, ${start.getUTCFullYear()}`;
}

const place = (edition) => [edition.venue, [edition.city, edition.region].filter(Boolean).join(", ")].filter(Boolean).join(", ");

function heading(page) {
  const edition = page.upcoming[0];
  const name = page.festival.name;
  if (edition) {
    const year = edition.startDate.slice(0, 4);
    const named = name.toLowerCase().includes(year) ? name : `${name} ${year}`;
    return edition.lineup?.length ? `${named} Lineup, Dates & Tickets` : `${named}: Dates & Tickets`;
  }
  if (page.expected) return `${name} ${page.expected.year}: Expected Dates, Lineup & History`;
  return `${name}: Lineups, History & Fan Reviews`;
}

function description(page) {
  const edition = page.upcoming[0];
  const name = page.festival.name;
  if (edition) {
    const lead = edition.lineup?.slice(0, 4).map((act) => act.name).join(", ");
    const days = edition.days?.length > 1 ? `${edition.days.length} days` : "one day";
    return [`${name} runs ${festivalDateRange(edition.startDate, edition.endDate)}${place(edition) ? ` at ${place(edition)}` : ""}, ${days}.`,
      lead ? `Lineup includes ${lead}${edition.lineupCount > 4 ? ` and ${edition.lineupCount - 4} more` : ""}.` : "Lineup to be announced.",
      "See the lineup by day, tickets and who's going."].join(" ").slice(0, 300);
  }
  if (page.expected) {
    return `${name} is expected in ${page.expected.label.replace(/^Expected /u, "")}, based on the last edition (${festivalDateRange(page.expected.basis.startDate, page.expected.basis.endDate)}). Past lineups, history and fan reviews.`.slice(0, 300);
  }
  return `${name}: history, past editions and fan reviews on Mshpit.`.slice(0, 300);
}

export function projectFestivalDocument({ origin = "https://www.mshpit.com", page } = {}) {
  if (!page?.festival?.slug) return null;
  const canonicalPath = festivalPagePath(page.festival.slug);
  const canonicalUrl = new URL(canonicalPath, origin).href;
  const title = heading(page);
  const edition = page.upcoming[0] || null;
  const jsonLd = [];
  for (const item of page.upcoming.slice(0, 3)) {
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": "Festival",
      "@id": `${canonicalUrl}#${encodeURIComponent(item.id)}`,
      name: item.name,
      url: canonicalUrl,
      startDate: item.startDate,
      endDate: item.endDate || item.startDate,
      eventStatus: "https://schema.org/EventScheduled",
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      description: description({ ...page, upcoming: [item] }),
      ...(safeHttps(item.imageUrl) ? { image: [item.imageUrl] } : {}),
      location: {
        "@type": "Place",
        name: item.venue || item.city || page.festival.name,
        address: { "@type": "PostalAddress", ...(item.city ? { addressLocality: item.city } : {}), ...(item.region ? { addressRegion: item.region } : {}),
          ...(item.countryCode ? { addressCountry: item.countryCode } : {}) },
      },
      ...(item.lineup?.length ? { performer: item.lineup.slice(0, 30).map((act) => ({ "@type": "PerformingGroup", name: act.name })) } : {}),
      ...(safeHttps(item.ticketUrl) ? { offers: { "@type": "Offer", url: item.ticketUrl, availability: "https://schema.org/InStock" } } : {}),
      ...(safeHttps(page.festival.website) ? { sameAs: [page.festival.website] } : {}),
    });
  }
  jsonLd.push({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Mshpit", item: new URL("/", origin).href },
      { "@type": "ListItem", position: 2, name: "Festivals", item: new URL(FESTIVALS_HUB_PATH, origin).href },
      { "@type": "ListItem", position: 3, name: page.festival.name, item: canonicalUrl },
    ],
  });
  return {
    kind: "festival",
    siteName: "Mshpit",
    heading: title,
    title: `${title} | Mshpit`,
    description: description(page),
    canonicalPath,
    canonicalUrl,
    // Worth a search result once there is something to read.
    indexable: !!(edition || page.festival.about || page.past.length || page.reviews.length),
    ...(edition && safeHttps(edition.imageUrl) ? { image: edition.imageUrl } : {}),
    festivalPage: page,
    jsonLd,
  };
}

export function projectFestivalsHubDocument({ origin = "https://www.mshpit.com", upcoming = [], festivals = [] } = {}) {
  const canonicalUrl = new URL(FESTIVALS_HUB_PATH, origin).href;
  const lead = upcoming.slice(0, 3).map((edition) => edition.festivalName || edition.name).join(", ");
  return {
    kind: "festivals",
    siteName: "Mshpit",
    heading: "Music Festivals: Dates, Lineups & Tickets",
    title: "Music Festivals: Dates, Lineups & Tickets | Mshpit",
    description: `Upcoming music festivals with dates, lineups by day and tickets${lead ? `, including ${lead}` : ""}. See who's going and what fans said about past years.`.slice(0, 300),
    canonicalPath: FESTIVALS_HUB_PATH,
    canonicalUrl,
    indexable: upcoming.length >= 3,
    festivalsHub: { upcoming, festivals },
    jsonLd: [{
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Music festivals",
      url: canonicalUrl,
      mainEntity: {
        "@type": "ItemList",
        itemListElement: upcoming.slice(0, 50).map((edition, index) => ({
          "@type": "ListItem", position: index + 1, url: new URL(festivalPagePath(edition.festivalSlug), origin).href, name: edition.name,
        })),
      },
    }],
  };
}

function lineupHtml(edition) {
  if (!edition.lineup?.length) return '<p class="muted">The lineup has not been announced yet.</p>';
  const days = editionDays(edition.startDate, edition.endDate);
  const byDay = days.length > 1 && edition.lineup.some((act) => act.days?.length);
  if (!byDay) return `<p class="festival-lineup">${edition.lineup.map((act) => esc(act.name)).join(" · ")}</p>`;
  const sections = days.map((day) => {
    const acts = edition.lineup.filter((act) => act.days?.includes(day));
    if (!acts.length) return "";
    const date = at(day);
    return `<h3>${esc(`${WEEKDAYS[date.getUTCDay()]}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`)}</h3><p class="festival-lineup">${acts.map((act) => esc(act.name)).join(" · ")}</p>`;
  }).join("");
  const undated = edition.lineup.filter((act) => !act.days?.length);
  return `${sections}${undated.length ? `<h3>Day to be announced</h3><p class="festival-lineup">${undated.map((act) => esc(act.name)).join(" · ")}</p>` : ""}`;
}

export function renderFestivalMain(document) {
  if (document?.kind === "festivals") {
    const { upcoming } = document.festivalsHub;
    const items = upcoming.map((edition) => `<li><a href="${esc(festivalPagePath(edition.festivalSlug))}">${esc(edition.name)}</a>
      <span class="muted">${esc([festivalDateRange(edition.startDate, edition.endDate), place(edition)].filter(Boolean).join(" · "))}</span>
      ${edition.headliners?.length ? `<br><span>${esc(edition.headliners.join(" · "))}</span>` : ""}</li>`).join("");
    return `<main id="main">
      <nav class="breadcrumbs" aria-label="Breadcrumb"><ol><li><a href="/">Mshpit</a></li><li><span aria-current="page">Festivals</span></li></ol></nav>
      <section class="hero"><p class="eyebrow">Festivals</p><h1>${esc(document.heading)}</h1><p>${esc(document.description)}</p></section>
      <section class="section" aria-label="Upcoming festivals"><ol class="event-list">${items || "<li>No upcoming festivals are listed yet.</li>"}</ol></section>
    </main>`;
  }
  if (document?.kind !== "festival") return null;
  const page = document.festivalPage;
  const festival = page.festival;
  const edition = page.upcoming[0];
  const upcomingHtml = page.upcoming.map((item) => `<section class="section" aria-label="${esc(item.name)}">
      <h2>${esc(item.name)}</h2>
      <p><strong>${esc(festivalDateRange(item.startDate, item.endDate))}</strong>${place(item) ? ` · ${esc(place(item))}` : ""}</p>
      ${safeHttps(item.ticketUrl) ? `<p><a href="${esc(item.ticketUrl)}" rel="nofollow noopener noreferrer">Tickets</a></p>` : ""}
      ${lineupHtml(item)}
    </section>`).join("");
  const expectedHtml = !edition && page.expected ? `<section class="section"><h2>Next edition</h2><p>${esc(page.expected.label)}. Not announced yet; estimated from the last edition (${esc(festivalDateRange(page.expected.basis.startDate, page.expected.basis.endDate))}).</p></section>` : "";
  const aboutHtml = festival.about ? `<section class="section"><h2>About ${esc(festival.name)}</h2><p>${esc(festival.about)}</p>
      ${festival.foundedYear ? `<p>First held in ${esc(festival.foundedYear)}.</p>` : ""}
      ${festival.aboutSource?.url && safeHttps(festival.aboutSource.url) ? `<p class="muted">Source: <a href="${esc(festival.aboutSource.url)}" rel="noopener">Wikipedia</a>, ${esc(festival.aboutSource.license || "CC BY-SA 4.0")}.</p>` : ""}
    </section>` : "";
  const pastHtml = page.past.length ? `<section class="section"><h2>Past editions</h2><ul>${page.past.map((item) => `<li>${esc(festivalDateRange(item.startDate, item.endDate))}${place(item) ? `, ${esc(place(item))}` : ""}${item.headliners?.length ? `: ${esc(item.headliners.slice(0, 5).join(", "))}` : ""}</li>`).join("")}</ul></section>` : "";
  const reviewsHtml = page.reviews.length ? `<section class="section"><h2>Fan reviews</h2><ul>${page.reviews.map((review) => `<li><a href="/post/${esc(encodeURIComponent(review.postId))}">${esc(review.name)}</a> · ${esc(Number(review.overall).toFixed(1))} out of 5${review.review ? `: ${esc(review.review)}` : ""}</li>`).join("")}</ul></section>` : "";
  return `<main id="main">
    <nav class="breadcrumbs" aria-label="Breadcrumb"><ol><li><a href="/">Mshpit</a></li><li><a href="${FESTIVALS_HUB_PATH}">Festivals</a></li><li><span aria-current="page">${esc(festival.name)}</span></li></ol></nav>
    <section class="hero"><p class="eyebrow">Festival</p><h1>${esc(document.heading)}</h1><p>${esc(document.description)}</p></section>
    ${upcomingHtml}${expectedHtml}${aboutHtml}${pastHtml}${reviewsHtml}
    <p class="muted"><a href="${FESTIVALS_HUB_PATH}">More festivals</a></p>
  </main>`;
}

export const FESTIVAL_STYLES = `.festival-lineup{font-size:1.05rem;line-height:1.7;font-weight:700}
  .section h3{margin:.9rem 0 .2rem;font-size:.95rem;color:var(--gold)}`;
