import assert from "node:assert/strict";
import test from "node:test";

import {
  JOURNEY_TAGLINE,
  journeyMenuModel,
  landingSlideUri,
  landingVisibleSlideIndices,
} from "./menuJourney.mjs";

test("journey menu keeps every public discovery and connection destination reachable", () => {
  const model = journeyMenuModel({
    session: { role: "fan", home: { city: " Toronto " } },
    inboxUnread: 3.9,
    notifications: 2,
  });

  assert.equal(JOURNEY_TAGLINE, "Your life's musical journey");
  assert.deepEqual(model.discover.map(({ key }) => key), ["near", "venues", "fanClubs", "topRated"]);
  assert.deepEqual(model.connection.map(({ key }) => key), ["activity", "inbox"]);
  assert.equal(model.discover[0].detail, "Shows and scenes around Toronto");
  assert.equal(model.connection[0].detail, "2 new");
  assert.equal(model.connection[1].detail, "3 unread");
});

test("role-specific account destinations mirror the existing access model", () => {
  const keysFor = (role) => journeyMenuModel({ session: { role } }).account.map(({ key }) => key);

  assert.deepEqual(keysFor("fan"), ["editProfile", "requestArtist"]);
  assert.deepEqual(keysFor("artist"), ["editProfile", "tourDates"]);
  assert.deepEqual(keysFor("moderator"), ["editProfile", "admin"]);
  assert.deepEqual(keysFor("admin"), ["editProfile", "admin", "tourDates"]);
  assert.deepEqual(journeyMenuModel().account, []);
});

test("menu badges reject malformed and negative counts", () => {
  const model = journeyMenuModel({ inboxUnread: -7, notifications: "not-a-number", includeActivity: false });
  assert.deepEqual(model.connection, [
    { key: "inbox", icon: "mail", title: "Inbox", detail: "Your messages", badge: 0 },
  ]);
});

test("landing photography mounts only the current and outgoing layers", () => {
  assert.deepEqual(landingVisibleSlideIndices(0, 8), [0]);
  assert.deepEqual(landingVisibleSlideIndices(1, 8, true), [0, 1]);
  assert.deepEqual(landingVisibleSlideIndices(0, 8, true), [7, 0]);
  assert.equal(landingVisibleSlideIndices(4, 8, true).length, 2);
  assert.deepEqual(landingVisibleSlideIndices(0, 0, true), []);
});

test("landing photography requests viewport-appropriate CDN variants", () => {
  const source = "https://images.unsplash.com/photo-test?auto=format&w=2000&q=85";
  assert.match(landingSlideUri(source, 390), /[?&]w=900(?:&|$)/);
  assert.match(landingSlideUri(source, 390), /[?&]q=78(?:&|$)/);
  assert.match(landingSlideUri(source, 900), /[?&]w=1440(?:&|$)/);
  assert.match(landingSlideUri(source, 1440), /[?&]w=2000(?:&|$)/);
});
