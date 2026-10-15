// Live coverage of a big night (server/features/newsDesk/newsLive.js): what
// the readers' card shows, kept here so it can be tested without rendering.

const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");

function winnersFrom(winners) {
  const categories = (Array.isArray(winners?.categories) ? winners.categories : [])
    .filter((category) => category && typeof category.id === "string" && typeof category.name === "string")
    .map((category) => ({
      id: category.id,
      name: text(category.name, 120),
      nominees: (Array.isArray(category.nominees) ? category.nominees : []).filter((name) => typeof name === "string").map((name) => text(name, 160)),
      winner: typeof category.winner === "string" ? text(category.winner, 160) : null,
      announcedAt: Number(category.announcedAt) || null,
    }));
  return { total: categories.length, announced: categories.filter((category) => category.winner).length, categories };
}

export function liveEventFrom(event) {
  if (!event || typeof event.id !== "string" || typeof event.title !== "string") return null;
  return {
    id: event.id,
    slug: typeof event.slug === "string" && /^[a-z0-9-]{1,80}$/u.test(event.slug) ? event.slug : null,
    title: text(event.title, 80),
    live: event.live === true,
    winners: winnersFrom(event.winners),
    updatedAt: Number(event.updatedAt) || 0,
    count: Number(event.count) || 0,
    items: (Array.isArray(event.items) ? event.items : [])
      .filter((item) => item && typeof item.id === "string" && Number.isFinite(Number(item.at)))
      .map((item) => ({
        id: item.id,
        kind: item.kind === "note" ? "note" : "report",
        at: Number(item.at),
        text: text(item.kind === "note" ? item.text : item.title, 300),
        source: text(item.source, 60) || "Mshpit",
        url: typeof item.url === "string" && /^https:\/\//u.test(item.url) ? item.url : null,
      })),
  };
}

// Only well-formed events and items survive; anything else is dropped.
export function liveEventsFrom(payload) {
  return (Array.isArray(payload?.events) ? payload.events : []).map(liveEventFrom).filter(Boolean);
}

// Most recently announced first, for the card's short winners list.
export const latestWinners = (event, limit = 3) => event.winners.categories.filter((category) => category.winner)
  .sort((left, right) => (right.announcedAt || 0) - (left.announcedAt || 0)).slice(0, limit);

export const winnersProgressText = (event) => (event.winners.total
  ? `${event.winners.announced} of ${event.winners.total} categories announced` : "");

export const anyLive = (events) => events.some((event) => event.live);

export function sinceText(at, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

// "Live now · 14 updates · latest 3 min ago" / "Ended · 23 updates"
export function liveHeaderText(event, now = Date.now()) {
  const updates = event.count === 1 ? "1 update" : `${event.count} updates`;
  if (!event.live) return `Ended · ${updates}`;
  return event.count ? `Live now · ${updates} · latest ${sinceText(event.updatedAt, now)}` : "Live now · updates appear here as they land";
}
