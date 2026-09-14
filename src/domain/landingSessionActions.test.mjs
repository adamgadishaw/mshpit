import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { LANDING_IDENTITY_COPY } from "./landingPresentation.mjs";

const source = readFileSync(new URL("../screens/LandingScreen.jsx", import.meta.url), "utf8");
const actions = [];
let signedInExpression;
function visit(node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "VariableDeclarator" && node.id?.name === "signedIn") signedInExpression = node.init;
  if (node.type === "JSXOpeningElement" && node.name?.name === "LandingAction") actions.push(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") visit(value);
  }
}
visit(parse(source, { sourceType: "module", plugins: ["jsx"] }).program);

function actualActions(session) {
  assert.ok(signedInExpression, "landing actions must use the current session");
  const callbacks = { onOpenYou() {}, onOpenFeed() {}, onLogin() {}, onSignup() {}, onBrowse() {} };
  const signedIn = new Function("session", `return (${source.slice(signedInExpression.start, signedInExpression.end)});`)(session);
  const bindings = { signedIn, LANDING_IDENTITY_COPY, compact: false, ...callbacks };
  const props = actions.map((node) => Object.fromEntries(node.attributes
    .filter((attr) => attr.type === "JSXAttribute")
    .map((attr) => {
      const value = attr.value;
      if (value?.type === "StringLiteral") return [attr.name.name, value.value];
      if (value?.type === "JSXExpressionContainer") return [attr.name.name,
        new Function(...Object.keys(bindings), `return (${source.slice(value.expression.start, value.expression.end)});`)(...Object.values(bindings))];
      return [attr.name.name, true];
    })));
  return { props, callbacks };
}

test("actual signed-in landing actions agree across normal and modified clicks", () => {
  for (const session of [{ id: "first-member" }, { id: "switched-member" }]) {
    const { props, callbacks } = actualActions(session);
    const profile = props.find((item) => item.kind === "login");
    const feed = props.find((item) => item.href === "/feed");
    assert.equal(profile.title, "You");
    assert.equal(profile.href, "/you");
    assert.equal(profile.onPress, callbacks.onOpenYou);
    assert.equal(feed.title, "Open your feed");
    assert.equal(feed.onPress, callbacks.onOpenFeed);
    assert.equal(props.some((item) => item.href === "/signup" || item.href === "/login"), false);
    assert.equal(props.find((item) => item.href === "/events").onPress, callbacks.onBrowse);
  }
});

test("actual guest landing actions retain login and signup without treating an empty session as authenticated", () => {
  for (const session of [null, undefined, {}, { id: "" }]) {
    const { props, callbacks } = actualActions(session);
    const login = props.find((item) => item.kind === "login");
    const signup = props.find((item) => item.href === "/signup");
    assert.equal(login.title, "Log in");
    assert.equal(login.href, "/login");
    assert.equal(login.onPress, callbacks.onLogin);
    assert.equal(signup.title, LANDING_IDENTITY_COPY.signupAction);
    assert.equal(signup.onPress, callbacks.onSignup);
    assert.equal(props.some((item) => item.href === "/you" || item.href === "/feed"), false);
  }
});

test("App wires the current session and member actions to the landing", () => {
  const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  const landing = app.slice(app.indexOf("<LandingScreen"), app.indexOf("<LandingScreen") + 800);
  assert.match(landing, /session=\{session\}/);
  assert.match(landing, /onOpenFeed=\{\(\) => switchTab\("feed"\)\}/);
  assert.match(landing, /onOpenYou=\{\(\) => switchTab\("you"\)\}/);
});
