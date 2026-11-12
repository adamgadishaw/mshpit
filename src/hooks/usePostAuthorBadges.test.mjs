import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import { subscribeAuthorBadgeChanges, publishAuthorBadgeChange } from "../domain/authorBadgeChanges.mjs";
import { reconcilePostAuthorBadges, postBadgeBundle } from "../domain/postBadgeBundle.mjs";

const source = readFileSync(new URL("./usePostAuthorBadges.js", import.meta.url), "utf8");
const declaration = parse(source, { sourceType: "module" }).program.body.find(node => node.type === "ExportNamedDeclaration").declaration;
function fixture() {
  let state = null, dependencies, cleanup, effect;
  const hook = new Function("useEffect", "useState", "subscribeAuthorBadgeChanges", "reconcilePostAuthorBadges", `return (${source.slice(declaration.start, declaration.end)});`)(
    (fn, deps) => { if (!dependencies || deps.some((value, i) => value !== dependencies[i])) effect = () => { cleanup?.(); dependencies = deps; cleanup = fn(); }; },
    () => [state, next => { state = next; }], subscribeAuthorBadgeChanges, reconcilePostAuthorBadges,
  );
  return { render(post, accountId) { const result = hook(post, accountId); effect?.(); effect = null; return result; }, unmount() { cleanup?.(); } };
}

test("mounted standalone post drops revoked authority without changing post identity or contents", () => {
  const f = fixture();
  try {
    const post = { id: "standalone", userId: "author", review: "Original review", photos: ["photo"], user: { name: "Author", ...postBadgeBundle({ role: "admin", verified: true, sponsor: true }) } };
    assert.equal(f.render(post, "viewer"), post);
    publishAuthorBadgeChange({ accountId: "viewer", user: { id: "author", role: "fan", verified: false, sponsor: false, profileBadges: [] } });
    const updated = f.render(post, "viewer");
    assert.equal(updated.id, post.id);
    assert.equal(updated.review, post.review);
    assert.equal(updated.photos, post.photos);
    assert.equal(updated.user.name, "Author");
    assert.equal(updated.user.verified, false);
    assert.equal(updated.user.role, "fan");
    assert.equal(updated.user.sponsor, false);
    assert.deepEqual(updated.user.profileBadges, []);
  } finally { f.unmount(); }
});

test("badge events isolate viewers and authors and yield to a replacement post snapshot", () => {
  const f = fixture(), post = { id: "p", userId: "author", user: postBadgeBundle({ verified: true }) };
  try {
    f.render(post, "A");
    publishAuthorBadgeChange({ accountId: "B", user: { id: "author", verified: false } });
    publishAuthorBadgeChange({ accountId: "A", user: { id: "other", verified: false } });
    assert.equal(f.render(post, "A"), post);
    publishAuthorBadgeChange({ accountId: "A", user: { id: "author", verified: false } });
    assert.equal(f.render(post, "A").user.verified, false);
    assert.equal(f.render(post, "B"), post, "A's authority overlay is not carried to B");
    publishAuthorBadgeChange({ accountId: "A", user: { id: "author", role: "admin" } });
    assert.equal(f.render(post, "B"), post);
    const fresh = { ...post, user: postBadgeBundle({ verified: false }) };
    assert.equal(f.render(fresh, "B"), fresh);
  } finally { f.unmount(); }
});

test("PostScreen reconciles its navigation fallback before applying local post edits", () => {
  const screen = readFileSync(new URL("../screens/PostScreen.jsx", import.meta.url), "utf8");
  assert.match(screen, /usePostAuthorBadges\(detail \? currentReview\(log, feed\.find\([\s\S]*?\|\| log, session\?\.id \|\| null\)/);
  assert.match(screen, /applyPostLocalOverride\(\s*authorReconciledLog,/);
});
