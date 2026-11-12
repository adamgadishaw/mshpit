import test from "node:test";
import assert from "node:assert/strict";
import { ACHIEVEMENTS, STATUS_BADGES, pointsTier } from "./badges.mjs";
import { ACHIEVEMENT_RULES } from "./achievementRules.mjs";
import { STATUS_BADGES as STATUS_DEFINITIONS } from "./statusBadges.mjs";

test("startup award rules and lazy legend share identities, points and predicates", () => {
  assert.equal(STATUS_BADGES, STATUS_DEFINITIONS);
  assert.deepEqual(ACHIEVEMENT_RULES.map(rule => rule.id), ACHIEVEMENTS.map(achievement => achievement.id));
  for (const rule of ACHIEVEMENT_RULES) {
    assert.deepEqual(Object.keys(rule).sort(), ["id", "points", "test"]);
    const achievement = ACHIEVEMENTS.find(item => item.id === rule.id);
    assert.equal(achievement.points, rule.points);
    assert.equal(achievement.test, rule.test);
    assert.ok(achievement.label && achievement.desc && achievement.how && achievement.icon);
    for (const amount of [0, 1, 5, 10, 20, 25, 100]) {
      const stats = Object.fromEntries(["shows", "reviews", "likes", "fanClubs", "follows", "photos", "cities", "artists"].map(key => [key, amount]));
      assert.equal(rule.test(stats), achievement.goal(stats) >= achievement.target);
    }
  }
});

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
