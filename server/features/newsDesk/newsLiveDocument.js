// The public page of a live event (/news/live/<slug>): what search engines
// and link previews read. Modelled on how the big outlets run award nights:
// a plain "<Show> Winners List (Updating Live)" title on a stable yearly URL,
// the whole list in the HTML, and a modified time that moves with every
// update. Structured data is a LiveBlogPosting (Google's live-coverage type)
// whose updates carry their own times.

const esc = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const safeHttps = (value) => (typeof value === "string" && /^https:\/\/[^\s"'<>]+$/u.test(value) ? value : null);
const iso = (at) => new Date(at).toISOString();
// Award shows are mostly US broadcasts, so times read in Eastern time.
const easternTime = (at) => `${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(at))} ET`;
const easternDate = (at) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric" }).format(new Date(at));

export const livePagePath = (slug) => `/news/live/${encodeURIComponent(slug)}`;

function pageTitle(event) {
  const hasWinners = event.winners?.total > 0;
  if (hasWinners) return event.live ? `${event.title} Winners List (Updating Live)` : `${event.title} Winners: Full List`;
  return event.live ? `${event.title}: Live Updates` : `${event.title}: Live Coverage Recap`;
}

function pageDescription(event) {
  const announced = (event.winners?.categories || []).filter((category) => category.winner);
  if (announced.length) {
    const lead = announced.slice(0, 3).map((category) => `${category.name}: ${category.winner}`).join("; ");
    const tail = event.live ? " Updated as each award is announced." : ` All ${event.winners.total} categories and nominees.`;
    return `Every ${event.title} winner. ${lead}.${tail}`.slice(0, 300);
  }
  if (event.winners?.total) return `${event.title} winners as they are announced, with every category and its nominees, plus live updates.`.slice(0, 300);
  const sources = [...new Set(event.items.filter((item) => item.kind === "report").map((item) => item.source))].slice(0, 3);
  return `Live updates from the ${event.title}${sources.length ? `, with reporting from ${sources.join(", ")}` : ""}.`.slice(0, 300);
}

// The winners as plain sentences, for the structured data's article body.
function articleBody(event) {
  const categories = event.winners?.categories || [];
  const lines = categories.map((category) => (category.winner
    ? `${category.name}: ${category.winner} (winner). Nominees: ${category.nominees.join(", ")}.`
    : `${category.name}: to be announced. Nominees: ${category.nominees.join(", ")}.`));
  return lines.join(" ").slice(0, 5000) || pageDescription(event);
}

export function projectLiveDocument({ origin = "https://www.mshpit.com", event } = {}) {
  if (!event?.slug) return null;
  const canonicalPath = livePagePath(event.slug);
  const canonicalUrl = new URL(canonicalPath, origin).href;
  const heading = pageTitle(event);
  const description = pageDescription(event);
  const organization = { "@type": "Organization", name: "Mshpit News", url: new URL("/news", origin).href };
  const updates = event.items.slice(0, 40);
  return {
    kind: "news-live",
    siteName: "Mshpit",
    heading,
    title: `${heading} | Mshpit`,
    description,
    canonicalPath,
    canonicalUrl,
    // A page with nothing on it yet is not worth a search result.
    indexable: event.winners?.total > 0 || event.items.length >= 3,
    publishedAt: event.startsAt,
    modifiedAt: event.updatedAt,
    live: event,
    jsonLd: [{
      "@context": "https://schema.org",
      "@type": "LiveBlogPosting",
      "@id": `${canonicalUrl}#live`,
      headline: heading.slice(0, 110),
      description,
      url: canonicalUrl,
      mainEntityOfPage: canonicalUrl,
      image: new URL("/og.png", origin).href,
      datePublished: iso(event.startsAt),
      dateModified: iso(event.updatedAt),
      coverageStartTime: iso(event.startsAt),
      coverageEndTime: iso(event.endsAt),
      author: organization,
      publisher: organization,
      articleBody: articleBody(event),
      liveBlogUpdate: updates.map((item, index) => ({
        "@type": "BlogPosting",
        headline: String(item.kind === "note" ? item.text : item.title).slice(0, 110),
        datePublished: iso(item.at),
        url: `${canonicalUrl}#update-${updates.length - index}`,
        author: item.kind === "note" ? organization : { "@type": "Organization", name: item.source },
        ...(item.kind === "report" && safeHttps(item.url) ? { citation: item.url } : {}),
      })),
    }, {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Mshpit", item: new URL("/", origin).href },
        { "@type": "ListItem", position: 2, name: "News", item: new URL("/news", origin).href },
        { "@type": "ListItem", position: 3, name: event.title, item: canonicalUrl },
      ],
    }],
  };
}

function winnersTable(event) {
  const categories = event.winners?.categories || [];
  if (!categories.length) return "";
  const rows = categories.map((category) => `<tr>
        <th scope="row">${esc(category.name)}</th>
        <td class="winner">${category.winner ? esc(category.winner) : '<span class="pending">To be announced</span>'}</td>
        <td><ul class="nominees">${category.nominees.map((name) => `<li${category.winner === name ? ' class="won"' : ""}>${esc(name)}</li>`).join("")}</ul></td>
      </tr>`).join("");
  return `<section class="section" aria-labelledby="winners-heading">
      <h2 id="winners-heading">Winners</h2>
      <p class="muted">${esc(`${event.winners.announced} of ${event.winners.total} categories announced`)}</p>
      <table class="winners"><thead><tr><th scope="col">Category</th><th scope="col">Winner</th><th scope="col">Nominees</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </section>`;
}

function updatesList(event) {
  if (!event.items.length) return "";
  const items = event.items.map((item, index) => {
    const text = item.kind === "note" ? esc(item.text)
      : safeHttps(item.url) ? `<a href="${esc(item.url)}" rel="nofollow noopener noreferrer">${esc(item.title)}</a>` : esc(item.title);
    return `<li id="update-${event.items.length - index}"><p class="eyebrow"><time datetime="${esc(iso(item.at))}">${esc(easternTime(item.at))}</time> · ${esc(item.source)}</p><p>${text}</p></li>`;
  }).join("");
  return `<section class="section" aria-labelledby="updates-heading"><h2 id="updates-heading">Live updates</h2><ol class="live-updates">${items}</ol></section>`;
}

export function renderLiveMain(document) {
  if (document?.kind !== "news-live") return null;
  const event = document.live;
  return `<main id="main" class="news-live-page">
    <nav class="breadcrumbs" aria-label="Breadcrumb"><ol><li><a href="/">Mshpit</a></li><li><a href="/news">News</a></li><li><span aria-current="page">${esc(event.title)}</span></li></ol></nav>
    <section class="hero"><p class="eyebrow">${event.live ? '<span class="live-badge">Live</span> Updating' : "Coverage recap"} · ${esc(easternDate(event.startsAt))}</p>
      <h1>${esc(document.heading)}</h1><p>${esc(document.description)}</p>
      <p class="muted">Last updated <time datetime="${esc(iso(event.updatedAt))}">${esc(`${easternDate(event.updatedAt)}, ${easternTime(event.updatedAt)}`)}</time>.</p></section>
    ${winnersTable(event)}
    ${updatesList(event)}
    <p class="muted"><a href="/news">More music news</a></p>
  </main>`;
}

export const LIVE_STYLES = `.live-badge{display:inline-block;background:var(--rose);color:#0b0a09;border-radius:999px;padding:.05rem .55rem;margin-right:.35rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase}
  .winners{width:100%;border-collapse:collapse;margin-top:.6rem}.winners th,.winners td{padding:.75rem .6rem;border-top:1px solid var(--line);vertical-align:top;text-align:left}
  .winners thead th{color:var(--muted);font-size:.78rem;letter-spacing:.1em;text-transform:uppercase;border-top:0}.winners tbody th{width:28%;font-weight:700}
  .winners td.winner{width:30%;color:var(--gold);font-weight:800}.winners .pending{color:var(--muted);font-weight:400}
  .nominees{list-style:none;margin:0;padding:0;color:#d8d0c5}.nominees li{padding:.1rem 0}.nominees li.won{color:var(--gold);font-weight:700}
  .live-updates{list-style:none;margin:0;padding:0}.live-updates li{padding:.8rem 0;border-top:1px solid var(--line)}.live-updates p{margin:.15rem 0}
  @media (max-width:680px){.winners thead{display:none}.winners tr{display:block;border-top:1px solid var(--line);padding:.7rem 0}
  .winners th,.winners td{display:block;width:auto!important;border:0;padding:.15rem 0}}`;
