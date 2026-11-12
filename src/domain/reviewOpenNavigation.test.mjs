import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";

const source = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const root = parse(source, { sourceType: "module", plugins: ["jsx"] }).program.body.find(node => node.type === "FunctionDeclaration" && node.id.name === "Root");
function action(name, dependencies) {
  const declaration = root.body.body.filter(node => node.type === "VariableDeclaration")
    .flatMap(node => node.declarations).find(node => node.id.name === name).init;
  return new Function(...Object.keys(dependencies), `return (${source.slice(declaration.start, declaration.end)});`)(...Object.values(dependencies));
}

test("latest linked-review intent wins regardless of response order", async () => {
  for (const firstResponse of ["first", "second"]) {
    const requests = {}, opened = [];
    const postOpenSequence = { current: 0 }, sessionRef = { current: { id: "viewer" } }, stackRef = { current: [{}] };
    const open = action("openPostById", {
      Platform: { OS: "web" }, session: sessionRef.current, sessionRef, stackRef, postOpenSequence,
      loadPostForView: id => new Promise(resolve => { requests[id] = resolve; }),
      openSignIn: () => assert.fail("public review must not require sign-in"),
      openPost: post => { postOpenSequence.current++; opened.push(post.id); },
    });
    const first = open("first"), second = open("second");
    requests[firstResponse]({ id: firstResponse });
    await Promise.resolve();
    requests[firstResponse === "first" ? "second" : "first"]({ id: firstResponse === "first" ? "second" : "first" });
    await Promise.all([first, second]);
    assert.deepEqual(opened, ["second"]);
  }
});

test("linked review loads cannot navigate after an account or originating-view change", async () => {
  for (const change of ["account", "view"]) {
    let resolve;
    const sessionRef = { current: { id: "viewer" } }, stackRef = { current: [{}] };
    const open = action("openPostById", {
      Platform: { OS: "web" }, session: sessionRef.current, sessionRef, stackRef, postOpenSequence: { current: 0 },
      loadPostForView: () => new Promise(done => { resolve = done; }), openSignIn() {},
      openPost: () => assert.fail("stale review request navigated"),
    });
    const pending = open("private-review");
    if (change === "account") sessionRef.current = { id: "other-viewer" }; else stackRef.current = [{ artistName: "Elsewhere" }];
    resolve({ id: "private-review" }); await pending;
  }
});

test("event resolution from a retained review cannot replace its newer gallery or account", () => {
  const opened = [], session = { id: "viewer" }, sessionRef = { current: session };
  const nav = { post: { id: "review" } }, stackRef = { current: [{}, nav] };
  const open = action("openPostEvent", { session, sessionRef, nav, stackRef, openShow: log => opened.push(log) });
  const event = { id: "event", performanceEvent: true };
  open(event); assert.deepEqual(opened, [event]);
  stackRef.current = [{}, nav, { photos: {} }]; open(event);
  stackRef.current = [{}, nav]; sessionRef.current = { id: "other-viewer" }; open(event);
  assert.deepEqual(opened, [event]);
});
