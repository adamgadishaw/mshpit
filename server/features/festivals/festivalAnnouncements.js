// Primary-source dates, checked 2026-10-08. Date-only announcements supply no
// guessed time, lineup, ticket inventory, or database edition/plan identity.
import { editionDays } from "./festivalEditions.js";
export const FESTIVAL_ANNOUNCEMENTS = Object.freeze([
  Object.freeze({ festivalSlug: "boots-and-hearts", name: "Boots and Hearts 2027",
    startDate: "2027-08-06", endDate: "2027-08-08", venue: "Burl's Creek", city: "Oro-Medonte", region: "ON", countryCode: "CA",
    source: Object.freeze({ url: "https://bootsandhearts.com/", checkedOn: "2026-10-08" }) }),
]);
export function withFestivalAnnouncements(editions, { today, slug = null, phase = "upcoming" } = {}) {
  const out = editions.slice();
  for (const announcement of FESTIVAL_ANNOUNCEMENTS) {
    if ((slug && announcement.festivalSlug !== slug)
      || (phase !== "all" && (phase === "past" ? announcement.endDate >= today : announcement.endDate < today))) continue;
    // Official dates supersede provider dates for this single-place annual edition.
    const matching = out.filter((item) => item.festivalSlug === announcement.festivalSlug && item.startDate?.slice(0, 4) === announcement.startDate.slice(0, 4));
    for (const item of matching) out.splice(out.indexOf(item), 1);
    if (matching.length) {
      for (const saved of matching) {
        const exact = saved.startDate === announcement.startDate && saved.endDate === announcement.endDate;
        out.push({ ...saved, ...announcement, dateSource: announcement.source,
          days: editionDays(announcement.startDate, announcement.endDate),
          ...(!exact ? { lineup: [], lineupCount: 0, headliners: [], ticketUrl: null, lineupChangedAt: null } : {}) });
      }
      continue;
    }
    out.push({
      ...announcement, id: `announcement:${announcement.festivalSlug}:${announcement.startDate}`, dateOnly: true, dateSource: announcement.source,
      days: editionDays(announcement.startDate, announcement.endDate), lineup: [], lineupCount: 0, headliners: [], ticketUrl: null,
      imageUrl: null, imageAttribution: null, going: 0, goingByDay: {}, mustSee: [], plan: null,
    });
  }
  return out.sort((a, b) => a.startDate.localeCompare(b.startDate));
}
