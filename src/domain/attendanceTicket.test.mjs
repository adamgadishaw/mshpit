import assert from "node:assert/strict";
import test from "node:test";
import {
  attendanceTicketAuthorSentence,
  buildAttendanceTicketPreview,
  createAttendanceTicketClientMutationId,
  formatAttendanceTicketDate,
  formatAttendanceTicketTime,
  normalizeAttendanceTicketShow,
  normalizeSharedSeatLocation,
  safeAttendanceTicketImageUri,
} from "./attendanceTicket.mjs";

test("ticket publish mutation ids are bounded, opaque, and reproducible for a retry", () => {
  const first = createAttendanceTicketClientMutationId(123_456_789, 0.25);
  const retry = createAttendanceTicketClientMutationId(123_456_789, 0.25);
  const next = createAttendanceTicketClientMutationId(123_456_789, 0.75);

  assert.equal(first, retry);
  assert.notEqual(first, next);
  assert.match(first, /^p_local_ticket_[a-z0-9]+_[a-z0-9]+$/);
  assert.ok(first.length >= 8 && first.length <= 120);
});

test("builds a useful derived tour-title attendance preview without synthetic ticket data", () => {
  const preview = buildAttendanceTicketPreview({
    author: { name: "Adam" },
    show: {
      artistName: "Bruno Mars",
      eventName: "Bruno Mars: The Romantic Tour",
      tourName: "The Romantic Tour",
      venueName: "Rogers Stadium",
      city: "Toronto",
      startDateTime: "2026-09-12T19:30:00",
      artistImageUri: "https://media.example/bruno.jpg",
      seatLocation: { section: "118", row: "G", seat: "9" },
      orderNumber: "NEVER-EXPOSE",
      barcode: "NOT-A-TICKET",
    },
  });

  assert.deepEqual(preview, {
    kind: "attendance-ticket",
    version: 1,
    eventTitle: "Bruno Mars",
    contextTitle: "The Romantic Tour",
    isTourTitle: true,
    isSpecialEvent: false,
    venue: "Rogers Stadium",
    city: "Toronto",
    dateLabel: "SAT · SEP 12 · 2026",
    timing: [{ kind: "start", label: "SHOW START", value: "7:30 PM" }],
    imageUri: "https://media.example/bruno.jpg",
    authorSentence: "Adam is going to Bruno Mars for The Romantic Tour.",
    accessibilityLabel: "Adam is going to Bruno Mars for The Romantic Tour. The Romantic Tour Rogers Stadium, Toronto SAT · SEP 12 · 2026 show start 7:30 PM",
  });
  assert.equal("seatLocation" in preview, false);
  assert.equal("barcode" in preview, false);
  assert.equal("orderNumber" in preview, false);
  assert.equal("qr" in preview, false);
});

test("labels doors only when the source explicitly verifies that it is a doors time", () => {
  const verified = normalizeAttendanceTicketShow({
    artist: "Doechii",
    startDate: "2026-08-21",
    startLocalTime: "21:00:00",
    doorsOpenTime: "7:30 PM",
    doorsOpenVerified: true,
  });
  assert.deepEqual(verified.timing, [
    { kind: "doors", label: "VERIFIED DOORS", value: "7:30 PM" },
    { kind: "start", label: "SHOW START", value: "9:00 PM" },
  ]);

  const approximate = normalizeAttendanceTicketShow({
    artist: "Doechii",
    startLocalTime: "21:00:00",
    accessStartDateTime: "2026-08-21T23:30:00Z",
    eventTimezone: "America/Toronto",
    accessStartApproximate: true,
  });
  assert.deepEqual(approximate.timing, [
    { kind: "access", label: "ACCESS TIME · APPROX.", value: "7:30 PM" },
    { kind: "start", label: "SHOW START", value: "9:00 PM" },
  ]);

  const exactProviderAccess = normalizeAttendanceTicketShow({
    artist: "Doechii",
    accessStartDateTime: "2026-08-21T23:30:00Z",
    eventTimezone: "America/Toronto",
    accessStartApproximate: false,
  });
  assert.deepEqual(exactProviderAccess.timing, [
    { kind: "access", label: "ACCESS TIME", value: "7:30 PM" },
  ]);

  const legacyProviderAccess = normalizeAttendanceTicketShow({
    artist: "Doechii",
    doorsAt: "2026-08-21T23:30:00Z",
    doorsApproximate: false,
    eventTimezone: "America/Toronto",
  });
  assert.deepEqual(legacyProviderAccess.timing, [
    { kind: "access", label: "ACCESS TIME", value: "7:30 PM" },
  ], "an old unverified doorsAt alias remains access rather than becoming verified doors");
});

