import { editionDays, FESTIVAL_LINEUP_LIMIT } from "./festivalEditions.js";

// Exact, reviewed edition announcement. Ticketmaster's three VELD result rows
// all repeat the phase-one bill and lead to the same Front Gate destination,
// so those repeated dates are not independent evidence of an artist's day.
// https://www.ticketmaster.ca/veld-music-festival-tickets/artist/2089227?tt_scene=anchor_view
const VELD_SOURCE = Object.freeze({
  label: "VELD Music Festival lineup announcement",
  url: "https://www.instagram.com/p/Df90c-4ts4M/",
  publishedDate: "2026-11-20",
  scope: "edition",
});
const VELD_MAINSTAGE = ["Alesso", "Chris Lake", "deadmau5", "Loud Luxury", "Martin Garrix", "Zedd"];
const VELD_ADDITIONS = [
  "Alan Walker", "ALLEYCVT", "ARMNHMR", "AYYBO", "Bob Moses", "BUNT.", "CamelPhat", "COSTA", "Devault", "Excision",
  "Gravagerz", "Green Velvet", "Gryffin", "Ian Asher", "Jessica Audiffred", "JOA", "Lavern", "LAYZ", "MEDUZA",
  "NGHTMRE", "Nico Moreno", "Novah", "Richard Finger", "RØZ", "Seven Lions b2b Dabin", "Sippy", "Space 92",
  "Sullivan King", "Tinlicker", "Tomas Grey", "Trivecta", "TWINSICK", "TYNAN", "William Black", "Wooli", "Youna", "Zachh",
  "CPARK", "Deecee B2B Quim", "Dirtyhappy", "LukaV", "Manzone & Strong", "Nader", "Nunchux", "Pedro",
];
const VELD_BILLINGS = new Map([
  ["deadmau5", "deadmau5 (RETRO5PECTIVE)"], ["bob moses", "Bob Moses (Club Set)"], ["tinlicker", "Tinlicker (DJ Set)"],
]);
const key = (value) => String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ");
const billedKey = (name) => key(name).replace(/\s+\((?:retro5pective|club set|dj(?: set)?)\)$/u, "");

export function reviewedFestivalLineup(edition) {
  if (edition.festivalSlug !== "veld" || edition.startDate !== "2027-07-30" || edition.endDate !== "2027-08-01"
    || key(edition.city) !== "toronto" || key(edition.countryCode) !== "ca"
    || !["downsview park", "downsview park toronto"].includes(key(edition.venue))) return null;

  const days = editionDays(edition.startDate, edition.endDate);
  const source = Array.isArray(edition.lineup) ? edition.lineup : [];
  const acts = new Map(source.filter(act => act?.name).map(act => [billedKey(act.name), act]));
  // Recognize only the exact replicated phase-one pattern, not a newly
  // differentiated provider schedule or a genuine multiple-day performance.
  const duplicatedPhaseOne = VELD_MAINSTAGE.every(name => {
    const assigned = acts.get(key(name))?.days;
    return Array.isArray(assigned) && assigned.length === days.length && days.every(day => assigned.includes(day));
  });
  const lineup = [...VELD_MAINSTAGE, ...VELD_ADDITIONS].map(name => {
    const id = key(name), act = acts.get(id);
    acts.delete(id);
    const assigned = duplicatedPhaseOne && VELD_MAINSTAGE.includes(name) ? [] : (act?.days || []).filter(day => days.includes(day));
    const billing = VELD_BILLINGS.get(id);
    return { name: act?.name || name, days: assigned, ...(billing ? { billing } : {}) };
  });
  return {
    lineup: [...lineup, ...acts.values()].slice(0, FESTIVAL_LINEUP_LIMIT),
    source: VELD_SOURCE,
  };
}
