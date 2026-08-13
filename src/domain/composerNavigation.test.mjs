import test from "node:test";
import assert from "node:assert/strict";

import {
  composerNavigationExitAction,
  composerNavigationTransition,
  isActiveComposer,
  prepareNavigationFrame,
} from "./composerNavigation.mjs";

test("composer frames receive a stable operation identity", () => {
  const prepared = prepareNavigationFrame({ logging: true }, () => "composer_a");
  assert.equal(prepared.composerId, "composer_a");
  assert.equal(prepareNavigationFrame(prepared, () => "composer_b"), prepared);
});

test("a late mutation result only owns navigation while its composer is still on top", () => {
  const stack = [{}, { logging: true, composerId: "composer_a" }];
  assert.equal(isActiveComposer(stack, "composer_a"), true);
  assert.equal(isActiveComposer([{}], "composer_a"), false);
  assert.equal(isActiveComposer([{}, { profileId: "u_1" }], "composer_a"), false);
  assert.equal(isActiveComposer([{}, { logging: true, composerId: "composer_b" }], "composer_a"), false);
});

test("every navigation action funnels through the composer close policy", () => {
  for (const action of ["tab", "home", "menu", "activity", "inbox", "account", "replace", "clear"]) {
    assert.equal(composerNavigationExitAction({ logging: true, composerId: "composer_a" }, action), "guard");
    assert.equal(composerNavigationExitAction({ editingPost: { id: "p1" }, composerId: "composer_a" }, action), "guard");
    assert.equal(composerNavigationExitAction({ profileId: "u1" }, action), action);
  }
});

test("leaving a composer replaces it instead of leaving it underneath the destination", () => {
  assert.equal(composerNavigationTransition({ logging: true, composerId: "composer_a" }), "replace");
  assert.equal(composerNavigationTransition({ editingPost: { id: "p1" }, composerId: "composer_a" }), "replace");
  assert.equal(composerNavigationTransition({ profileId: "u1" }), "push");
});
