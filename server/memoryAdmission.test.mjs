import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryAdmission, createMemoryReader, startMemoryMonitor } from "./memoryAdmission.js";

const MIB = 1024 * 1024;
const healthy = () => ({ limitBytes: 2048 * MIB, usedBytes: 300 * MIB, rssBytes: 200 * MIB,
  heapUsedBytes: 100 * MIB, externalBytes: 20 * MIB, source: "container" });

test("container accounting includes child/native memory and respects the smaller configured limit", () => {
  const files = { "/sys/fs/cgroup/memory.max": String(2048 * MIB),
    "/sys/fs/cgroup/memory.current": String(1200 * MIB) };
  const readMemory = createMemoryReader({ read: (path) => files[path], platform: "linux",
    memoryUsage: () => ({ rss: 300 * MIB }), constrainedMemory: () => 2048 * MIB,
    totalMemory: () => 16000 * MIB, env: { PIT_MEMORY_LIMIT_MB: "1800" } });
  assert.equal(readMemory().usedBytes, 1200 * MIB);
  assert.equal(readMemory().limitBytes, 1800 * MIB);
  assert.equal(readMemory().source, "container");
  const admission = createMemoryAdmission({ readMemory });
  assert.equal(admission.tryAcquire("image"), null, "parent RSS alone would incorrectly admit a large decode");
  assert.ok(admission.tryAcquire("share"), "small work may fit the remaining budget");
});

test("cold file cache cannot permanently starve a photo while dirty and anonymous memory remain charged", () => {
  const files = { '/sys/fs/cgroup/memory.max': String(2048*MIB), '/sys/fs/cgroup/memory.current': String(1095*MIB),
    '/sys/fs/cgroup/memory.stat': `inactive_file ${546*MIB}\nfile ${560*MIB}\nshmem 0\nfile_dirty 0\nfile_writeback 0\n` };
  const options = { read: path => files[path], platform:'linux', memoryUsage:()=>({rss:526*MIB}),
    constrainedMemory:()=>2048*MIB, totalMemory:()=>16000*MIB, env:{} };
  const readMemory=createMemoryReader(options);
  assert.equal(readMemory().chargedBytes,1095*MIB);assert.equal(readMemory().usedBytes,549*MIB);
  const admission=createMemoryAdmission({readMemory});const lease=admission.tryAcquire('image');assert.ok(lease);lease.release();
  files['/sys/fs/cgroup/memory.stat']=`inactive_file ${546*MIB}\nfile ${560*MIB}\nshmem 0\nfile_dirty ${540*MIB}\nfile_writeback ${6*MIB}\n`;
  assert.equal(readMemory().usedBytes,1095*MIB);assert.equal(admission.tryAcquire('image'),null);
  files['/sys/fs/cgroup/memory.current']=String(1900*MIB);
  files['/sys/fs/cgroup/memory.stat']=`inactive_file ${546*MIB}\nfile ${560*MIB}\nshmem 0\nfile_dirty 0\nfile_writeback 0\n`;
  assert.equal(admission.tryAcquire('image'),null,'real working-set pressure still denies the worker');
});

test("cache accounting fails closed for missing, malformed or inconsistent stats and never falls below parent RSS", () => {
 const options={platform:'linux',memoryUsage:()=>({rss:526*MIB}),constrainedMemory:()=>2048*MIB,totalMemory:()=>16000*MIB,env:{}};
 for(const stats of [undefined,'inactive_file 100', 'inactive_file -1', 'inactive_file 1\nfile 3\nshmem 0\nfile_dirty 0\nfile_writeback NaN',
  'inactive_file 3\nfile 2\nshmem 0\nfile_dirty 0\nfile_writeback 0']){
  const readMemory=createMemoryReader({...options,read:path=>path.endsWith('memory.max')?String(2048*MIB):path.endsWith('memory.current')?String(1095*MIB):stats});
  assert.equal(readMemory().usedBytes,1095*MIB);assert.equal(createMemoryAdmission({readMemory}).tryAcquire('image'),null);
 }
 const readMemory=createMemoryReader({...options,read:path=>path.endsWith('memory.max')?String(2048*MIB):path.endsWith('memory.current')?String(600*MIB):`inactive_file ${550*MIB}\nfile ${550*MIB}\nshmem 0\nfile_dirty 0\nfile_writeback 0`});
 assert.equal(readMemory().usedBytes,526*MIB);
});

