import test from "node:test";
import assert from "node:assert/strict";
import { buildCalendarDocument, calendarExportFileName, foldCalendarLine, normalizeCalendarEvent } from "./calendarExport.mjs";
import { memberCalendarModel } from "./calendarShows.mjs";

const unfold = (text) => text.replace(/\r\n[ \t]/g, "");

test("calendar export creates a truthful all-day event and escapes authored text", () => {
  const text = buildCalendarDocument({
    artist: "Boys, Noise; Live",
    venue: "Lee's Palace",
    city: "Toronto",
    date: "2026 · 09 · 18",
    ticketUrl: "https://www.ticketmaster.ca/show?a=1",
  }, { now: new Date("2026-08-21T12:00:00.000Z") });
  assert.match(text, /DTSTART;VALUE=DATE:20260918\r\n/);
  assert.match(text, /DTEND;VALUE=DATE:20260919\r\n/);
  assert.match(text, /SUMMARY:Boys\\, Noise\\; Live at Lee's Palace/);
  assert.match(text, /LOCATION:Lee's Palace\\, Toronto/);
  assert.match(text, /DTSTAMP:20260821T120000Z/);
  assert.match(text, /URL:https:\/\/www\.ticketmaster\.ca\/show\?a=1/);
  assert.ok(text.endsWith("END:VCALENDAR\r\n"));
});

test("calendar export deduplicates the same performance and handles year rollover", () => {
  const show = { artist: "PUP", venue: "Danforth Music Hall", date: "2026-12-31" };
  const text = buildCalendarDocument([show, { ...show }], { now: "2026-08-21T00:00:00Z" });
  assert.equal((text.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.match(text, /DTEND;VALUE=DATE:20270101/);
  assert.equal(calendarExportFileName(show), "pit-pup-2026-12-31.ics");
  assert.equal(calendarExportFileName([show, { artist: "METZ", date: "2026-10-02" }]), "pit-going-shows.ics");
});

test("calendar export rejects incomplete events and unsafe ticket destinations", () => {
  assert.equal(normalizeCalendarEvent({ artist: "PUP", date: "not a date" }), null);
  const unsafeUrls = [
    "javascript:alert(1)",
    "http://tickets.artist-site.com/show",
    "https://localhost/show",
    "https://user:password@www.ticketmaster.ca/show",
    "https://www.ticketmaster.ca:8443/show",
  ];
  for (const ticketUrl of unsafeUrls) {
    const event = normalizeCalendarEvent({ artist: "PUP", date: "2026-10-02", ticketUrl });
    assert.equal(event.ticketUrl, "", ticketUrl);
  }
  assert.throws(() => buildCalendarDocument({ artist: "", date: "2026-10-02" }), /valid artist and date/i);
});

test("calendar export omits an unconfirmed custom ticket hostname", () => {
  const ticketUrl = "https://tickets.artist-site.com/world-tour";
  const event = { artist: "PUP", date: "2026-10-02", ticketUrl };
  assert.equal(normalizeCalendarEvent(event).ticketUrl, "");
  const text = buildCalendarDocument(event, { now: "2026-08-21T00:00:00Z" });
  assert.doesNotMatch(text, /tickets\.artist-site\.com/);
  assert.match(text, /DESCRIPTION:Concert saved from PIT\. Start time not announced\.\r\n/);
});

test("calendar export retains an explicitly confirmed custom ticket hostname", () => {
  const ticketUrl = "https://tickets.artist-site.com/world-tour";
  const event = { artist: "PUP", date: "2026-10-02", ticketUrl };
  const normalized = normalizeCalendarEvent(event, { confirmedTicketUrls: [ticketUrl] });
  assert.equal(normalized.ticketUrl, ticketUrl);
  const text = buildCalendarDocument(event, {
    now: "2026-08-21T00:00:00Z",
    confirmedTicketUrls: [ticketUrl],
  });
  assert.match(unfold(text), /DESCRIPTION:Concert saved from PIT\. Start time not announced\. Tickets: https:\/\/tickets\.artist-/);
  assert.match(text, /URL:https:\/\/tickets\.artist-site\.com\/world-tour/);
});

test("calendar lines fold at 75 UTF-8 octets without splitting Unicode", () => {
  const folded = foldCalendarLine(`SUMMARY:${"🔥".repeat(30)} ${"loud".repeat(20)}`);
  const lines = folded.split("\r\n");
  assert.ok(lines.length > 1);
  assert.ok(lines.slice(1).every((line) => line.startsWith(" ")));
  assert.ok(lines.every((line) => Buffer.byteLength(line, "utf8") <= 75));
});

test("same artist and venue performances export separately at their real start times", () => {
  const base = { artist: "James Carter", venue: "Blue Note", date: "2026-11-10", eventTimezone: "Europe/London" };
  const early = { ...base, id: "tm_early", startLocalTime: "19:00" };
  const late = { ...base, id: "tm_late", startLocalTime: "21:30" };
  const document = buildCalendarDocument([early, late, { ...late }]);
  assert.equal((document.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.match(document, /DTSTART:20261110T190000Z/);
  assert.match(document, /DTSTART:20261110T213000Z/);
  assert.doesNotMatch(document, /DTEND:/, "unknown duration must not be invented");
  assert.notEqual(normalizeCalendarEvent(early).uid, normalizeCalendarEvent(late).uid);
  assert.equal(normalizeCalendarEvent(early).uid, normalizeCalendarEvent({ ...early, date: "2026-11-12", startLocalTime: "20:00" }).uid, "rescheduling one exact event retains its UID");
});

test("verified explicit start and end export as UTC including the next UTC date", () => {
  const document = buildCalendarDocument({ artist: "Band", date: "2026-11-10", startDateTime: "2026-11-10T23:30:00-08:00", endDateTime: "2026-11-11T01:30:00-08:00", eventTimezone: "America/Los_Angeles" });
  assert.match(document, /DTSTART:20261111T073000Z/);
  assert.match(document, /DTEND:20261111T093000Z/);
  assert.doesNotMatch(document, /TZID|VALUE=DATE/);
});

test("unknown and ambiguous clocks export transparent day placeholders with honest notes", () => {
  const event = { artist: "Band", date: "2026-11-01", startLocalTime: "01:30", eventTimezone: "America/New_York" };
  const document = unfold(buildCalendarDocument(event));
  assert.match(document, /DTSTART;VALUE=DATE:20261101/);
  assert.match(document, /TRANSP:TRANSPARENT/);
  assert.match(document, /Start time unconfirmed: 01:30:00 \(America\/New_York\)/);
  assert.doesNotMatch(document, /DTSTART:|T200000/);
});

test("a three-day festival produces one export spanning the final date inclusively", () => {
  const festival = { id: "festival-1", artist: "Festival", venue: "Park", date: "2026-12-30", eventEndDate: "2027-01-01", startDateTime: "2026-12-30T18:00:00Z" };
  const model = memberCalendarModel({ today: "2026-12-31", upcoming: [festival] });
  assert.equal(model.upcoming.length, 1);
  const document = unfold(buildCalendarDocument(Object.values(model.byDay.upcoming).flat()));
  assert.equal((document.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.match(document, /DTSTART;VALUE=DATE:20261230/);
  assert.match(document, /DTEND;VALUE=DATE:20270102/);
  assert.match(document, /End time unconfirmed/);
});

test("text, identifiers and timezone injection cannot add ICS properties or expose private provenance", () => {
  const document = unfold(buildCalendarDocument({
    id: "id\r\nATTENDEE:intruder@example.com",
    artist: "Band\r\nBEGIN:VALARM\r\nACTION:DISPLAY",
    venue: "Hall\nORGANIZER:intruder@example.com",
    date: "2026-11-10", startLocalTime: "19:00", eventTimezone: "Europe/London\r\nATTENDEE:intruder@example.com",
    visibility: "private", checkedInAt: 123, postId: "private-post-id", review: "private review",
    eventStatus: "cancelled\r\nATTENDEE:intruder@example.com",
  }, { calendarName: "PIT\r\nBEGIN:VALARM" }));
  const lines = document.split("\r\n");
  assert.equal(lines.filter((line) => line === "BEGIN:VEVENT").length, 1);
  assert.ok(!lines.some((line) => /^(ATTENDEE|ORGANIZER|ACTION|BEGIN:VALARM)/.test(line)));
  assert.doesNotMatch(document, /private-post-id|private review|checkedInAt|visibility/);
});
