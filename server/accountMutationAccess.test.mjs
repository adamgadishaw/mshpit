import test from "node:test";
import assert from "node:assert/strict";
import { assertAccountMutationAccess } from "./accountMutationAccess.js";

const unverified = { id: "u_unverified", email_verified_at: 0 };

test("unverified sessions can browse and exercise account rights", () => {
  assert.equal(assertAccountMutationAccess({ method: "GET", pathname: "/api/feed", user: unverified }), true);
  for (const [method, pathname] of [
    ["POST", "/api/verify-email"],
    ["POST", "/api/verify-email/resend"],
    ["POST", "/api/logout"],
    ["POST", "/api/me/email-preferences"],
    ["DELETE", "/api/me"],
  ]) assert.equal(assertAccountMutationAccess({ method, pathname, user: unverified }), true);
});

test("unverified sessions cannot perform social, media, or artist mutations", () => {
  for (const pathname of [
    "/api/posts",
    "/api/dms/u_other",
    "/api/media/assets",
    "/api/users/u_other/follow",
    "/api/artist-requests",
  ]) {
    assert.throws(
      () => assertAccountMutationAccess({ method: "POST", pathname, user: unverified }),
      (error) => error?.status === 403 && error?.code === "EMAIL_VERIFICATION_REQUIRED",
    );
  }
  assert.equal(assertAccountMutationAccess({ method: "POST", pathname: "/api/posts", user: { ...unverified, email_verified_at: Date.now() } }), true);
});