test("cgroup v1 discounts only hierarchical inactive clean file cache", () => {
 const files={'/sys/fs/cgroup/memory/memory.limit_in_bytes':String(2048*MIB),'/sys/fs/cgroup/memory/memory.usage_in_bytes':String(1095*MIB),
 '/sys/fs/cgroup/memory/memory.stat':`total_inactive_file ${546*MIB}\ntotal_cache ${560*MIB}\ntotal_shmem 0\ntotal_dirty ${2*MIB}\ntotal_writeback ${3*MIB}`};
 const memory=createMemoryReader({read:path=>files[path],platform:'linux',memoryUsage:()=>({rss:526*MIB}),constrainedMemory:()=>2048*MIB,totalMemory:()=>16000*MIB,env:{}})();
 assert.equal(memory.usedBytes,554*MIB);assert.equal(memory.reclaimableFileBytes,541*MIB);
});

test("positive shared memory remains charged even when inactive-file counters exceed non-shared file bytes", () => {
 for(const v1 of [false,true]){
  const root=v1?'/sys/fs/cgroup/memory/':'/sys/fs/cgroup/';
  const files={
   [root+(v1?'memory.limit_in_bytes':'memory.max')]:String(2048*MIB),
   [root+(v1?'memory.usage_in_bytes':'memory.current')]:String(1200*MIB),
   [root+'memory.stat']:v1
    ?`total_inactive_file ${546*MIB}\ntotal_cache ${560*MIB}\ntotal_shmem ${500*MIB}\ntotal_dirty ${2*MIB}\ntotal_writeback ${3*MIB}`
    :`inactive_file ${546*MIB}\nfile ${560*MIB}\nshmem ${500*MIB}\nfile_dirty ${2*MIB}\nfile_writeback ${3*MIB}`,
  };
  const readMemory=createMemoryReader({read:path=>files[path],platform:'linux',memoryUsage:()=>({rss:526*MIB}),constrainedMemory:()=>2048*MIB,totalMemory:()=>16000*MIB,env:{}});
  assert.equal(readMemory().reclaimableFileBytes,55*MIB);
  assert.equal(readMemory().usedBytes,1145*MIB);
  assert.equal(createMemoryAdmission({readMemory}).tryAcquire('image'),null,'shared memory pressure cannot be discounted to admit an image');
 }
});

test("duplicate counters and a cache discount larger than total usage retain raw charged accounting", () => {
 const stats=`inactive_file ${546*MIB}\nfile ${560*MIB}\nshmem 0\nfile_dirty 0\nfile_writeback 0`;
 for(const [usage,text] of [[1095*MIB,stats+`\ninactive_file ${546*MIB}`],[100*MIB,stats]]){
  const readMemory=createMemoryReader({read:path=>path.endsWith('memory.max')?String(2048*MIB):path.endsWith('memory.current')?String(usage):text,
   platform:'linux',memoryUsage:()=>({rss:50*MIB}),constrainedMemory:()=>2048*MIB,totalMemory:()=>16000*MIB,env:{}});
  assert.equal(readMemory().reclaimableFileBytes,0);assert.equal(readMemory().usedBytes,usage);
 }
});

test("cgroup v1 and Node constrained-memory fallback account for the host limit", () => {
  const read = (path) => path.endsWith("memory.limit_in_bytes") ? String(2048 * MIB)
    : path.endsWith("memory.usage_in_bytes") ? String(1000 * MIB) : "max";
  const options = { platform: "linux", read, memoryUsage: () => ({ rss: 100 * MIB }),
    constrainedMemory: () => 2048 * MIB, availableMemory: () => 700 * MIB,
    totalMemory: () => 8000 * MIB, env: {} };
  assert.equal(createMemoryReader(options)().usedBytes, 1000 * MIB);
  const fallback = createMemoryReader({ ...options, read: () => { throw new Error("ENOENT"); } })();
  assert.equal(fallback.usedBytes, 1348 * MIB);
  assert.equal(fallback.source, "constrained");
});

