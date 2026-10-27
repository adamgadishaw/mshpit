// Explicitly reviewed official announcements, separate from provider events.
// No provider ID, ticket availability, lineup, or member planning is invented.
const ANNOUNCEMENTS = Object.freeze({
  "boots-and-hearts": Object.freeze({
    name: "Boots and Hearts 2027", startDate: "2027-08-06", endDate: "2027-08-08",
    venue: "Burl's Creek", city: "Oro-Medonte", region: "ON", countryCode: "CA",
    source: Object.freeze({ label: "Official site", url: "https://bootsandhearts.com/", checkedAt: "2026-10-27" }),
  }),
});

export function festivalAnnouncement(slug, today) {
  const announcement = ANNOUNCEMENTS[slug];
  return announcement && announcement.endDate >= today ? announcement : null;
}
