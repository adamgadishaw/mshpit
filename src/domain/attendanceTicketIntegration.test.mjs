import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("a new Going transition offers an optional public ticket post without auto-publishing", () => {
  const show = source("../screens/ShowScreen.jsx");
  const controls = source("../features/showSocial/ShowAttendanceControls.jsx");
  const composer = source("../components/GoingTicketComposer.jsx");

  assert.match(controls, /previousState: previous\?\.state \|\| null/);
  assert.match(controls, /requestedState: state \|\| null/);
  assert.match(show, /transition\.requestedState !== "going"/);
  assert.match(show, /transition\.previousState !== "going"/);
  assert.match(show, /result\?\.attendance\?\.visibility !== "private"/);
  assert.match(show, /<GoingTicketComposer/);
  assert.match(composer, /Your Going status is already saved\.[\s\S]*public feed post[\s\S]*not a ticket for entry/);
  assert.match(composer, /Seat details are off by default/);
  assert.doesNotMatch(show, /addLog\([^)]*toggleGoing/);
});

test("ticket transport sends only the exact event identity and explicit seat consent", () => {
  const store = source("../store.js");
  const show = source("../screens/ShowScreen.jsx");
  const composer = source("../components/GoingTicketComposer.jsx");
  const ticketBranch = store.slice(
    store.indexOf("attendanceTicket: {", store.indexOf("const body = kind")),
    store.indexOf(": buildReviewCreateBody", store.indexOf("const body = kind")),
  );

  for (const field of ["tourDateId", "includeSeat", "section", "row", "seat"]) {
    assert.match(ticketBranch, new RegExp(`\\b${field}\\b`));
  }
  for (const forbidden of ["eventName", "tourName", "artistPhotoUri", "providerEventId", "showId", "barcode", "orderId"]) {
    assert.doesNotMatch(ticketBranch, new RegExp(`\\b${forbidden}\\b`));
  }
  assert.doesNotMatch(ticketBranch, /\.\.\.safe\.attendanceTicket/);
  assert.doesNotMatch(composer, /showId:/);
  assert.match(store, /\.\.\.\(tourDateId \? \{ tourDateId \} : \{\}\)/,
    "legacy Going writes retain the exact catalogue event alongside the display key");
  assert.match(show, /toggleGoing\(\{ \.\.\.norm, tourDateId \}\)/);
  assert.match(show, /show=\{\{ \.\.\.trustedShow, tourDateId \}\}/,
    "typed attendance writes retain the same exact catalogue identity");
});

