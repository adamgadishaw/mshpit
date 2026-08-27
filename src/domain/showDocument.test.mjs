import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeShowDocument, showDocumentIdentity, showLifecycleView, showPresentationModel,
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