test("unlimited and malformed container/config values never become fake memory headroom", () => {
  const readMemory = createMemoryReader({ platform: "linux", read: () => "max",
    memoryUsage: () => ({ rss: 128 * MIB }), constrainedMemory: () => 0,
    totalMemory: () => 2048 * MIB, env: { PIT_MEMORY_LIMIT_MB: "not-a-number" } });
  assert.equal(readMemory().limitBytes, 2048 * MIB);
  assert.equal(readMemory().usedBytes, 128 * MIB);
});

test("a broader cgroup root cannot substitute sibling usage for a nested service limit", () => {
  const readMemory = createMemoryReader({ platform: "linux",
    read: (path) => path.endsWith("memory.max") ? String(16000 * MIB) : String(8000 * MIB),
    memoryUsage: () => ({ rss: 128 * MIB }), constrainedMemory: () => 2048 * MIB,
    availableMemory: () => 1500 * MIB, totalMemory: () => 16000 * MIB, env: {} });
  assert.equal(readMemory().usedBytes, 548 * MIB);
  assert.equal(readMemory().source, "constrained");
});

test("a failed metrics sample cannot crash the server or stop subsequent samples", () => {
  let callback;
  let fail = true;
  const messages = [];
  const admission = createMemoryAdmission({ readMemory: healthy });
  const monitor = startMemoryMonitor({
    snapshot: () => { if (fail) throw new Error("metrics temporarily unavailable"); return admission.snapshot(); },
    log: (line) => messages.push(line),
    setIntervalFn: (fn) => { callback = fn; return { unref() {} }; }, clearIntervalFn() {},
  });
  fail = false;
  callback();
  monitor.stop();
  assert.equal(messages[0], "[memory] resource_sample_unavailable");
  assert.match(messages[1], /source=container/);
});

test("photo, share and sitemap heavy stages never overlap and release is idempotent", () => {
  const admission = createMemoryAdmission({ readMemory: healthy });
  const photo = admission.tryAcquire("image");
  assert.ok(photo);
  assert.equal(admission.tryAcquire("share"), null);
  assert.equal(admission.tryAcquire("sitemap"), null);
  assert.equal(admission.tryAcquire("background"), null);
  photo.release();
  photo.release();
  assert.equal(admission.snapshot().reservedBytes, 0);
  const sitemap = admission.tryAcquire("sitemap");
  assert.ok(sitemap);
  assert.equal(admission.tryAcquire("image"), null);
  sitemap.release();
  assert.deepEqual(admission.snapshot().activeKinds, []);
});

test("already running maintenance permits an interactive photo only if both reservations fit", () => {
  let usedBytes = 300 * MIB;
  const admission = createMemoryAdmission({ readMemory: () => ({ ...healthy(), usedBytes }) });
  const background = admission.tryAcquire("background");
  assert.ok(background);
  assert.equal(admission.tryAcquire("sitemap"), null);
  usedBytes = 1000 * MIB;
  assert.equal(admission.tryAcquire("image"), null);
  usedBytes = 300 * MIB;
  const photo = admission.tryAcquire("image");
  assert.ok(photo);
  photo.release();
  background.release();
  assert.equal(admission.snapshot().reservedBytes, 0);
});

test("bounded waiters prioritize interactive work over earlier background recovery", async () => {
  const admission = createMemoryAdmission({ readMemory: healthy });
  const sitemap = admission.tryAcquire("sitemap");
  assert.ok(sitemap);
  const background = admission.acquire("background", { priority: "background", timeoutMs: 1_000 });
  const share = admission.acquire("share", { priority: "interactive", timeoutMs: 1_000 });
  assert.deepEqual(admission.snapshot().queuedByKind,
    { image: 0, share: 1, sitemap: 0, background: 1 });
  sitemap.release();
  const shareLease = await share;
  assert.ok(shareLease);
  assert.deepEqual(admission.snapshot().activeKinds, ["share"]);
  assert.equal(admission.snapshot().queuedByKind.background, 1);
  shareLease.release();
  const backgroundLease = await background;
  assert.ok(backgroundLease);
  backgroundLease.release();
  assert.equal(admission.snapshot().queued, 0);
  assert.equal(admission.snapshot().admittedByKind.share, 1);
});

