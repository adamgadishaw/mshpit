import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ARTIST_UPCOMING_PREVIEW_LIMIT,
  selectArtistUpcomingShows,
} from "./artistUpcomingShows.mjs";

const show = (id, date) => ({ id, date, venue: `Venue ${id}` });

test("artist upcoming shows default to the next three in chronological order", () => {
  const input = [
    show("late", "2027-10-20"),
    show("same-b", "2027 - 08 - 12"),
    show("middle", "2027-09-04"),
    show("first", "2027-07-01"),
    show("same-a", "2027-08-12"),
  ];
  const originalOrder = input.map(({ id }) => id);

  const result = selectArtistUpcomingShows(input);

  assert.equal(ARTIST_UPCOMING_PREVIEW_LIMIT, 3);
  assert.deepEqual(result.shows.map(({ id }) => id), ["first", "same-a", "same-b"]);
  assert.equal(result.total, 5);
  assert.equal(result.overflowCount, 2);
  assert.equal(result.hasOverflow, true);
  assert.equal(result.expanded, false);
  assert.deepEqual(input.map(({ id }) => id), originalOrder, "the selector must not mutate store state");
});

test("artist upcoming shows reveal the complete ordered list only when expanded", () => {
  const result = selectArtistUpcomingShows([
    show("third", "2027-09-03"),
    show("first", "2027-09-01"),
    show("fourth", "2027-09-04"),
    show("second", "2027-09-02"),
  ], { expanded: true });

  assert.deepEqual(result.shows.map(({ id }) => id), ["first", "second", "third", "fourth"]);
  assert.equal(result.overflowCount, 1);
  assert.equal(result.hasOverflow, true);
  assert.equal(result.expanded, true);
});

test("artist upcoming shows handle empty and short collections without a toggle", () => {
  assert.deepEqual(selectArtistUpcomingShows(null), {
    shows: [],
    total: 0,
    overflowCount: 0,
    hasOverflow: false,
    expanded: false,
  });

  const short = selectArtistUpcomingShows([
    show("second", "2027-09-02"),
    show("first", "2027-09-01"),
    show("third", "2027-09-03"),
  ], { expanded: true });
  assert.deepEqual(short.shows.map(({ id }) => id), ["first", "second", "third"]);
  assert.equal(short.hasOverflow, false);
  assert.equal(short.expanded, false);
});

test("artist profile wires the compact show selector to an accessible resettable toggle", () => {
  const source = readFileSync(new URL("../screens/ArtistScreen.jsx", import.meta.url), "utf8");

  assert.match(source, /selectArtistUpcomingShows\(upcoming, \{ expanded: showAllUpcoming \}\)/);
  assert.match(source, /setShowAllUpcoming\(false\)/);
  assert.match(source, /visibleUpcoming\.map\(\(t\) =>/);
  assert.match(source, /accessibilityState=\{\{ expanded: upcomingPresentation\.expanded \}\}/);
  assert.match(source, /Load \$\{upcomingPresentation\.overflowCount\} more/);
  assert.match(source, /Show fewer/);
});
