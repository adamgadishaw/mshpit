import test from "node:test";
import assert from "node:assert/strict";
import { createAuthIntentPersistence } from "./authIntentPersistence.mjs";
import { createAuthTransitions } from "../domain/authTransitions.mjs";

const intent = (revision, phase, order) => ({ revision, phase, ...(order === undefined ? {} : { order }) });

test("newer signed-out storage wins over an old signed-in cookie, including reload", () => {
  let stored = intent("old", "signed-in", 10);
  const cookie = intent("old", "signed-in", 10);
  const options = {
    readStored: () => stored, writeStored: value => { stored = value; },
    readCookie: () => cookie, writeCookie: () => {}, now: () => 20,
  };
  const firstTab = createAuthIntentPersistence(options);
  firstTab.write(intent("logout", "signed-out"));
  assert.deepEqual(firstTab.read(), intent("logout", "signed-out", 20));
  assert.deepEqual(createAuthIntentPersistence(options).read(), firstTab.read());
});

test("memory wins after both durable writes silently reject the new intent", () => {
  const stale = intent("old", "signed-in", 10);
  const persistence = createAuthIntentPersistence({ readStored: () => stale, readCookie: () => stale, now: () => 20 });
  persistence.write(intent("logout", "signed-out"));
  assert.deepEqual(persistence.read(), intent("logout", "signed-out", 20));
});

test("cookie fallback survives reload when storage reads and writes throw", () => {
  let cookie = null;
  const unavailable = () => { throw new Error("storage disabled"); };
  const options = {
    readStored: unavailable, writeStored: unavailable,
    readCookie: () => cookie, writeCookie: value => { cookie = value; }, now: () => 20,
  };
  createAuthIntentPersistence(options).write(intent("logout", "signed-out"));
  assert.deepEqual(createAuthIntentPersistence(options).read(), intent("logout", "signed-out", 20));
});

test("storage fallback survives reload when cookie access and writes throw", () => {
  let stored = null;
  const unavailable = () => { throw new Error("cookies disabled"); };
  const options = {
    readStored: () => stored, writeStored: value => { stored = value; },
    readCookie: unavailable, writeCookie: unavailable, now: () => 20,
  };
  createAuthIntentPersistence(options).write(intent("logout", "signed-out"));
  assert.deepEqual(createAuthIntentPersistence(options).read(), intent("logout", "signed-out", 20));
});

test("same-tab memory remains usable when every durable operation throws", () => {
  const unavailable = () => { throw new Error("unavailable"); };
  const persistence = createAuthIntentPersistence({
    readStored: unavailable, writeStored: unavailable, readCookie: unavailable, writeCookie: unavailable, now: () => 20,
  });
  assert.equal(persistence.read(), null);
  persistence.write(intent("logout", "signed-out"));
  assert.deepEqual(persistence.read(), intent("logout", "signed-out", 20));
});

test("every write advances order beyond all copies, including backwards clocks and same-revision updates", () => {
  let stored = intent("storage", "signed-out", 100);
  let cookie = intent("cookie", "signed-out", 150);
  const persistence = createAuthIntentPersistence({
    readStored: () => stored, writeStored: value => { stored = value; },
    readCookie: () => cookie, writeCookie: value => { cookie = value; }, now: () => 50,
  });
  assert.equal(persistence.write(intent("login", "pending")).order, 151);
  assert.equal(persistence.write(intent("login", "signed-in")).order, 152);
  assert.deepEqual(stored, cookie);
  assert.deepEqual(persistence.read(), intent("login", "signed-in", 152));
});

test("newer cross-tab durable copies replace memory; cookie wins equal-order ties", () => {
  let cookie = null;
  let stored = null;
  const persistence = createAuthIntentPersistence({
    readStored: () => stored, writeStored: value => { stored = value; },
    readCookie: () => cookie, writeCookie: value => { cookie = value; }, now: () => 20,
  });
  persistence.write(intent("login", "pending"));
  cookie = intent("login", "signed-in", 20);
  assert.deepEqual(persistence.read(), cookie);
  stored = intent("another-tab", "signed-out", 21);
  assert.deepEqual(persistence.read(), stored);
});

test("legacy copies remain readable and acquire an order on the next write", () => {
  const persistence = createAuthIntentPersistence({ readCookie: () => intent("legacy", "signed-out"), now: () => 20 });
  assert.deepEqual(persistence.read(), intent("legacy", "signed-out", 0));
  assert.deepEqual(persistence.write(intent("new", "pending")), intent("new", "pending", 20));
});

