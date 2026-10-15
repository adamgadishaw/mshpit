import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isNamedSpecialEvent, normalizeShowDocument, showDocumentIdentity, showLifecycleView, showPresentationModel,
} from "./showDocument.mjs";
import { canonicalShowReadEnabled } from "../config/runtime.mjs";
import { normalizePublicEventSnapshot, publicEventSnapshotScope, readablePublicEventSnapshot } from "./publicEventSnapshot.mjs";

test("an event-bound public cancellation survives an unavailable or stale upcoming canonical Show", () => {
  const event = { id: "tm_cancelled_fixture", kind: "event", path: "/event/tm_cancelled_fixture", publicEventSnapshot: true,
    name: "Fixture Artist", artist: "Fixture Artist", venue: "Fixture Venue", date: "2026-10-05" };
  const upcoming = normalizeShowDocument({ id: `show_${"f".repeat(64)}`, canonicalKey: "ticketmaster:fixture",
    lifecycle: "upcoming", startsAt: Date.parse("2026-10-05T20:00:00Z"),
    provider: { name: "ticketmaster", eventId: "fixture", backed: true } });
  const now = Date.parse("2026-10-04T12:00:00Z");
  for (const eventStatus of ["cancelled", "canceled", " CANCELLED ", "Canceled"]) {
    const data = normalizePublicEventSnapshot({ ...event, eventStatus }, event.id);
    const resource = { scope: publicEventSnapshotScope(event.id, null), updatedAt: now, data };
    const snapshot = readablePublicEventSnapshot(resource, { eventId: event.id, accountId: null });
    for (const document of [null, upcoming]) {
      const view = showLifecycleView(document, upcoming.startsAt, false, now, event, snapshot);
      assert.equal(view.lifecycle, "cancelled");
      assert.equal(view.upcoming, false);
      assert.equal(view.trusted, document === upcoming, "public reads do not confer canonical attendance authority");
      const presentation = showPresentationModel(view);
      assert.equal(presentation.screenKicker, "Cancelled");
      for (const flag of ["showCountdown", "showPostEvent", "allowTickets", "allowGoing"]) assert.equal(presentation[flag], false, flag);
    }
    const active = { ...event, date: "2026-10-01", eventEndDate: "2026-10-08" };
    assert.equal(showLifecycleView(null, upcoming.startsAt, false, now, active, snapshot).lifecycle, "cancelled");
    assert.equal(showLifecycleView(null, upcoming.startsAt, false, now, event, { ...snapshot, id: "tm_other" }).upcoming, true);
    assert.equal(showLifecycleView(null, upcoming.startsAt, false, now, { ...event, kind: "status" }, snapshot).upcoming, true);
    assert.equal(showLifecycleView(null, upcoming.startsAt, false, now, { ...event, eventStatus }).upcoming, true,
      "navigation props alone cannot supply the fresh public cancellation");
    assert.equal(readablePublicEventSnapshot(resource, { eventId: event.id, accountId: "other-account" }), null);
  }
  const scheduled = normalizePublicEventSnapshot({ ...event, eventStatus: "scheduled" }, event.id);
  assert.deepEqual(showLifecycleView(null, upcoming.startsAt, false, now, event, scheduled),
    showLifecycleView(null, upcoming.startsAt, false, now, event));
});

test("trusted provider lifecycle takes precedence over a contradictory legacy date", () => {
  const show = normalizeShowDocument({ show: {
    id: `show_${"a".repeat(64)}`,
    canonicalKey: "provider:event-7",
    lifecycle: "completed",
    startsAt: 2_000,
    provider: { name: "ticketmaster", eventId: "event-7", backed: true },
  } });
  assert.deepEqual(showLifecycleView(show, 9_999_999, false, 1), {
    lifecycle: "completed",
    targetMs: 2_000,
    upcoming: false,
    trusted: true,
  });
});

test("a real multi-day event remains happening through its inclusive end date", () => {
  const completed = normalizeShowDocument({ show: {
    id: `show_${"b".repeat(64)}`,
    canonicalKey: "ticketmaster:cne",
    lifecycle: "completed",
    startsAt: Date.UTC(2026, 7, 21, 14),
    provider: { name: "ticketmaster", eventId: "cne", backed: true },
  } });
  const cne = {
    artist: "Canadian National Exhibition",
    eventName: "Canadian National Exhibition",
    eventKind: "fair",
    date: "2026-08-21",
    eventEndDate: "2026-09-07",
  };
  const during = new Date(2026, 8, 7, 12).getTime();
  const after = new Date(2026, 8, 8, 12).getTime();

  assert.equal(showLifecycleView(completed, 0, false, during, cne).lifecycle, "happening");
  assert.equal(showLifecycleView(completed, 0, false, after, cne).lifecycle, "completed");
  assert.equal(showPresentationModel(showLifecycleView(null, 0, false, during, cne)).screenKicker, "Happening now",
    "the event payload can preserve honest presentation while a canonical read is unavailable");
});

test("cancelled or postponed authority is never overwritten by an active date range", () => {
  const trusted = (lifecycle) => normalizeShowDocument({ show: {
    id: `show_${(lifecycle === "cancelled" ? "c" : "d").repeat(64)}`,
    canonicalKey: `ticketmaster:${lifecycle}`,
    lifecycle,
    startsAt: Date.UTC(2026, 7, 21, 14),
    provider: { name: "ticketmaster", eventId: lifecycle, backed: true },
  } });
  const active = { date: "2026-08-21", eventEndDate: "2026-09-07" };
  const during = new Date(2026, 7, 27, 12).getTime();
  assert.equal(showLifecycleView(trusted("cancelled"), 0, false, during, active).lifecycle, "cancelled");
  assert.equal(showLifecycleView(trusted("postponed"), 0, false, during, active).lifecycle, "postponed");
});

