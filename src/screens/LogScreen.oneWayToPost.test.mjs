import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const composer = readFileSync(new URL("./LogScreen.jsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");

test("every post starts the same, with no post-type fork before writing", () => {
  assert.match(composer, /defaultMode = "status"/);
  assert.match(app, /defaultMode=\{nav\.postMode \|\| "status"\}/);
  assert.doesNotMatch(composer, />Log show<\/Text>|accessibilityLabel="Create a regular post"|accessibilityLabel="Log a concert"/);
  assert.match(app, /go\(\{ logging: true, postMode: "status" \}\)/, "the Post button opens a plain post");
});

test("a show is attached and removed from inside the composer, keeping what was written", () => {
  const addShow = composer.indexOf('accessibilityLabel="Add a show you went to"');
  assert.ok(addShow > 0, "the plain post offers to add a show");
  assert.match(composer.slice(addShow - 700, addShow), /onPress=\{\(\) => \{\s*setPostType\("show"\);[\s\S]*composerScrollRef\.current\?\.scrollTo/,
    "attaching a show brings its fields into view");

  const removeShow = composer.indexOf(">Remove show</Text>");
  assert.ok(removeShow > 0, "a review offers to remove its show");
  assert.match(composer.slice(removeShow - 500, removeShow), /onPress=\{\(\) => setPostType\("status"\)\}/);

  // An existing post keeps its kind while being edited: the server treats a
  // review and a plain post differently, including for badges.
  assert.match(composer, /\{!editing && !isMemorialMemory && !isCampaign && \(\s*<Pressable\s+style=\{\(\{ pressed \}\) => \[styles\.addShow/);
  assert.match(composer, /\{!editing && \(\s*<View style=\{styles\.showAttached\}>/);
});

test("entry points that are about a show still open with the show attached", () => {
  assert.match(app, /onLogShow=\{\(\) => requireVerifiedMutation\("review", \(\) => go\(\{ logging: true, postMode: "show" \}\)\)\}/);
  assert.match(app, /commitReplace\(\{ logging: true, postMode: "show" \}\)/);
});
