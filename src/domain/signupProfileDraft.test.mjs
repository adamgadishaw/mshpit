import test from "node:test";
import assert from "node:assert/strict";
import { confirmSignupProfile, signupHandleLocked, signupProfilePatch, signupProfileSnapshot } from "./signupProfileDraft.mjs";

const user = { id: "one", handle: "nightfan", avatarUri: "https://media.example/avatar.jpg", banner: null };
test("unverified setup shows its requested username without claiming it publicly", () => {
  assert.equal(signupProfileSnapshot({ ...user, emailVerified: false, pendingSignupHandle: "mychoice" }).handle, "mychoice");
  assert.equal(signupProfileSnapshot({ ...user, emailVerified: true, pendingSignupHandle: "mychoice" }).handle, "nightfan");
});
test("setup resumes only server-backed media, not temporary picker paths", () => {
  assert.deepEqual(signupProfileSnapshot({ ...user, avatarUri: "blob:local", banner: "file:/private.jpg" }), { handle: "nightfan", avatarUri: null, banner: null });
  assert.deepEqual(signupProfileSnapshot(user), { handle: "nightfan", avatarUri: user.avatarUri, banner: null });
});
test("setup saves only changed fields and retains explicit photo removal", () => {
  const saved = signupProfileSnapshot(user);
  assert.deepEqual(signupProfilePatch(saved, saved), {});
  assert.deepEqual(signupProfilePatch({ ...saved, avatarUri: null, banner: "https://media.example/banner.jpg" }, saved), { avatarUri: null, banner: "https://media.example/banner.jpg" });
});
test("no success, missing account, wrong account or mismatched media can advance setup", () => {
  for (const result of [{ ok: false }, { ok: true }, { ok: true, user: { ...user, id: "two" } }, { ok: true, user }]) {
    assert.throws(() => confirmSignupProfile(result, "one", { banner: "https://media.example/banner.jpg" }));
  }
  const patch = { banner: "https://media.example/banner.jpg", avatarUri: user.avatarUri, handle: "anotherfan" };
  assert.deepEqual(confirmSignupProfile({ ok: true, user: { ...user, ...patch } }, "one", patch), patch);
  assert.throws(() => confirmSignupProfile({ ok: true, user }, "one", { handle: "anotherfan" }));
});
test("username cooldown survives a reload and unrelated photo saves", () => {
  assert.equal(signupHandleLocked({ handleChangeAvailableAt: 1500 }, 1000), true);
  assert.equal(signupHandleLocked({ handleChangeAvailableAt: 1500 }, 1500), false);
  assert.equal(signupHandleLocked({ handleChangeAvailableAt: null }, 1000), false);
});