test("invalid durable copies cannot override valid state or inject extra data", () => {
  for (const invalid of [null, [], 42, {}, intent("", "signed-out", 4), intent("bad", "unknown", 4), intent("bad", "signed-in", -1), intent("bad", "signed-in", Infinity), intent("bad", "signed-in", "40")]) {
    const persistence = createAuthIntentPersistence({ readCookie: () => invalid, readStored: () => ({ ...intent("good", "signed-out", 3), secret: "discard" }) });
    assert.deepEqual(persistence.read(), intent("good", "signed-out", 3));
  }
});

test("callers cannot mutate a stored intent through returned object references", () => {
  const persistence = createAuthIntentPersistence({ now: () => 20 });
  const written = persistence.write(intent("logout", "signed-out"));
  written.phase = "signed-in";
  const read = persistence.read();
  read.phase = "signed-in";
  assert.equal(persistence.read().phase, "signed-out");
});

test("stale signed-in cookie cannot suppress coordinator revocation or its reload barrier", async () => {
  let stored = intent("old", "signed-in", 1);
  const cookie = intent("old", "signed-in", 1);
  const options = {
    readStored: () => stored, writeStored: value => { stored = value; },
    readCookie: () => cookie, writeCookie: () => {}, now: () => 2,
  };
  let revocations = 0;
  const transitions = createAuthTransitions({
    ...createAuthIntentPersistence(options), revoke: async () => { revocations++; }, nonce: () => "logout",
  });
  assert.equal((await transitions.signOut()).kind, "revoked");
  assert.equal(revocations, 1);
  assert.equal(transitions.blocked(), true);
  const reloaded = createAuthTransitions({ ...createAuthIntentPersistence(options), revoke: async () => { revocations++; } });
  assert.equal(reloaded.blocked(), true);
  assert.equal((await reloaded.reconcile()).kind, "revoked");
  assert.equal(revocations, 2);
});

for (const rejected of ["cookie", "storage", "both", "neither"]) {
  test(`saturated ordering cannot prevent logout when ${rejected} durable writes reject`, async () => {
    let stored = intent("old", "signed-in", Number.MAX_SAFE_INTEGER);
    let cookie = { ...stored };
    const options = {
      readStored: () => stored, readCookie: () => cookie,
      writeStored: value => { if (!["storage", "both"].includes(rejected)) stored = value; },
      writeCookie: value => { if (!["cookie", "both"].includes(rejected)) cookie = value; },
    };
    let revocations = 0;
    const persistence = createAuthIntentPersistence(options);
    const transitions = createAuthTransitions({ ...persistence, revoke: async () => { revocations++; }, nonce: () => "logout" });
    assert.equal((await transitions.signOut()).kind, "revoked");
    assert.equal(revocations, 1);
    assert.equal(transitions.blocked(), true);
    assert.equal(persistence.read().order, Number.MAX_SAFE_INTEGER);
    if (rejected !== "both") assert.equal(createAuthIntentPersistence(options).read().phase, "signed-out");
  });
}

test("different-revision equal-order blocking intent beats signed-in regardless of storage location", () => {
  for (const phase of ["pending", "signed-out"]) {
    const blocked = intent("blocked", phase, 25), signedIn = intent("older", "signed-in", 25);
    for (const [stored, cookie] of [[blocked, signedIn], [signedIn, blocked]]) {
      assert.deepEqual(createAuthIntentPersistence({ readStored: () => stored, readCookie: () => cookie }).read(), blocked);
    }
  }
});

test("successful deliberate login can replace saturated intent when durable writes succeed", async () => {
  let stored = intent("old", "signed-out", Number.MAX_SAFE_INTEGER), cookie = { ...stored };
  const persistence = createAuthIntentPersistence({ readStored: () => stored, readCookie: () => cookie,
    writeStored: value => { stored = value; }, writeCookie: value => { cookie = value; } });
  const transitions = createAuthTransitions({ ...persistence, revoke: async () => {}, nonce: () => "login" });
  await transitions.run({ request: async () => ({ user: { id: "fixture" } }), accept: () => {} });
  assert.equal(transitions.blocked(), false);
  assert.equal(persistence.read().phase, "signed-in");
});