test("special-event identity uses the provider kind even when artist and event name are equal", () => {
  assert.equal(isNamedSpecialEvent({
    artist: "Canadian National Exhibition",
    eventName: "Canadian National Exhibition",
    eventKind: "fair",
  }), true);
  assert.equal(isNamedSpecialEvent({
    artist: "Solo Artist",
    eventName: "Solo Artist",
    eventKind: "concert",
  }), false);
  assert.equal(isNamedSpecialEvent({
    artist: "Headliner",
    eventName: "City Music Festival",
    eventKind: "concert",
  }), true);
});

test("ShowScreen supplies the full event range and kind to presentation helpers", () => {
  const source = readFileSync(new URL("../screens/ShowScreen.jsx", import.meta.url), "utf8");
  assert.match(source, /isNamedSpecialEvent\(norm\) \|\| eventTitle !== artist/);
  assert.match(source, /showLifecycleView\(\s*trustedShow,\s*showDateMs\(norm\.startDateTime \|\| norm\.startLocalTime \|\| norm\.date\),\s*overall != null,\s*Date\.now\(\),\s*norm,/);
  assert.match(source, /norm\.doorsVerified === true \? Date\.parse\(norm\.doorsAt \|\| ""\) : NaN/);
  assert.match(source, /const providerAccessMs = Date\.parse\(norm\.accessStartDateTime \|\| ""\)/);
  assert.match(source, /const countdownNowMs = Date\.now\(\)/);
  assert.match(source, /const hasAuthenticCountdownTarget = !!countdownTimingKind \|\| hasExplicitShowTime/);
  assert.match(source, /presentation\.showCountdown && hasAuthenticCountdownTarget && targetMs != null/);
  assert.match(source, /<Countdown target=\{targetMs\} active=\{appActive\} onComplete=\{handleCountdownComplete\} style=\{styles\.countdownTxt\} \/>/);
  assert.doesNotMatch(source, /\bnowTick\b/);
  assert.doesNotMatch(source, /\bsetInterval\s*\(/);
  assert.doesNotMatch(source, /\bfmtCountdown\b/);
  assert.match(source, /countdownTimingKind === "doors"\s*\? "until verified doors"\s*:\s*countdownTimingKind === "access" \? "until event access" : "until showtime"/);
});

test("untrusted or unavailable documents retain legacy lifecycle behavior", () => {
  assert.equal(showLifecycleView(null, 50_000, false, 1).upcoming, true);
  assert.equal(showLifecycleView(null, null, true, 1).upcoming, false);
  assert.equal(canonicalShowReadEnabled("false"), false);
  assert.equal(canonicalShowReadEnabled(undefined), true);
});

test("documents without a stable Show ID fail closed to the legacy screen", () => {
  assert.equal(normalizeShowDocument({ show: {
    id: "provider-event-7",
    canonicalKey: "provider:event-7",
    lifecycle: "upcoming",
    provider: { name: "ticketmaster", eventId: "event-7", backed: true },
  } }), null);
});

test("Show document identity rejects stale account and Show responses by construction", () => {
  assert.notEqual(showDocumentIdentity("show-a", "fan-a"), showDocumentIdentity("show-a", "fan-b"));
  assert.notEqual(showDocumentIdentity("show-a", "fan-a"), showDocumentIdentity("show-b", "fan-a"));
});

test("Show documents preserve explicit artist identity restrictions without coercing legacy values", () => {
  const input = { id: `show_${"e".repeat(64)}`, canonicalKey: "ticketmaster:identity-pending", artist: "Namesake", artistKey: null };
  for (const flag of [true, false]) {
    const show = normalizeShowDocument({ show: { ...input, artistIdentityPending: flag } });
    assert.equal(show.artistIdentityPending, flag);
    assert.equal(show.artistKey, null);
  }
  for (const flag of [undefined, null, 0, 1, "true", "false"]) {
    const show = normalizeShowDocument({ ...input, artistIdentityPending: flag });
    assert.equal(Object.hasOwn(show, "artistIdentityPending"), false);
  }
});

test("authoritative lifecycle presentation never mislabels happening, postponed, or cancelled Shows", () => {
  const trusted = (lifecycle) => showPresentationModel({
    lifecycle,
    upcoming: lifecycle !== "completed",
    trusted: true,
  });
  assert.deepEqual(trusted("happening"), {
    screenKicker: "Happening now",
    ticketKicker: "LIVE · HAPPENING NOW",
    showCountdown: false,
    showPostEvent: false,
    allowTickets: true,
    allowGoing: true,
  });
  assert.equal(trusted("postponed").showCountdown, false);
  assert.equal(trusted("postponed").ticketKicker, "THIS SHOW IS POSTPONED");
  assert.equal(trusted("cancelled").showPostEvent, false);
  assert.equal(trusted("cancelled").allowTickets, false);
  assert.equal(trusted("cancelled").allowGoing, false);
});

test("presentation preserves the exact legacy upcoming/past split without a trusted document", () => {
  assert.deepEqual(showPresentationModel({ upcoming: true, trusted: false }), {
    screenKicker: "Upcoming concert",
    ticketKicker: "ONE NIGHT · NOT YET PLAYED",
    showCountdown: true,
    showPostEvent: false,
    allowTickets: true,
    allowGoing: true,
  });
  assert.equal(showPresentationModel({ upcoming: false, trusted: false }).showPostEvent, true);
});
