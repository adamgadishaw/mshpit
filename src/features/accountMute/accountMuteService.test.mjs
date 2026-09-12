import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const calls = [];
globalThis.__pitAccountMuteApi = (...args) => {
  calls.push(args);
  return Promise.resolve({ ok: true });
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith("/src/features/accountMute/accountMuteService.js")
      && specifier === "../../lib/api") {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export const api=(...args)=>globalThis.__pitAccountMuteApi(...args)",
      };
    }
    return nextResolve(specifier, context);
  },
});
const { saveAccountMute } = await import("./accountMuteService.js");
hooks.deregister();

test.after(() => {
  delete globalThis.__pitAccountMuteApi;
});

test("mute writes carry the rendered account identity and caller cancellation", async () => {
  calls.length = 0;
  const controller = new AbortController();
  await saveAccountMute("user / two", true, {
    expectedAccountId: "account-a",
    signal: controller.signal,
  });
  assert.deepEqual(calls, [[
    "/api/users/user / two/mute",
    {
      method: "POST",
      body: { muted: true },
      context: "Muting this account",
      expectedAccountId: "account-a",
      signal: controller.signal,
    },
  ]]);
});
