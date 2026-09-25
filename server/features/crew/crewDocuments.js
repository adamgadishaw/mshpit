import { CREW_PURPOSES, crewCountLabel } from "../../../src/domain/crew.mjs";

// The public /crew page: what Crew is, how it keeps people safe, and which
// upcoming shows people are finding a crew for right now. Counts only, never
// who. Search engines index it for "find someone to go to a concert with".

const esc = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const safePath = (value) => (typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : null);
const count = (value) => (Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0);

export const CREW_STEPS = Object.freeze([
  Object.freeze({ title: "Swipe through shows", text: "Upcoming concerts near you, one card at a time. Right if you're going, up if you're interested, left to skip." }),
  Object.freeze({ title: "Say you want a crew", text: "Pick what you're after: meet before doors, share a ride, split a hotel, trade a spare ticket or find someone for the pit." }),
  Object.freeze({ title: "Crew up", text: "Swipe through other fans going to the same show. When you both say yes, you're a crew and your chat opens." }),
]);

export const CREW_FAQ = Object.freeze([
  Object.freeze({ q: "How do I find someone to go to a concert with?", a: "Open Crew on Mshpit, say you're going to a show, and turn on Looking for a crew. You'll see other fans looking for a crew for that same show. When you both say yes, you can message each other and make a plan." }),
  Object.freeze({ q: "Who can see me?", a: "Only other adults who are looking for a crew for the same show. Nobody finds out you said yes unless they said yes too, and you can stop looking at any time to disappear from the list." }),
  Object.freeze({ q: "Is Crew safe?", a: "Crew is for adults 18 and over with a confirmed email. Blocking hides people from each other everywhere on Mshpit, and every profile can be reported. Meet in public, tell a friend your plans and trust your gut." }),
  Object.freeze({ q: "Does it cost anything?", a: "No. Crew is free, like the rest of Mshpit." }),
]);

function breadcrumbs(origin, canonicalPath) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Mshpit", item: new URL("/", origin).href },
      { "@type": "ListItem", position: 2, name: "Crew", item: new URL(canonicalPath, origin).href },
    ],
  };
}

// `shows` are already public events: { name, artist, venue, place, date, path,
// going, lookingForCrew }. Anything without a safe public path is dropped.
export function projectCrewDocument({ origin = "https://www.mshpit.com", shows = [] } = {}) {
  const canonicalPath = "/crew";
  const canonicalUrl = new URL(canonicalPath, origin).href;
  const listed = (Array.isArray(shows) ? shows : []).map((show) => ({
    name: String(show?.name || "").slice(0, 200),
    artist: String(show?.artist || "").slice(0, 160),
    venue: String(show?.venue || "").slice(0, 180),
    place: String(show?.place || "").slice(0, 120),
    date: /^\d{4}-\d{2}-\d{2}$/u.test(String(show?.date || "")) ? show.date : "",
    path: safePath(show?.path),
    going: count(show?.going),
    lookingForCrew: count(show?.lookingForCrew),
  })).filter((show) => show.path && show.artist && show.date).slice(0, 24);
  const description = "Never go to a concert alone. Swipe through upcoming shows, find fans going to the same one, and meet before doors, share a ride or split a hotel. Free on Mshpit.";
  return {
    kind: "crew",
    siteName: "Mshpit",
    heading: "Never go to a show alone",
    title: "Find people to go to concerts with | Mshpit Crew",
    description,
    canonicalPath,
    canonicalUrl,
    indexable: true,
    imageAlt: "Mshpit Crew: find people to go to concerts with",
    crew: { shows: listed },
    jsonLd: [{
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": `${canonicalUrl}#page`,
      name: "Mshpit Crew",
      url: canonicalUrl,
      description,
      isPartOf: { "@type": "WebSite", name: "Mshpit", url: new URL("/", origin).href },
      ...(listed.length ? { mainEntity: {
        "@type": "ItemList",
        name: "Shows fans are finding a crew for",
        numberOfItems: listed.length,
        itemListElement: listed.map((show, index) => ({
          "@type": "ListItem", position: index + 1, name: show.name || `${show.artist} at ${show.venue}`, url: new URL(show.path, origin).href,
        })),
      } } : {}),
    }, {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: CREW_FAQ.map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } })),
    }, breadcrumbs(origin, canonicalPath)],
  };
}

const longDate = (value) => {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.valueOf())
    ? date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
    : value;
};

export function renderCrewMain(document) {
  if (document?.kind !== "crew") return null;
  const shows = document.crew?.shows || [];
  return `<main id="main" class="crew-page">
    <nav class="breadcrumbs" aria-label="Breadcrumb"><ol><li><a href="/">Mshpit</a></li><li><span aria-current="page">Crew</span></li></ol></nav>
    <section class="hero"><p class="eyebrow">Mshpit Crew</p><h1>Never go to a show <em>alone</em></h1>
      <p class="hero-copy">${esc(document.description)}</p>
      <div class="actions"><a class="button primary" href="/crew">Find my crew</a><a class="button" href="/events">Browse upcoming shows</a></div></section>
    <section class="section"><div class="section-heading"><div><p class="eyebrow">How it works</p><h2>Three swipes to a crew</h2></div></div>
      <ol class="updates">${CREW_STEPS.map((step, index) => `<li class="update"><p class="eyebrow">Step ${index + 1}</p><h3>${esc(step.title)}</h3><p>${esc(step.text)}</p></li>`).join("")}</ol></section>
    <section class="section"><div class="section-heading"><div><p class="eyebrow">What people look for</p><h2>More than a plus one</h2></div></div>
      <p class="hero-copy">${Object.values(CREW_PURPOSES).map(esc).join(" · ")}</p></section>
    ${shows.length ? `<section class="section"><div class="section-heading"><div><p class="eyebrow">Happening soon</p><h2>Shows fans are finding a crew for</h2></div></div>
      <ul class="event-list">${shows.map((show) => `<li><time datetime="${esc(show.date)}">${esc(longDate(show.date))}</time><div><h3><a href="${esc(show.path)}">${esc(show.artist)}</a></h3><p class="muted">${esc([show.venue, show.place].filter(Boolean).join(" · "))}</p></div><span class="pill">${esc(show.lookingForCrew ? crewCountLabel(show.lookingForCrew, "crew") : crewCountLabel(show.going, "going"))}</span></li>`).join("")}</ul></section>` : ""}
    <section class="section"><div class="section-heading"><div><p class="eyebrow">Questions</p><h2>Before you crew up</h2></div></div>
      ${CREW_FAQ.map((item) => `<h3>${esc(item.q)}</h3><p class="post-copy">${esc(item.a)}</p>`).join("")}</section>
  </main>`;
}
