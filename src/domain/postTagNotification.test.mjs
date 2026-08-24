import assert from "node:assert/strict";
import test from "node:test";

import { postTagNotificationCopy, postTagNotificationPhrase } from "./postTagNotification.mjs";

test("post-tag activity reads naturally with and without an artist", () => {
  assert.equal(postTagNotificationPhrase("SZA"), "tagged you in a SZA post");
  assert.equal(postTagNotificationCopy("Mara", "SZA"), "Mara tagged you in a SZA post");
  assert.equal(postTagNotificationCopy("", ""), "Someone tagged you in a post");
});
