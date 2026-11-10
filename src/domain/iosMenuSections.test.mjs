import assert from "node:assert/strict";
import test from "node:test";
import { iosMenuSections } from "./iosMenuSections.mjs";
import { journeyMenuModel } from "./menuJourney.mjs";

const actionKeys = ["near", "venues", "fanClubs", "topRated", "news", "crew", "activity", "inbox", "suggestion", "manageProfile", "settings", "admin", "newsroom", "tourDates", "requestArtist", "calendar", "clips", "howItWorks", "signOut"];
const actions = Object.fromEntries(actionKeys.map(key => [key, () => {}]));
const sectionKeys = sections => Object.fromEntries(sections.map(section => [section.title, section.items.map(item => item.key)]));

test("iOS menu orders useful destinations as Community, Explore, Account, Settings", () => {
  const sections = iosMenuSections({ session: { role: "fan" }, actions });
  assert.deepEqual(sectionKeys(sections), {
    Community: ["fanClubs", "activity", "inbox"],
    Explore: ["near", "venues", "topRated", "news", "crew", "clips"],
    Account: ["manageProfile", "requestArtist", "calendar", "signOut"],
    Settings: ["settings", "suggestion", "howItWorks"],
  });
  for (const item of sections.flatMap(section => section.items)) assert.ok(item.detail, `${item.key} explains its purpose`);
});

for (const role of ["fan", "artist", "moderator", "editor", "admin"]) {
  test(`iOS menu preserves every authorized ${role} route exactly once`, () => {
    const session = { id: role, role, artistName: role === "artist" ? "Artist" : undefined };
    const sections = iosMenuSections({ session, actions });
    const keys = sections.flatMap(section => section.items.map(item => item.key));
    const shared = journeyMenuModel({ session, includeCrew: true });
    const expected = [...shared.discover, ...shared.connection, ...shared.account].map(item => item.key).concat(["calendar", "clips", "howItWorks", "signOut"]);
    assert.equal(new Set(keys).size, keys.length);
    assert.deepEqual(keys.toSorted(), expected.toSorted());
  });
}

test("guest routes do not expose account controls or personal calendar", () => {
  const sections = iosMenuSections({ actions });
  assert.deepEqual(sections.map(section => section.title), ["Community", "Explore", "Settings"]);
  assert.deepEqual(sectionKeys(sections).Settings, ["suggestion", "howItWorks"]);
  for (const key of ["manageProfile", "calendar", "settings", "signOut", "admin", "newsroom", "tourDates", "requestArtist"]) {
    assert.ok(!sections.some(section => section.items.some(item => item.key === key)));
  }
});

test("only functional callbacks produce rows and empty groups disappear", () => {
  assert.deepEqual(iosMenuSections(), []);
  const sections = iosMenuSections({ session: { role: "fan" }, actions: { inbox: () => {}, near: true, clips: {}, crew: null, settings: "disabled" } });
  assert.deepEqual(sectionKeys(sections), { Community: ["inbox"] });
});

test("iOS grouping preserves real counts with malformed values sanitized", () => {
  const get = (input, key) => iosMenuSections({ actions, ...input }).flatMap(section => section.items).find(item => item.key === key);
  assert.equal(get({ inboxUnread: 4.8 }, "inbox").badge, 4);
  assert.equal(get({ notifications: 123 }, "activity").badge, 123);
  assert.equal(get({ inboxUnread: -3 }, "inbox").badge, 0);
  assert.equal(get({ notifications: Infinity }, "activity").badge, 0);
});