test("aborting a memory waiter immediately releases its retained-byte budget", async () => {
  const admission = createMemoryAdmission({ readMemory: healthy });
  const image = admission.tryAcquire("image");
  const controller = new AbortController();
  const pending = admission.acquire("share", {
    signal: controller.signal,
    retainedBytes: 6 * MIB,
    timeoutMs: 1_000,
  });
  assert.equal(admission.snapshot().queuedRetainedBytes, 6 * MIB);
  controller.abort(new DOMException("caller left", "AbortError"));
  await assert.rejects(pending, (error) => error.name === "AbortError");
  assert.equal(admission.snapshot().queuedRetainedBytes, 0);
  assert.equal(admission.snapshot().queued, 0);
  image.release();
});

test("interactive uploads preempt sitemap work once but wait for its actual release", async () => {
  const admission = createMemoryAdmission({ readMemory: healthy });
  let cancellations = 0;
  const sitemap = admission.tryAcquire("sitemap", { onPreempt() { cancellations++; } });
  assert.equal(admission.snapshot().reservedBytes, 576 * MIB);
  const background = admission.acquire("background", { timeoutMs: 1000 });
  assert.equal(cancellations, 0, "ordinary maintenance cannot cancel a sitemap");
  let admitted = false;
  const photo = admission.acquire("image", { timeoutMs: 1000 }).then(lease => { admitted = true; return lease; });
  assert.equal(cancellations, 1);
  const share = admission.acquire("share", { timeoutMs: 1000 });
  assert.equal(cancellations, 1, "one worker receives only one cancellation");
  await Promise.resolve();
  assert.equal(admitted, false, "cancellation is not proof of process death");
  sitemap.release();
  const photoLease = await photo;
  assert.ok(photoLease);
  photoLease.release();
  const shareLease = await share;
  assert.ok(shareLease);
  shareLease.release();
  (await background).release();
});

test("a failed sitemap cancellation never releases its memory reservation", async () => {
  const admission = createMemoryAdmission({ readMemory: healthy });
  const sitemap = admission.tryAcquire("sitemap", { onPreempt() { throw new Error("not stopped"); } });
  const controller = new AbortController();
  const photo = admission.acquire("image", { signal: controller.signal });
  assert.deepEqual(admission.snapshot().activeKinds, ["sitemap"]);
  controller.abort();
  await assert.rejects(photo, { name: "AbortError" });
  sitemap.release();
});

test("under memory pressure heavy work is deferred without allocating a wait queue", () => {
  const admission = createMemoryAdmission({ readMemory: () => ({ ...healthy(), usedBytes: 2000 * MIB }) });
  for (let index = 0; index < 10000; index += 1) assert.equal(admission.tryAcquire("share"), null);
  assert.equal(admission.snapshot().denied, 10000);
  assert.equal(admission.snapshot().reservedBytes, 0);
  assert.deepEqual(admission.snapshot().activeKinds, []);
  assert.throws(() => admission.tryAcquire("unknown"), /Unknown/);
});

test("resource monitor emits only aggregate fields and owns its timer", () => {
  const admission = createMemoryAdmission({ readMemory: healthy });
  const messages = [];
  let callback;
  let cleared;
  const timer = { unref() {} };
  const monitor = startMemoryMonitor({ snapshot: admission.snapshot, log: (line) => messages.push(line),
    setIntervalFn: (fn) => { callback = fn; return timer; },
    clearIntervalFn: (value) => { cleared = value; } });
  callback();
  assert.equal(messages.length, 2);
  assert.match(messages[0], /source=container usedMiB=300 limitMiB=2048/);
  assert.match(messages[0], /active=none/);
  monitor.stop();
  assert.equal(cleared, timer);
});

test("failed memory reads deny heavy work safely and failed logging stays optional", () => {
  const admission = createMemoryAdmission({ readMemory: () => { throw new Error("sensor failed"); } });
  assert.equal(admission.tryAcquire("share"), null);
  const healthyAdmission = createMemoryAdmission({ readMemory: healthy });
  assert.doesNotThrow(() => startMemoryMonitor({ snapshot: healthyAdmission.snapshot,
    log() { throw new Error("log sink failed"); },
    setIntervalFn: () => ({ unref() {} }), clearIntervalFn() {} }));
});
