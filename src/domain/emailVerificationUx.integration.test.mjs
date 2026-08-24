import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";

const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const banner = readFileSync(new URL("../components/VerifyEmailBanner.jsx", import.meta.url), "utf8");
const picks = readFileSync(new URL("../screens/PickArtistsScreen.jsx", import.meta.url), "utf8");
const confirmation = readFileSync(new URL("../screens/VerifyEmailScreen.jsx", import.meta.url), "utf8");

test("verification-first UI files remain parseable", () => {
  for (const [name, source] of Object.entries({ app, banner, picks, confirmation })) {
    assert.doesNotThrow(() => parse(source, { sourceType: "module", plugins: ["jsx"] }), `${name} must parse`);
  }
});

test("protected composers are intercepted before an unverified account enters them", () => {
  assert.match(app, /const requireVerifiedMutation = \(intent, fn\) =>/);
  assert.match(app, /requireVerifiedMutation\("post", \(\) => go\(\{ logging: true, postMode: "status" \}\)\)/);
  assert.match(app, /requireVerifiedMutation\("review", \(\) => go\(\{ logging: true/);
  assert.match(app, /requireVerifiedMutation\("artist", \(\) => go\(\{ logging: true, postMode: "campaign" \}\)\)/);
  assert.match(app, /blockedAction=\{verificationPrompt\}/);
});

test("the persistent reminder cannot be dismissed and the expanded gate keeps account rights clear", () => {
  assert.doesNotMatch(banner, /setState\("dismissed"\)/);
  assert.match(banner, /Confirm your email to join in/);
  assert.match(banner, /accessibilityViewIsModal/);
  assert.match(banner, /Browsing, account export, privacy settings, and account deletion remain available/);
  assert.match(banner, /onResend\?\.\(\{ signal: controller\.signal \}\)/);
  assert.doesNotMatch(confirmation, /account already works either way/i);
  assert.match(confirmation, /You can browse without confirming/);
});

test("new-account artist picks intercept save before the protected profile request", () => {
  const guard = picks.indexOf("if (needsEmailVerification)");
  const mutation = picks.indexOf("await updateProfile");
  assert.ok(guard >= 0 && mutation > guard);
  assert.match(picks, /onRequireVerification\?\.\(\)/);
  assert.match(picks, /Confirm your email before saving these picks/);
});
