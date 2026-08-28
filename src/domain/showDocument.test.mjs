import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isNamedSpecialEvent, normalizeShowDocument, showDocumentIdentity, showLifecycleView, showPresentationModel,
} from "./showDocument.mjs";
import { canonicalShowReadEnabled } from "../config/runtime.mjs";

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
  assert.equal(showPresentationModel(showLifecycleView(null, 0, false, during, cne)).screenKicker, "HAPPENING NOW",
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
  assert.match(source, /showLifecycleView\(\s*trustedShow,\s*showDateMs\(norm\.date\),\s*overall != null,\s*Date\.now\(\),\s*norm,/);
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

test("authoritative lifecycle presentation never mislabels happening, postponed, or cancelled Shows", () => {
  const trusted = (lifecycle) => showPresentationModel({
    lifecycle,
    upcoming: lifecycle !== "completed",
    trusted: true,
  });
  assert.deepEqual(trusted("happening"), {
    screenKicker: "HAPPENING NOW",
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
    screenKicker: "UPCOMING PERFORMANCE",
    ticketKicker: "ONE NIGHT · NOT YET PLAYED",
    showCountdown: true,
    showPostEvent: false,
    allowTickets: true,
    allowGoing: true,
  });
  assert.equal(showPresentationModel({ upcoming: false, trusted: false }).showPostEvent, true);
});
