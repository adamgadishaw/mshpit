import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("./useIOSTicketAction.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "")
  .replace("export default function", "function");
function fixture(os = "ios", initialReader = true) {
  const refs = [], calls = [], announcements = [];
  let reader = initialReader, readerCalls = 0;
  let state = null, index = 0, previousScope, cleanup;
  const hook = new vm.Script(source + "\nuseIOSTicketAction;").runInNewContext({
    Platform: { OS: os },
    AccessibilityInfo: { announceForAccessibilityWithOptions(message, options) { announcements.push({ message, queue: options.queue }); } },
    useScreenReaderEnabled: () => { readerCalls++; return reader; },
    useState: () => [state, (next) => { state = next; }],
    useRef: (initial) => refs[index++] ||= { current: initial },
    useEffect(effect, [scope]) {
      if (scope === previousScope) return;
      cleanup?.(); cleanup = effect(); previousScope = scope;
    },
    openTicketLink(url, options) {
      return new Promise((resolve) => calls.push({ url, options, finish(status) {
        if (status === "failed" || status === "rejected") options?.onFailure({ status });
        resolve({ status });
      } }));
    },
  });
  return { calls, announcements, readerCalls: () => readerCalls, setReader(value) { reader = value; }, render(scope = "account-a:show-a") { index = 0; return hook(scope); }, unmount() { cleanup?.(); } };
}

test("iOS ticket failures are visible, cancellation quiet and successful retry clears failure", async () => {
  const f = fixture();
  for (const status of ["failed", "rejected", "cancelled", "opened"]) {
    const pending = f.render().open("https://seller.example/show");
    assert.equal(f.render().error, "");
    f.calls.at(-1).finish(status); await pending;
    assert.equal(!!f.render().error, status === "failed" || status === "rejected");
  }
});

test("iOS repeat taps cannot stack ticket confirmation dialogs", async () => {
  const f = fixture(), action = f.render();
  const pending = action.open("https://seller.example/show");
  await action.open("https://seller.example/show");
  assert.equal(f.calls.length, 1);
  f.calls[0].finish("cancelled"); await pending;
  const retry = f.render().open("https://seller.example/show");
  assert.equal(f.calls.length, 2);
  f.calls[1].finish("opened"); await retry;
});

test("ticket responses cannot leak across show/account changes or unmount", async () => {
  const f = fixture();
  const pending = f.render("account-a:show-a").open("https://seller.example/a");
  f.render("account-b:show-b");
  f.render("account-a:show-a");
  f.calls[0].finish("failed"); await pending;
  assert.equal(f.render("account-a:show-a").error, "");
  const current = f.render("account-a:show-a").open("https://seller.example/a");
  f.calls[1].finish("rejected"); await current;
  assert.ok(f.render("account-a:show-a").error);
  assert.equal(f.render("guest:show-a").error, "");
  assert.equal(f.render("account-a:show-a").error, "");
  const unmounted = f.render().open("https://seller.example/a");
  f.unmount(); f.calls.at(-1).finish("failed"); await unmounted;
  assert.equal(f.render().error, "");
});

test("Android/web still call the existing opener without new feedback behavior", async () => {
  for (const os of ["android", "web"]) {
    const f = fixture(os), pending = f.render().open("https://seller.example/show");
    assert.equal(f.calls[0].options, undefined);
    f.calls[0].finish("failed"); await pending;
    assert.equal(f.render().error, "");
    assert.equal(f.announcements.length, 0);
    assert.equal(f.readerCalls(), 0);
  }
});

test("VoiceOver queues one failure per action and never speaks on mount, render, success or cancellation", async () => {
  const f = fixture();
  f.render(); f.render();
  assert.deepEqual(f.announcements, []);
  for (const status of ["failed", "rejected", "cancelled", "opened"]) {
    const before = f.announcements.length;
    const pending = f.render().open("https://seller.example/show");
    await f.render().open("https://seller.example/show");
    assert.equal(f.announcements.length, before);
    const call = f.calls.at(-1);
    call.finish(status);
    if (status === "failed" || status === "rejected") call.options.onFailure({ status });
    await pending;
    const action = f.render(); f.render();
    assert.equal(f.announcements.length, before + (["failed", "rejected"].includes(status) ? 1 : 0));
    if (action.error) assert.deepEqual(f.announcements.at(-1), { message: action.error, queue: true });
  }
});

test("VoiceOver uses the current preference at failure without replaying prior errors", async () => {
  const f = fixture("ios", false);
  let pending = f.render().open("https://seller.example/show");
  f.calls.at(-1).finish("failed"); await pending;
  assert.equal(f.announcements.length, 0);
  f.setReader(true); f.render();
  assert.equal(f.announcements.length, 0, "enabling VoiceOver must not replay an old error");
  pending = f.render().open("https://seller.example/show");
  f.setReader(false); f.render();
  f.calls.at(-1).finish("failed"); await pending;
  assert.equal(f.announcements.length, 0, "disabling VoiceOver during the action is respected");
  pending = f.render().open("https://seller.example/show");
  f.setReader(true); f.render();
  f.calls.at(-1).finish("failed"); await pending;
  assert.equal(f.announcements.length, 1);
});

test("VoiceOver fences old account/show and unmounted failures before enqueueing speech", async () => {
  const f = fixture();
  const pending = f.render("a:show-a").open("https://seller.example/a");
  f.render("b:show-b"); f.render("a:show-a");
  f.calls[0].finish("failed"); await pending;
  assert.equal(f.announcements.length, 0);
  const next = f.render("a:show-a").open("https://seller.example/a");
  f.unmount(); f.calls[1].finish("failed"); await next;
  assert.equal(f.announcements.length, 0);
});
