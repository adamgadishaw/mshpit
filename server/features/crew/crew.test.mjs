import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { mayStartDirectMessage } from "../../directMessageSafety.js";
import { stableShowIdForTourDateId } from "../shows/showIdentity.js";
import {
  CrewError,
  cleanCrewPurposes,
  crewCountsForTourDate,
  crewMatchExists,
  crewPeopleDeck,
  crewShowcaseCandidates,
  crewShowDeck,
  ensureCrewSchema,
  listCrewMatches,
  listMyCrewShows,
  passCrewShow,
  setCrewSeeking,
  stopCrewSeeking,
  swipeCrewPerson,
} from "./crewService.js";
import { projectCrewDocument, renderCrewMain } from "./crewDocuments.js";

const SHOW = "tm_Z7r9jZ1A7Gd";
const OTHER_SHOW = "tm_Z7r9jZ1A7Ge";
const showId = stableShowIdForTourDateId(SHOW);

function world(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,age_band TEXT,home_city TEXT);
    CREATE TABLE shows(id TEXT PRIMARY KEY,artist TEXT,venue TEXT,city TEXT,date TEXT,tour_date_id TEXT);
    CREATE TABLE show_attendance(show_id TEXT,user_id TEXT,state TEXT,visibility TEXT DEFAULT 'members',PRIMARY KEY(show_id,user_id));
    CREATE TABLE posts(id TEXT PRIMARY KEY,user_id TEXT,artist TEXT,removed INTEGER DEFAULT 0,created_at INTEGER DEFAULT 0);`);
  ensureCrewSchema(db);
  const users = {
    ana: { id: "u_ana", age_band: "18_plus", home_city: "Toronto" },
    ben: { id: "u_ben", age_band: "18_plus", home_city: "Toronto" },
    cam: { id: "u_cam", age_band: "18_plus", home_city: "Hamilton" },
    teen: { id: "u_teen", age_band: "13_17", home_city: "Toronto" },
    newbie: { id: "u_new", age_band: "unknown", home_city: "Toronto" },
  };
  for (const user of Object.values(users)) {
    db.prepare("INSERT INTO users VALUES (?,?,?,?)").run(user.id, user.id.slice(2), user.age_band, user.home_city);
  }
  db.prepare("INSERT INTO shows VALUES (?,?,?,?,?,?)").run(showId, "Wet Leg", "History", "Toronto", "2026-10-10", SHOW);
  const attend = (user, state = "going", id = showId) => db.prepare("INSERT OR REPLACE INTO show_attendance VALUES (?,?,?,'members')").run(id, user.id, state);
  const blocks = new Set();
  return {
    db, users, attend,
    block: (a, b) => blocks.add(`${a}|${b}`),
    blockedEitherWay: (a, b) => blocks.has(`${a}|${b}`) || blocks.has(`${b}|${a}`),
    projectUser: (id) => ({ id, name: id.slice(2) }),
  };
}

test("only adults who are going or interested can look for a crew", (t) => {
  const { db, users, attend } = world(t);
  for (const [user, code] of [[users.teen, "CREW_ADULTS_ONLY"], [users.newbie, "CREW_AGE_REQUIRED"]]) {
    attend(user);
    assert.throws(() => setCrewSeeking(db, { user, tourDateId: SHOW, purposes: [] }),
      (error) => error instanceof CrewError && error.code === code);
  }
  assert.throws(() => setCrewSeeking(db, { user: users.ana, tourDateId: SHOW, purposes: [] }),
    (error) => error.code === "CREW_ATTENDANCE_REQUIRED", "say you're going first");
  attend(users.ana, "interested");
  const seeking = setCrewSeeking(db, { user: users.ana, tourDateId: SHOW, purposes: ["ride", "ride", "bogus", "meet_before"],
    note: "  First show\u0000 alone,   say hi  " });
  assert.deepEqual(seeking.purposes, ["ride", "meet_before"]);
  assert.equal(seeking.note, "First show alone, say hi");
  assert.deepEqual(crewCountsForTourDate(db, SHOW), { going: 2, lookingForCrew: 1 }, "Interested is not counted as going");
  assert.deepEqual(cleanCrewPurposes(["hotel", "pit", "need_ticket", "spare_ticket", "ride"]).length, 4);
});

test("you only ever see people looking for a crew for the same show, and one-sided likes stay hidden", (t) => {
  const { db, users, attend, block, blockedEitherWay, projectUser } = world(t);
  for (const user of [users.ana, users.ben, users.cam]) {
    attend(user);
    setCrewSeeking(db, { user, tourDateId: SHOW, purposes: ["meet_before"], note: `${user.id} here` });
  }
  db.prepare("INSERT INTO posts VALUES ('p1','u_ana','Wet Leg',0,1),('p2','u_ben','wet leg',0,1),('p3','u_ben','Idles',0,1)").run();
  attend(users.teen);
  const deck = crewPeopleDeck(db, { user: users.ana, tourDateId: SHOW, projectUser, blockedEitherWay });
  assert.deepEqual(deck.people.map((person) => person.id).sort(), ["u_ben", "u_cam"], "never yourself, never someone not looking");
  assert.deepEqual(deck.people.find((person) => person.id === "u_ben").sharedArtists, ["Wet Leg"]);

  assert.throws(() => crewPeopleDeck(db, { user: users.teen, tourDateId: SHOW, projectUser, blockedEitherWay }),
    (error) => error.code === "CREW_ADULTS_ONLY");
  stopCrewSeeking(db, { user: users.cam, tourDateId: SHOW });
  block("u_ben", "u_ana");
  assert.deepEqual(crewPeopleDeck(db, { user: users.ana, tourDateId: SHOW, projectUser, blockedEitherWay }).people, [],
    "switching off and blocking both hide people at once");
  assert.throws(() => swipeCrewPerson(db, { user: users.ana, tourDateId: SHOW, targetId: "u_ben", decision: "like", blockedEitherWay }),
    (error) => error.status === 404, "a blocked person cannot be liked");
  assert.throws(() => swipeCrewPerson(db, { user: users.ana, tourDateId: SHOW, targetId: "u_cam", decision: "like", blockedEitherWay }),
    (error) => error.status === 404 && /no longer looking/.test(error.message), "the same answer as any other reason");
});

test("two yeses make a crew, which lets two adults message each other", (t) => {
  const { db, users, attend, blockedEitherWay, projectUser } = world(t);
  for (const user of [users.ana, users.ben]) {
    attend(user);
    setCrewSeeking(db, { user, tourDateId: SHOW, purposes: [] });
  }
  assert.deepEqual(swipeCrewPerson(db, { user: users.ana, tourDateId: SHOW, targetId: "u_ben", decision: "like", blockedEitherWay, at: 5 }),
    { matched: false }, "a one-sided like reveals nothing");
  assert.equal(crewMatchExists(db, "u_ana", "u_ben"), false);
  assert.deepEqual(crewPeopleDeck(db, { user: users.ana, tourDateId: SHOW, projectUser, blockedEitherWay }).people, [],
    "someone you answered does not come back");
  assert.equal(crewPeopleDeck(db, { user: users.ben, tourDateId: SHOW, projectUser, blockedEitherWay }).people.length, 1);

  const match = swipeCrewPerson(db, { user: users.ben, tourDateId: SHOW, targetId: "u_ana", decision: "like", blockedEitherWay, at: 6 });
  assert.deepEqual(match, { matched: true, created: true });
  assert.equal(crewMatchExists(db, "u_ben", "u_ana"), true);
  assert.deepEqual(swipeCrewPerson(db, { user: users.ben, tourDateId: SHOW, targetId: "u_ana", decision: "like", blockedEitherWay, at: 7 }),
    { matched: true, created: false }, "a repeat does not notify twice");

  const [crew] = listCrewMatches(db, { user: users.ana, projectUser, blockedEitherWay });
  assert.equal(crew.person.id, "u_ben");
  assert.equal(crew.show.artist, "Wet Leg");
  assert.equal(listMyCrewShows(db, { user: users.ana })[0].others, 1);

  const base = { recipientPolicy: "mutuals", senderAgeBand: "18_plus", recipientAgeBand: "18_plus" };
  assert.equal(mayStartDirectMessage(base).allowed, false, "strangers still need a mutual follow");
  assert.deepEqual(mayStartDirectMessage({ ...base, crewMatched: true }), { allowed: true, reason: "crew_match" });
  assert.equal(mayStartDirectMessage({ ...base, recipientPolicy: "nobody", crewMatched: true }).allowed, false,
    "someone who closed messages stays closed");
  assert.equal(mayStartDirectMessage({ ...base, recipientAgeBand: "13_17", crewMatched: true }).allowed, false,
    "a teen is never reachable through Crew");
});

test("the shows deck skips shows you passed on or already answered", (t) => {
  const { db, users, attend } = world(t);
  const rows = [
    { id: SHOW, artist: "Wet Leg", venue: "History", venue_city: "Toronto", date: "2026-10-10" },
    { id: OTHER_SHOW, artist: "Idles", venue: "Danforth", venue_city: "Toronto", date: "2026-10-12" },
    { id: "tm_Z7r9jZ1A7Gf", artist: "Fontaines D.C.", venue: "Rebel", venue_city: "Toronto", date: "2026-10-14" },
  ];
  let askedCity = null;
  const visibleTourDates = (_user, options) => { askedCity = options.city; return rows; };
  const projectShow = (row) => ({ id: row.id, artist: row.artist, venue: row.venue, date: row.date });
  attend(users.ana, "going");
  passCrewShow(db, { user: users.ana, tourDateId: OTHER_SHOW });
  const deck = crewShowDeck(db, { user: users.ana, visibleTourDates, projectShow });
  assert.equal(askedCity, "Toronto", "your home city by default");
  assert.deepEqual(deck.shows.map((show) => show.artist), ["Fontaines D.C."]);
  assert.deepEqual(deck.shows[0].counts, { going: 0, lookingForCrew: 0 });
  crewShowDeck(db, { user: users.ana, city: "Montreal", visibleTourDates, projectShow });
  assert.equal(askedCity, "Montreal", "or a city you choose");
});

test("the public Crew page lists busy upcoming shows by count only and escapes everything", (t) => {
  const { db, users, attend } = world(t);
  const past = stableShowIdForTourDateId(OTHER_SHOW);
  db.prepare("INSERT INTO shows VALUES (?,?,?,?,?,?)").run(past, "Idles", "Danforth", "Toronto", "2020-01-01", OTHER_SHOW);
  attend(users.ana);
  attend(users.ben, "going", past);
  setCrewSeeking(db, { user: users.ana, tourDateId: SHOW, purposes: [] });
  assert.deepEqual(crewShowcaseCandidates(db, { today: "2026-09-24" }).map((row) => ({ ...row })), [{ tourDateId: SHOW, lookingForCrew: 1, going: 1 }],
    "past shows are left out");

  const document = projectCrewDocument({ origin: "https://www.mshpit.com", shows: [
    { name: "Wet Leg at History", artist: "Wet <Leg>", venue: "History", place: "Toronto", date: "2026-10-10", path: "/event/tm_1", going: 3, lookingForCrew: 2 },
    { artist: "Sneaky", date: "2026-10-11", path: "//evil.example/x", going: 9 },
    { artist: "No date", date: "soon", path: "/event/tm_2" },
  ] });
  assert.equal(document.canonicalPath, "/crew");
  assert.equal(document.crew.shows.length, 1, "unsafe paths and bad dates are dropped");
  assert.ok(document.jsonLd.some((node) => node["@type"] === "FAQPage"));
  const html = renderCrewMain(document);
  assert.match(html, /Wet &lt;Leg&gt;/u);
  assert.match(html, /2 looking for a crew/u);
  assert.doesNotMatch(html, /evil\.example/u);
  assert.doesNotMatch(html, /u_ana|u_ben/u, "never who");
  assert.equal(renderCrewMain({ kind: "event" }), null);
});
