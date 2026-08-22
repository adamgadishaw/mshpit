import test from "node:test";
import assert from "node:assert/strict";
import { ACHIEVEMENTS, STATUS_BADGES, pointsTier } from "./badges.mjs";

test("badge and achievement identities are complete and non-overlapping", () => {
  const achievementIds = ACHIEVEMENTS.map((achievement) => achievement.id);
  assert.equal(new Set(achievementIds).size, achievementIds.length);
  assert.equal(achievementIds.some((id) => Object.hasOwn(STATUS_BADGES, id)), false);
  for (const achievement of ACHIEVEMENTS) {
    assert.ok(achievement.points > 0);
    assert.ok(achievement.target > 0);
    assert.equal(achievement.test({ shows: 0, reviews: 0, likes: 0, fanClubs: 0, follows: 0, photos: 0, cities: 0, artists: 0 }), false);
  }
});

test("points tiers remain contiguous and cap at Legend", () => {
  assert.deepEqual(pointsTier(0), { name: "Newcomer", start: 0, next: 75 });
  assert.deepEqual(pointsTier(75), { name: "Opener", start: 75, next: 250 });
  assert.deepEqual(pointsTier(250), { name: "Regular", start: 250, next: 500 });
  assert.deepEqual(pointsTier(500), { name: "Headliner", start: 500, next: 900 });
  assert.deepEqual(pointsTier(900), { name: "Legend", start: 900, next: null });
});
