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
});

test("a lost-response retry reuses the same per-event ticket mutation id", () => {
  const store = source("../store.js");
  const composer = source("../components/GoingTicketComposer.jsx");

  assert.match(composer, /createAttendanceTicketClientMutationId/);
  assert.match(composer, /mutationRef\.current\.tourDateId !== tourDateId/);
  assert.match(composer, /id:\s*clientMutationId/);
  assert.match(store, /const localId = log\.id \|\| "p_local_" \+ Date\.now\(\)/);
  assert.match(store, /clientMutationId:\s*localId/);
});

test("the shared post renderer owns ticket presentation and disables generic edits", () => {
  const card = source("../components/TicketStub.jsx");
  assert.match(card, /buildAttendanceTicketPreview/);
  assert.match(card, /<ConcertTicketCard/);
  assert.match(card, /&& !log\.attendanceTicket/);
  assert.match(card, /seatLocation: log\.attendanceTicket\.seat \|\| log\.attendanceTicket\.seatLocation/);
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
