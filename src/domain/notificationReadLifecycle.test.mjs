import assert from "node:assert/strict";
import test from "node:test";
import { createNotificationActivity } from "../features/notifications/notificationActivityState.mjs";
const tick = () => new Promise(setImmediate);
const row = (id, extra = {}) => ({ id, ts: 100, actorId: "peer", userId: "A", read: false, type: "follow", ...extra });
const page = (rows, nextCursor = null, unread = rows.filter(r=>!r.read).length) => ({ notifications: rows, nextCursor, unread, readContract: "notification-ids-v1" });
const confirmed = (ids, unread = 0) => ({ readContract: "notification-ids-v1", notificationIds: ids, unread });
function fixture() {
  let identity = { accountId: "A", epoch: 1, ready: true }, hidden = [];
  const reads = [], writes = [];
  const capture = into => args => new Promise((resolve,reject)=>into.push({args,resolve,reject}));
  const controller = createNotificationActivity({getIdentity:()=>identity,getHiddenActorIds:()=>hidden,
    fetchPage:capture(reads),writeReads:capture(writes),makeError:message=>Object.assign(new Error(message),{name:"AppError",code:"PIT-NET-001",retryable:true}),normalizeError:error=>Object.assign(error,{name:"AppError",code:"PIT-NET-001",retryable:true})});
  return {controller,reads,writes,rows:()=>controller.getSnapshot().data.rows,
    hide:ids=>{hidden=ids;}, switch:()=>{identity={...identity,epoch:identity.epoch+1}; controller.scope();}};
}

test("opening loads and acknowledges every historical page beyond 1000 without hiding rows",async()=>{
  const f=fixture(), loading=f.controller.load({allHistory:true});
  for(let n=0;n<12;n++) {
    await tick(); assert.equal(f.reads.length,n+1);
    f.reads[n].resolve(page(Array.from({length:100},(_,i)=>row(`n${n*100+i}`,{ts:2000-n*100-i})),n<11?`cursor${n}`:null,1200));
  }
  const rows=await loading;assert.equal(rows.length,1200);assert.equal(f.rows().length,1200);
  const ack=f.controller.markRead({rows});
  for(let n=0;n<12;n++) {await tick();assert.equal(f.writes[n].args.notificationIds.length,100);f.writes[n].resolve(confirmed(f.writes[n].args.notificationIds,1100-n*100));}
  assert.equal((await ack).ok,true);assert.equal(f.rows().filter(r=>r.read).length,1200);
  assert.equal(f.controller.getSnapshot().data.unread,0);
  f.controller.setRows(rows=>[row("newest",{ts:3000}),...rows]);
  assert.equal(f.rows().length,1201,"a new arrival must not evict expanded historical rows");
  const poll=f.controller.load({updates:true});await tick();
  f.reads.at(-1).resolve(page([row("unconnected",{ts:4000})],"gap",2));await poll;
  assert.equal(f.rows().length,1202,"background heads retain previously opened history even across a gap");
  f.controller.unmount();
});

test("opening preserves concurrent arrivals in history but excludes them from captured acknowledgement",async()=>{
  const f=fixture(); f.controller.setRows([row("old")]);
  const loading=f.controller.load({allHistory:true}); await tick();
  f.reads[0].resolve(page([row("head")],"older",2));await tick();
  f.controller.setRows(rows=>[row("arrived",{ts:300}),...rows]);
  f.reads[1].resolve(page([row("old")],null,3));
  const captured=await loading;
  assert.deepEqual(captured.map(r=>r.id).sort(),["head","old"]);
  assert.deepEqual(f.rows().map(r=>r.id).sort(),["arrived","head","old"]);
  const ack=f.controller.markRead({rows:captured});await tick();
  assert.deepEqual(f.writes[0].args.notificationIds.sort(),["head","old"]);
  f.writes[0].resolve(confirmed(["head","old"],1));await ack;
  assert.equal(f.rows().find(r=>r.id==="arrived").read,false);
});

test("partial acknowledgement retains confirmations and retries only original still-unread rows",async()=>{
  const f=fixture(), original=Array.from({length:105},(_,i)=>row(`n${i}`));
  const loading=f.controller.load({allHistory:true});await tick();f.reads[0].resolve(page(original));const captured=await loading;
  const ack=f.controller.markRead({rows:captured});await tick();
  f.controller.setRows(rows=>[row("concurrent"),...rows]);
  f.writes[0].resolve(confirmed(f.writes[0].args.notificationIds,5));await tick();
  f.writes[1].reject(new Error("offline"));assert.equal((await ack).ok,false);
  assert.equal(f.rows().filter(r=>r.read).length,100);
  const retry=f.controller.markRead({rows:captured});await tick();assert.equal(f.writes[2].args.notificationIds.length,5);
  f.writes[2].resolve(confirmed(f.writes[2].args.notificationIds,1));assert.equal((await retry).ok,true);
  assert.equal(f.rows().filter(r=>r.read).length,105);assert.equal(f.rows().find(r=>r.id==="concurrent").read,false);
});

for(const boundary of ["block","mute"]) test(`opening rechecks ${boundary} after a delayed history page`,async()=>{
  const f=fixture();const loading=f.controller.load({allHistory:true});await tick();
  f.reads[0].resolve(page([row("head")],"older"));await tick();f.hide(["peer"]);
  f.reads[1].resolve(page([row("old"),row("allowed",{actorId:"other"})]));
  const rows=await loading;assert.deepEqual(rows.map(r=>r.id),["allowed"]);assert.deepEqual(f.rows().map(r=>r.id),["allowed"]);
});

test("account epoch retirement aborts an entire history traversal and discards old completion",async()=>{
  const f=fixture();const loading=f.controller.load({allHistory:true});await tick();f.reads[0].resolve(page([row("head")],"older"));await tick();
  f.switch();assert.equal(f.reads[1].args.signal.aborted,true);f.reads[1].resolve(page([row("old")]));
  await assert.rejects(loading,{name:"AbortError"});assert.deepEqual(f.rows(),[]);assert.equal(f.writes.length,0);
});

test("failed or looping history pages retain the previous unread history and do not acknowledge",async()=>{
  for(const failure of [true,false]) {
    const f=fixture();f.controller.setRows([row("retained")]);
    const loading=f.controller.load({allHistory:true});await tick();f.reads[0].resolve(page([row("head")],"older"));await tick();
    if(failure)f.reads[1].reject(new Error("offline"));else f.reads[1].resolve(page([row("older")],"older"));
    await assert.rejects(loading);assert.deepEqual(f.rows().map(r=>r.id),["retained"]);assert.equal(f.rows()[0].read,false);assert.equal(f.writes.length,0);
  }
});

test("cancelled acknowledgement completion cannot mark its pending rows or affect a new account",async()=>{
  for(const changeAccount of [true,false]) {
    const f=fixture(), loading=f.controller.load();await tick();f.reads[0].resolve(page([row("one")]));await loading;
    const controller=new AbortController();const ack=f.controller.markRead({signal:controller.signal});await tick();
    if(changeAccount) f.switch(); else controller.abort();
    f.writes[0].resolve(confirmed(["one"]));await assert.rejects(ack,{name:"AbortError"});assert.ok(f.rows().every(row=>!row.read));
  }
});
