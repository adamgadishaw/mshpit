import assert from "node:assert/strict";
import test from "node:test";
import { postCardPresentation } from "./postCardPresentation.ios.mjs";

test("details exist only for actual routes or saved information", () => {
  assert.equal(postCardPresentation({}).hasDetails, false);
  for (const post of [{ eventAddress: "A venue address" }, { seen: 2 }, { lineup: ["Opener"] }, { supportingActs: ["Legacy opener"] }, { setlist: ["A song"] }])
    assert.equal(postCardPresentation(post).hasDetails, true);
  for (const options of [{ showHref: "/post/p_1" }, { compareHref: "/artist/one/concerts" }])
    assert.equal(postCardPresentation({}, options).hasDetails, true);
  assert.deepEqual(postCardPresentation({ lineup: ["Act"], setlist: ["Song"] }, { online: true, showHref: "/post/p_1" }), {
    hasDetails: false, detailsSummary: "", stackContext: false,
  });
});

test("summary counts canonical acts without surfacing scores or spoilers", () => {
  const post = { artist: "Main", lineup: ["Main", "Opener", "Opener", "Other"], setlist: ["Secret song", "Encore"] };
  const before = structuredClone(post);
  assert.equal(postCardPresentation(post).detailsSummary, "2 acts · 2 songs");
  assert.deepEqual(post, before);
  assert.equal(postCardPresentation({ supportingActs: ["Act"], setlist: ["Song"] }).detailsSummary, "1 act · 1 song");
});

test("narrow and large text contexts stack instead of shrinking or clipping", () => {
  assert.equal(postCardPresentation({}, { width: 320 }).stackContext, true);
  assert.equal(postCardPresentation({}, { width: 390 }).stackContext, false);
  assert.equal(postCardPresentation({}, { width: 430, fontScale: 2 }).stackContext, true);
  assert.equal(postCardPresentation({}, { width: NaN, fontScale: 0 }).stackContext, false);
});
