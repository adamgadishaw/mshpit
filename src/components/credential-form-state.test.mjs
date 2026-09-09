import test from "node:test";
import assert from "node:assert/strict";
import { createCredentialSubmitGuard, credentialFieldId } from "./credential-form-state.mjs";

test("credential forms reject duplicates before React disables the controls", async () => {
  const submit = createCredentialSubmitGuard();
  let finish, requests = 0;
  const action = () => { requests++; return new Promise(resolve => { finish = resolve; }); };
  const first = submit(action);
  await submit(action);
  assert.equal(requests, 1);
  finish("done");
  assert.equal(await first, "done");
  assert.equal(await submit(() => ++requests), 2);
});

test("disabled forms cannot submit, and failures release the retry lock", async () => {
  const submit = createCredentialSubmitGuard();
  let requests = 0;
  await submit(() => ++requests, true);
  assert.equal(requests, 0);
  await assert.rejects(submit(() => { throw new Error("fixture failure"); }), /fixture failure/);
  assert.equal(await submit(() => ++requests), 1);
});

test("credential IDs are stable and separated by form and field", () => {
  assert.equal(credentialFieldId("login", "password"), "login-password");
  assert.notEqual(credentialFieldId("login", "password"), credentialFieldId("signup", "password"));
});
