import assert from "node:assert/strict";
import test from "node:test";

import { deliverPostCreate, shouldRetryPostCreate } from "./postDelivery.mjs";

test("post create retries only ambiguous or temporary failures", () => {
  for (const status of [0, 408, 425, 500, 502, 503, 504]) {
    assert.equal(shouldRetryPostCreate({ status }), true, `status ${status}`);
  }
  for (const status of [400, 401, 403, 409, 422, 429]) {
    assert.equal(shouldRetryPostCreate({ status }), false, `status ${status}`);
  }
});

test("post delivery reuses the exact body and account across a lost response", async () => {
  const calls = [];
  const waits = [];
  const body = Object.freeze({ clientMutationId: "post_retry_12345678", kind: "status", review: "hello" });
  const result = await deliverPostCreate({
    apiCall: async (path, options) => {
      calls.push({ path, options });
      if (calls.length === 1) throw Object.assign(new Error("lost response"), { status: 0 });
      return { id: "p_server", duplicate: true };
    },
    body,
    context: "Posting your update",
    expectedAccountId: "u_1",
    retryDelaysMs: [25],
    wait: async (delay) => waits.push(delay),
  });

  assert.deepEqual(result, { id: "p_server", duplicate: true });
  assert.deepEqual(waits, [25]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, "/api/posts");
  assert.equal(calls[0].options.body, body);
  assert.equal(calls[1].options.body, body);
  assert.equal(calls[1].options.expectedAccountId, "u_1");
  assert.equal(calls[1].options.silent, true);
  assert.equal(calls[1].options.timeoutMs, 12_000);
});

test("post delivery never retries validation, auth, conflict, or rate limits", async () => {
  for (const status of [400, 401, 409, 429]) {
    let calls = 0;
    await assert.rejects(() => deliverPostCreate({
      apiCall: async () => {
        calls += 1;
        throw Object.assign(new Error("definitive"), { status });
      },
      body: { clientMutationId: `post_no_retry_${status}` },
      retryDelaysMs: [0, 0],
      wait: async () => assert.fail("definitive failures must not wait"),
    }));
    assert.equal(calls, 1);
  }
});

test("post delivery stops after its bounded retry budget", async () => {
  let calls = 0;
  const failure = Object.assign(new Error("offline"), { status: 503 });
  await assert.rejects(() => deliverPostCreate({
    apiCall: async () => { calls += 1; throw failure; },
    body: { clientMutationId: "post_bounded_retry_1" },
    retryDelaysMs: [0, 0],
    wait: async () => {},
  }), (error) => error === failure);
  assert.equal(calls, 3);
});


test("creator delivery rejects mixed-version responses that omit or change the page attachment", async () => {
  const creatorUpdate = { version: 1, entityType: "artist", entityKey: "sample", kind: "release", title: "Album news", date: "", location: "", url: "" };
  const body = { kind: "status", clientMutationId: "creator_delivery_1", creatorUpdate };
  for (const post of [{ id: "p" }, { id: "p", creatorUpdate: { ...creatorUpdate, entityKey: "another" } }]) {
    await assert.rejects(deliverPostCreate({ body, apiCall: async () => ({ id: "p", post }), retryDelaysMs: [] }), /could not be confirmed/);
  }
  const response = { id: "p", post: { id: "p", creatorUpdate: { ...creatorUpdate, entityName: "Sample" } } };
  assert.equal(await deliverPostCreate({ body, apiCall: async () => response }), response);
});

test("scheduled calendar delivery validates its receipt and retries the same interrupted submission",async()=>{
  const body={clientMutationId:"calendar_receipt_123",creatorUpdate:{calendar:{action:"create"}}};let calls=0;
  const response=await deliverPostCreate({body,expectedAccountId:"artist",wait:async()=>{},retryDelaysMs:[0],apiCall:async(path,options)=>{
    assert.equal(options.body,body);if(++calls===1)throw new Error("lost response");
    return {calendarReceipt:{mutationId:body.clientMutationId,state:"scheduled",eventId:"td_saved"}};
  }});
  assert.equal(calls,2);assert.equal(response.calendarReceipt.eventId,"td_saved");
  await assert.rejects(()=>deliverPostCreate({body,retryDelaysMs:[],apiCall:async()=>({calendarReceipt:{state:"scheduled",mutationId:"someone_else"}})}),/could not be confirmed/);
});