test("a lost-response retry reuses the same per-event ticket mutation id", () => {
  const store = source("../store.js");
  const composer = source("../components/GoingTicketComposer.jsx");

  assert.match(composer, /createAttendanceTicketClientMutationId/);
  assert.match(composer, /mutationRef\.current\.tourDateId !== tourDateId/);
  assert.match(composer, /id:\s*clientMutationId/);
  assert.match(store, /const localId = log\.id \|\| "p_local_" \+ Date\.now\(\)/);
  assert.match(store, /clientMutationId:\s*localId/);
  assert.match(store, /if \(!safe\.attendanceTicket\) \{[\s\S]*?setFeed[\s\S]*?upsertProfileHistoryPost/,
    "a server-owned ticket cannot briefly appear published before exact-event authorization succeeds");
});

test("ticket share owns one safe error message while ordinary posts keep global feedback", () => {
  const show = source("../screens/ShowScreen.jsx");
  const store = source("../store.js");
  const composer = source("../components/GoingTicketComposer.jsx");

  assert.match(store, /const addLog = \(log, \{ silent = false \} = \{\}\) =>/,
    "ordinary post writes keep the existing global feedback by default");
  assert.match(store, /return api\("\/api\/posts", \{[\s\S]*?body,[\s\S]*?silent,[\s\S]*?\}\)/);
  assert.match(show, /onPost=\{\(post\) => addLog\(post, \{ silent: true \}\)\}/,
    "the ticket composer suppresses only the duplicate global toast");
  assert.doesNotMatch(composer, /result\?\.error\?\.message/,
    "raw internal errors never render on the member-facing ticket composer");
  assert.doesNotMatch(composer, /result\?\.error\?\.userMessage/,
    "generic catalogue copy cannot replace the ticket-specific recovery message");
  assert.match(composer, /Couldn't share this ticket right now\. Your Going status is still saved\./);
});

test("exact Going attendance survives account hydration even without an ambiguous legacy alias", () => {
  const store = source("../store.js");

  assert.match(store, /const exactGoingRows = canonicalAttendance\.filter/);
  assert.match(store, /const exactDisplayKeys = new Set/);
  assert.match(store, /rows\.filter\(\(entry\) => goingTourDateId\(entry\)/,
    "an exact row replaces its same-key legacy calendar projection instead of duplicating it");
  assert.match(store, /goingEntryIdentity\(candidate\) === identity/,
    "the private canonical attendance projection restores exact Going identity after reload");
});

test("a legacy display key never impersonates one of two exact catalogue events", () => {
  const store = source("../store.js");

  assert.match(store, /if \(exactId\) return goingTourDateId\(entry\) === exactId;/,
    "exact event controls require exact event attendance and can safely upgrade old legacy rows");
});

test("the shared post renderer owns ticket presentation and disables generic edits", () => {
  const card = source("../components/TicketStub.jsx");
  const feed = source("../screens/FeedScreen.jsx");
  const post = source("../screens/PostScreen.jsx");
  const profile = source("../screens/ProfileScreen.jsx");
  const app = source("../../App.js");
  const publicFrameNavigation = source("./publicFrameNavigation.mjs");
  assert.match(card, /buildAttendanceTicketPreview/);
  assert.match(card, /calendarShowFromPost/);
  assert.match(card, /<ConcertTicketCard/);
  assert.match(card, /&& !log\.attendanceTicket/);
  assert.match(card, /seatLocation: log\.attendanceTicket\.seat \|\| log\.attendanceTicket\.seatLocation/);
  assert.match(card, /onPress=\{attendanceTicketShow && onOpenShow \? \(\) => onOpenShow\(attendanceTicketShow\) : undefined\}/);
  assert.doesNotMatch(card, /onPress=\{\(\) => onOpen\?\.\(log\)\}\s*accessibilityHint="Open this Going post and its comments"/);
  assert.match(feed, /onOpenShow=\{\(show\) => onOpen\?\.\(show, \{ surface, position: itemIndex \}\)\}/);
  assert.match(post, /onOpenShow=\{onOpenShow\}/);
  assert.match(profile, /onOpenShow=\{onOpenShow\}/);
  assert.match(app, /log\.kind === "status" && log\.performanceEvent !== true/);
  assert.ok(app.includes("publicFramePath(frame"), "App delegates canonical history serialization to the tested public-frame helper");
  assert.ok(publicFrameNavigation.includes('frame.openLog?.performanceEvent && frame.openLog?.id'));
  assert.ok(publicFrameNavigation.includes("eventPath(frame.openLog.id)"));
});

test("the show surface keeps provider access distinct from verified venue doors", () => {
  const show = source("../screens/ShowScreen.jsx");
  assert.match(show, /const providerAccessMs = Date\.parse\(norm\.accessStartDateTime \|\| ""\)/);
  assert.match(show, /norm\.doorsVerified === true \? Date\.parse\(norm\.doorsAt \|\| ""\) : NaN/);
  assert.match(show, /"until event access"/);
  assert.match(show, /"until verified doors"/);
  assert.doesNotMatch(show, /doorsAt:\s*norm\.doorsAt \|\| norm\.accessStartDateTime/);
  assert.match(show, /hasAuthenticCountdownTarget/,
    "date-only legacy rows must not expose an arbitrary 8pm fallback as an exact countdown");
});
