import test from "node:test";
import assert from "node:assert/strict";
import { buildCalendarDocument, calendarExportFileName, foldCalendarLine, normalizeCalendarEvent } from "./calendarExport.mjs";

test("calendar export creates a truthful all-day event and escapes authored text", () => {
  const text = buildCalendarDocument({
    artist: "Boys, Noise; Live",
    venue: "Lee's Palace",
    city: "Toronto",
    date: "2026 · 09 · 18",
    ticketUrl: "https://tickets.example/show?a=1",
  }, { now: new Date("2026-08-21T12:00:00.000Z") });
  assert.match(text, /DTSTART;VALUE=DATE:20260918\r\n/);
  assert.match(text, /DTEND;VALUE=DATE:20260919\r\n/);
  assert.match(text, /SUMMARY:Boys\\, Noise\\; Live at Lee's Palace/);
  assert.match(text, /LOCATION:Lee's Palace\\, Toronto/);
  assert.match(text, /DTSTAMP:20260821T120000Z/);
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

test("calendar export rejects incomplete events and unsafe ticket schemes", () => {
  assert.equal(normalizeCalendarEvent({ artist: "PUP", date: "not a date" }), null);
  const event = normalizeCalendarEvent({ artist: "PUP", date: "2026-10-02", ticketUrl: "javascript:alert(1)" });
  assert.equal(event.ticketUrl, "");
  assert.throws(() => buildCalendarDocument({ artist: "", date: "2026-10-02" }), /valid artist and date/i);
});

test("calendar lines fold at 75 UTF-8 octets without splitting Unicode", () => {
  const folded = foldCalendarLine(`SUMMARY:${"🔥".repeat(30)} ${"loud".repeat(20)}`);
  const lines = folded.split("\r\n");
  assert.ok(lines.length > 1);
  assert.ok(lines.slice(1).every((line) => line.startsWith(" ")));
  assert.ok(lines.every((line) => Buffer.byteLength(line, "utf8") <= 75));
});
