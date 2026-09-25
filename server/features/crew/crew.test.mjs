import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { stableShowIdForTourDateId } from "../shows/showIdentity.js";
import { CrewError, crewShowDeck, ensureCrewSchema, passCrewShow } from "./crewService.js";
import {
  closeLoungePlan,
  createLoungePlan,
  ensureShowPlansSchema,
  joinLoungePlan,
  leaveLoungePlan,
  listLoungePlans,
  listMyPlans,
  listPlanMessages,
  postPlanMessage,
  removePlanMember,
} from "./showPlansService.js";
import { CREW_ENABLED } from "../../../src/domain/crewAvailability.mjs";

const SHOW = "tm_Z7r9jZ1A7Gd";
const OTHER_SHOW = "tm_Z7r9jZ1A7Ge";
const LOUNGE = "wet leg|history|2026-10-10";

function world(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,age_band TEXT,home_city TEXT);
    CREATE TABLE show_attendance(show_id TEXT,user_id TEXT,state TEXT,visibility TEXT DEFAULT 'members',PRIMARY KEY(show_id,user_id));`);
  ensureCrewSchema(db);
  ensureShowPlansSchema(db);
  const users = {
    ana: { id: "u_ana", age_band: "18_plus", home_city: "Toronto" },
    ben: { id: "u_ben", age_band: "18_plus", home_city: "Toronto" },
    cam: { id: "u_cam", age_band: "18_plus", home_city: "Hamilton" },
    dee: { id: "u_dee", age_band: "18_plus", home_city: "Toronto" },
    teen: { id: "u_teen", age_band: "13_17", home_city: "Toronto" },
    newbie: { id: "u_new", age_band: "unknown", home_city: "Toronto" },
  };
  for (const user of Object.values(users)) {
    db.prepare("INSERT INTO users VALUES (?,?,?,?)").run(user.id, user.id.slice(2), user.age_band, user.home_city);
  }
  const blocks = new Set();
  let next = 0;
  return {
    db, users,
    block: (a, b) => blocks.add(`${a}|${b}`),
    blockedEitherWay: (a, b) => blocks.has(`${a}|${b}`) || blocks.has(`${b}|${a}`),
    projectUser: (id) => ({ id, name: id.slice(2), handle: id.slice(2) }),
    id: () => `plan_${next += 1}`,
  };
}

function plan(w, user, overrides = {}) {
  return createLoungePlan(w.db, {
    user, loungeKey: LOUNGE, show: { artist: "Wet Leg", venue: "History", date: "2026-10-10" },
    kind: "ride", text: "Driving from Hamilton, leaving at 5", spots: 2, id: w.id(), at: 1,
    projectUser: w.projectUser, blockedEitherWay: w.blockedEitherWay, ...overrides,
  });
}

test("the show swipe skips shows you passed on or already answered", (t) => {
  const { db, users } = world(t);
  const rows = [
    { id: SHOW, artist: "Wet Leg", venue: "History", venue_city: "Toronto", date: "2026-10-10" },
    { id: OTHER_SHOW, artist: "Idles", venue: "Danforth", venue_city: "Toronto", date: "2026-10-12" },
    { id: "tm_Z7r9jZ1A7Gf", artist: "Fontaines D.C.", venue: "Rebel", venue_city: "Toronto", date: "2026-10-14" },
  ];
  let askedCity = null;
  const visibleTourDates = (_user, options) => { askedCity = options.city; return rows; };
  const projectShow = (row) => ({ id: row.id, artist: row.artist, venue: row.venue, date: row.date });
  db.prepare("INSERT INTO show_attendance VALUES (?,?,?,'members')").run(stableShowIdForTourDateId(SHOW), users.ana.id, "going");
  db.prepare("INSERT INTO show_attendance VALUES (?,?,?,'members')").run(stableShowIdForTourDateId("tm_Z7r9jZ1A7Gf"), users.ben.id, "going");
  passCrewShow(db, { user: users.ana, tourDateId: OTHER_SHOW });
  const deck = crewShowDeck(db, { user: users.ana, visibleTourDates, projectShow });
  assert.equal(askedCity, "Toronto", "your home city by default");
  assert.deepEqual(deck.shows.map((show) => [show.artist, show.going]), [["Fontaines D.C.", 1]]);
  crewShowDeck(db, { user: users.ana, city: "Montreal", visibleTourDates, projectShow });
  assert.equal(askedCity, "Montreal", "or a city you choose");
  assert.throws(() => passCrewShow(db, { user: users.ana, tourDateId: "" }), CrewError);
});

test("plans are for adults, and a new plan is checked before it is saved", (t) => {
  const w = world(t);
  for (const [user, code] of [[w.users.teen, "PLAN_ADULTS_ONLY"], [w.users.newbie, "PLAN_AGE_REQUIRED"]]) {
    assert.throws(() => plan(w, user), (error) => error instanceof CrewError && error.code === code);
    assert.throws(() => listLoungePlans(w.db, { user, loungeKey: LOUNGE, projectUser: w.projectUser, blockedEitherWay: w.blockedEitherWay }),
      (error) => error.code === code);
    assert.deepEqual(listMyPlans(w.db, { user, projectUser: w.projectUser, blockedEitherWay: w.blockedEitherWay }), []);
  }
  assert.throws(() => plan(w, w.users.ana, { kind: "date" }), (error) => error.status === 400);
  assert.throws(() => plan(w, w.users.ana, { text: " hi " }), (error) => error.status === 400);
  assert.throws(() => plan(w, w.users.ana, { spots: 9 }), (error) => error.status === 400);
  const made = plan(w, w.users.ana, { text: "  Drinks next door\u0000 before doors  " });
  assert.equal(made.text, "Drinks next door before doors");
  assert.equal(made.isHost, true);
  plan(w, w.users.ana);
  assert.throws(() => plan(w, w.users.ana), (error) => error.status === 409, "two open plans per host per show");
});

test("who is in a plan and its chat stay with the people in it", (t) => {
  const w = world(t);
  const { db, users, projectUser, blockedEitherWay } = w;
  const made = plan(w, users.ana);
  joinLoungePlan(db, { user: users.ben, planId: made.id, blockedEitherWay, at: 2 });
  const outsider = listLoungePlans(db, { user: users.cam, loungeKey: LOUNGE, projectUser, blockedEitherWay })[0];
  assert.equal(outsider.joinedCount, 1);
  assert.deepEqual(outsider.members, [], "someone outside a plan sees a count, never names");
  const host = listLoungePlans(db, { user: users.ana, loungeKey: LOUNGE, projectUser, blockedEitherWay })[0];
  assert.deepEqual(host.members.map((member) => member.id), ["u_ben"]);

  postPlanMessage(db, { user: users.ben, planId: made.id, text: "Can I bring a friend?", id: "pm_1", at: 3 });
  assert.equal(listPlanMessages(db, { user: users.ana, planId: made.id, blockedEitherWay, projectUser }).messages[0].text, "Can I bring a friend?");
  assert.throws(() => listPlanMessages(db, { user: users.cam, planId: made.id, blockedEitherWay, projectUser }), (error) => error.status === 404);
  assert.throws(() => postPlanMessage(db, { user: users.cam, planId: made.id, text: "hey", id: "pm_2", at: 4 }), (error) => error.status === 404);
  assert.throws(() => listPlanMessages(db, { user: users.teen, planId: made.id, blockedEitherWay, projectUser }), (error) => error.code === "PLAN_ADULTS_ONLY");
});

test("blocks keep people out of each other's plans, with the same answer as any closed plan", (t) => {
  const w = world(t);
  const { db, users, projectUser, blockedEitherWay, block } = w;
  const made = plan(w, users.ana);
  joinLoungePlan(db, { user: users.ben, planId: made.id, blockedEitherWay, at: 2 });
  block("u_cam", "u_ben");
  assert.throws(() => joinLoungePlan(db, { user: users.cam, planId: made.id, blockedEitherWay }),
    (error) => error.status === 404 && error.message === "This plan is no longer open.", "blocked with a member");
  block("u_dee", "u_ana");
  assert.deepEqual(listLoungePlans(db, { user: users.dee, loungeKey: LOUNGE, projectUser, blockedEitherWay }), [], "a blocked host's plans are hidden");
  assert.throws(() => joinLoungePlan(db, { user: users.dee, planId: "plan_missing", blockedEitherWay }),
    (error) => error.status === 404 && error.message === "This plan is no longer open.");
  postPlanMessage(db, { user: users.ben, planId: made.id, text: "see you there", id: "pm_1", at: 3 });
  block("u_ana", "u_ben");
  assert.deepEqual(listPlanMessages(db, { user: users.ana, planId: made.id, blockedEitherWay, projectUser }).messages, [],
    "a block made later hides that person's messages too");
});

test("full plans, leaving, removing someone and closing", (t) => {
  const w = world(t);
  const { db, users, projectUser, blockedEitherWay } = w;
  const made = plan(w, users.ana, { spots: 1 });
  assert.deepEqual(joinLoungePlan(db, { user: users.ben, planId: made.id, blockedEitherWay }).created, true);
  assert.deepEqual(joinLoungePlan(db, { user: users.ben, planId: made.id, blockedEitherWay }).created, false, "joining twice is harmless");
  assert.throws(() => joinLoungePlan(db, { user: users.cam, planId: made.id, blockedEitherWay }), (error) => error.status === 409);
  assert.throws(() => leaveLoungePlan(db, { user: users.ana, planId: made.id }), (error) => error.status === 409, "hosts close instead");
  assert.throws(() => removePlanMember(db, { user: users.ben, planId: made.id, memberId: "u_ana" }), (error) => error.status === 404);
  removePlanMember(db, { user: users.ana, planId: made.id, memberId: "u_ben" });
  joinLoungePlan(db, { user: users.cam, planId: made.id, blockedEitherWay });
  leaveLoungePlan(db, { user: users.cam, planId: made.id });
  assert.equal(listMyPlans(db, { user: users.cam, projectUser, blockedEitherWay }).length, 0);
  assert.equal(listMyPlans(db, { user: users.ana, projectUser, blockedEitherWay })[0].show.loungeKey, LOUNGE);

  assert.throws(() => closeLoungePlan(db, { user: users.ben, planId: made.id }), (error) => error.status === 404, "only the host");
  closeLoungePlan(db, { user: users.dee, planId: made.id, staff: true, at: 9 });
  assert.deepEqual(listLoungePlans(db, { user: users.ana, loungeKey: LOUNGE, projectUser, blockedEitherWay }), []);
  assert.throws(() => joinLoungePlan(db, { user: users.dee, planId: made.id, blockedEitherWay }), (error) => error.status === 404);
  assert.throws(() => postPlanMessage(db, { user: users.ana, planId: made.id, text: "hello?", id: "pm_9", at: 10 }), (error) => error.status === 409);
});

test("the show swipe and plans stay switched off until the owner launches them", () => {
  // The owner put this on the back burner on 2026-09-25: not enough members
  // yet. Change this test in the same commit that deliberately turns it on.
  assert.equal(CREW_ENABLED, false);
});