test("seat details are private by default and whitelisted only after explicit sharing", () => {
  const supplied = {
    section: "Floor A",
    row: "2",
    seat: "17",
    barcode: "hidden",
    orderId: "hidden",
    price: "$999",
  };
  assert.equal(normalizeSharedSeatLocation(supplied), null);
  assert.deepEqual(normalizeSharedSeatLocation(supplied, { shared: true }), {
    section: "Floor A",
    row: "2",
    seat: "17",
  });

  const preview = buildAttendanceTicketPreview({
    author: "Cloe",
    show: { artist: "Earl Sweatshirt", date: "2026-10-03" },
    seatLocation: supplied,
    shareSeatLocation: true,
  });
  assert.deepEqual(preview.seatLocation, { section: "Floor A", row: "2", seat: "17" });
  assert.match(preview.accessibilityLabel, /section Floor A, row 2, seat 17/);
});

test("artist artwork accepts safe explicit URIs and never falls back to event artwork", () => {
  assert.equal(safeAttendanceTicketImageUri("javascript:alert(1)"), null);
  assert.equal(safeAttendanceTicketImageUri("https://user:pass@example.com/private.jpg"), null);
  assert.equal(safeAttendanceTicketImageUri("https://cdn.example/artist.jpg"), "https://cdn.example/artist.jpg");
  assert.equal(safeAttendanceTicketImageUri("http://localhost:8081/artist.jpg"), "http://localhost:8081/artist.jpg");

  const normalized = normalizeAttendanceTicketShow({
    artist: "SZA",
    eventImageUri: "https://provider.example/event-poster.jpg",
    imageUrl: "https://provider.example/other.jpg",
  });
  assert.equal("artistImageUri" in normalized, false);
  assert.equal(normalizeAttendanceTicketShow({
    artist: "SZA",
    artistPhotoUri: "https://profiles.example/sza.jpg",
  }).artistImageUri, "https://profiles.example/sza.jpg");
});

test("special live events use the official event as the attendance object", () => {
  const preview = buildAttendanceTicketPreview({
    author: { displayName: "Nia" },
    show: {
      eventKind: "music_festival",
      eventName: "Lollapalooza",
      artistName: "Tyler, The Creator",
      venueName: "Grant Park",
      cityName: "Chicago",
      startDate: "2026-07-30",
    },
  });
  assert.equal(preview.eventTitle, "Lollapalooza");
  assert.equal(preview.artistName, "Tyler, The Creator");
  assert.equal(preview.authorSentence, "Nia is going to Lollapalooza.");
});

test("author copy removes a duplicated artist prefix from official provider titles", () => {
  assert.equal(attendanceTicketAuthorSentence({
    author: "Adam",
    show: {
      artistName: "Bruno Mars",
      eventName: "Bruno Mars: The Romantic Tour",
      tourName: "Bruno Mars: The Romantic Tour",
    },
  }), "Adam is going to Bruno Mars for The Romantic Tour.");
  assert.equal(attendanceTicketAuthorSentence({
    author: "Nia",
    show: {
      artistName: "Beyoncé",
      tourName: "COWBOY CARTER TOUR",
    },
  }), "Nia is going to Beyoncé for the COWBOY CARTER TOUR.");
});

test("a distinct provider event name stays visible without being misrepresented as a tour", () => {
  const preview = buildAttendanceTicketPreview({
    author: "Sam",
    show: {
      artistName: "Earl Sweatshirt",
      eventName: "Earl Sweatshirt Live at History",
      venue: "History",
      city: "Toronto",
      date: "2026-11-01",
    },
  });
  assert.equal(preview.contextTitle, "Earl Sweatshirt Live at History");
  assert.equal(preview.isTourTitle, false);
  assert.equal(preview.authorSentence, "Sam is going to Earl Sweatshirt.");
  assert.match(preview.accessibilityLabel, /Earl Sweatshirt Live at History/);
});

test("tour-stop copy appears only when its ordinal is explicitly verified", () => {
  const base = {
    artist: "HAIM",
    tourStopNumber: 12,
    tourStopTotal: 40,
  };
  assert.equal(normalizeAttendanceTicketShow(base).tourStopLabel, undefined);
  assert.equal(normalizeAttendanceTicketShow({ ...base, tourStopVerified: true }).tourStopLabel, "Tour stop 12 of 40");
});

test("date and time formatting is deterministic and fails closed", () => {
  assert.equal(formatAttendanceTicketDate("2026-02-29"), null);
  assert.equal(formatAttendanceTicketDate("2028-02-29T23:00:00Z"), "TUE · FEB 29 · 2028");
  assert.equal(formatAttendanceTicketTime("12:05 AM"), "12:05 AM");
  assert.equal(formatAttendanceTicketTime("12:05 PM"), "12:05 PM");
  assert.equal(formatAttendanceTicketTime("2026-08-21T23:30:00Z"), null);
  assert.equal(formatAttendanceTicketTime("2026-08-21T23:30:00Z", { timeZone: "America/Toronto" }), "7:30 PM");
  assert.equal(formatAttendanceTicketTime("not a time"), null);
});

test("missing event identity does not produce a thin or misleading ticket", () => {
  assert.equal(normalizeAttendanceTicketShow({ venue: "History" }), null);
  assert.equal(buildAttendanceTicketPreview({ show: { date: "2026-08-21" } }), null);
});
