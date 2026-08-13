import test from "node:test";
import assert from "node:assert/strict";

import { composerCloseDecision } from "./composerClosePolicy.mjs";

test("an active mutation always blocks navigation", () => {
  assert.equal(composerCloseDecision({ busy: true, editing: true, dirty: true }), "block");
  assert.equal(composerCloseDecision({ busy: true, hasContent: true }), "block");
});

test("unsaved edits require discard confirmation", () => {
  assert.equal(composerCloseDecision({ editing: true, dirty: true }), "confirm-edit-discard");
  assert.equal(composerCloseDecision({ editing: true, dirty: false }), "allow");
});

test("new content is saved and confirmed while a cleared draft is removed", () => {
  assert.equal(composerCloseDecision({ dirty: true, hasContent: true }), "confirm-draft-close");
  assert.equal(composerCloseDecision({ dirty: false, hasContent: true }), "allow", "an untouched artist/venue prefill is the baseline, not a draft");
  assert.equal(composerCloseDecision({ hasDraft: true, hasContent: true }), "allow", "an unchanged resumed draft stays saved when it closes");
  assert.equal(composerCloseDecision({ hasDraft: true }), "delete-empty-draft");
  assert.equal(composerCloseDecision(), "allow");
});
