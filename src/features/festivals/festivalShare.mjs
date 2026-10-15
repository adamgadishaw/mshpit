import { festivalDateRange, festivalDayLabel, festivalPlace } from "./festivalFormat.mjs";

// Share sheet models for a festival (the share modal's shape): the lineup
// poster, or the member's plan ("going Fri and Sat, won't miss ..."). The
// server renders the story image from the same festival, edition and plan.
const ORIGIN = "https://www.mshpit.com";
const SLUG = /^[a-z0-9-]{1,80}$/u;
const clean = (value, max = 160) => String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, max);

export function buildFestivalShareModel({ festival, edition, plan = null, intent = "lineup", author = null } = {}) {
  if (!SLUG.test(String(festival?.slug || "")) || !edition?.id || !["lineup", "going"].includes(intent)) return null;
  if (intent === "going" && !plan?.days?.length) return null;
  const name = clean(edition.name || festival.name);
  const url = `${ORIGIN}/festival/${festival.slug}`;
  const when = festivalDateRange(edition.startDate, edition.endDate);
  const place = festivalPlace(edition);
  const who = clean(author?.name, 100) || "A Mshpit fan";
  const days = intent === "going" ? plan.days.map((day) => festivalDayLabel(day)).join(" and ") : "";
  const mustSee = intent === "going" ? (plan.mustSee || []).slice(0, 4) : [];
  const headline = intent === "going"
    ? `${who} is going to ${name}${days ? ` (${days})` : ""}`
    : `${name} lineup: ${(edition.headliners || []).slice(0, 4).join(", ")}`;
  return Object.freeze({
    kind: intent === "going" ? "going" : "news",
    id: `${edition.id}:${intent}`,
    eyebrow: intent === "going" ? "GOING" : "FESTIVAL LINEUP",
    title: name,
    contextTitle: null,
    venue: edition.venue || null,
    city: edition.city || null,
    place: place || null,
    dateLabel: when || null,
    timeLabel: null,
    authorName: intent === "going" ? who : null,
    rating: null,
    quote: mustSee.length ? `Won't miss: ${mustSee.join(", ")}` : null,
    artworkUri: null,
    url,
    renderRequest: Object.freeze({ kind: "festival", slug: festival.slug, editionId: edition.id, intent }),
    shareText: [headline, when, place].filter(Boolean).join(" · "),
    accessibilityLabel: [headline, when, place].filter(Boolean).join(". "),
  });
}
