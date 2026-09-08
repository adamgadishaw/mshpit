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

test("the compact reminder reserves layout space and cannot cover setup's Back control", () => {
  const compactStyle = banner.slice(banner.indexOf("  banner: {"), banner.indexOf("  bannerMark:"));
  assert.doesNotMatch(compactStyle, /position:|zIndex:|top:/);
  assert.match(banner, /style=\{styles.bannerSlot\}/);
  assert.match(app, /session.emailVerified === false && !nav.signupSetup/);
  assert.ok(app.indexOf("<VerifyEmailBanner") < app.indexOf('{landingSurface === "pending"'));
});

test("new-account artist picks intercept save before the protected profile request", () => {
  const guard = picks.indexOf("if (needsEmailVerification)");
  const mutation = picks.indexOf("await updateProfile");
  assert.ok(guard >= 0 && mutation > guard);
  assert.match(picks, /onRequireVerification\?\.\(\)/);
  assert.match(picks, /Confirm your email before saving these picks/);
});

test("confirmation and expired links offer a direct login continuation without auto-signing in", () => {
  assert.match(confirmation, /Continue to log in/);
  assert.match(confirmation, /Log in to get a new link/);
  assert.equal((confirmation.match(/onPress=\{onLogin \|\| onDone\}/g) || []).length, 2);
  assert.match(confirmation, /if \(requestRef\.current\) return;/);
  const tree = parse(app, { sourceType: "module", plugins: ["jsx"] });
  let login;
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "JSXOpeningElement" && node.name?.name === "VerifyEmailScreen") {
      login = node.attributes.find((attribute) => attribute.name?.name === "onLogin")?.value?.expression;
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  }
  visit(tree);
  assert.ok(login, "App wires a direct verification-to-login action");
  const calls = [], stack = [{}];
  const run = new Function("clearVerifyUrl", "enter", "go", `return (${app.slice(login.start, login.end)});`)(
    () => calls.push("clear-token"), () => calls.push("enter"), (route) => { calls.push(route); stack.push(route); },
  );
  assert.deepEqual(calls, [], "Only the explicit button action opens login");
  run();
  assert.deepEqual(calls, ["clear-token", "enter", { auth: true, authMode: "login" }]);
  assert.equal(stack.length, 2, "login must open above the root so its completion can go back");
  stack.pop();
  assert.deepEqual(stack, [{}], "successful login returns to browsing, not a setup gate");
});
