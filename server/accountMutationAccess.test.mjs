import test from "node:test";
import assert from "node:assert/strict";
import { assertAccountMutationAccess } from "./accountMutationAccess.js";

const unverified = { id: "u_unverified", email_verified_at: 0 };

test("unverified sessions can browse, use safety controls, post text, and exercise account rights", () => {
  assert.equal(assertAccountMutationAccess({ method: "GET", pathname: "/api/feed", user: unverified }), true);
  for (const [method, pathname] of [
    ["POST", "/api/verify-email"],
    ["POST", "/api/verify-email/resend"],
    ["POST", "/api/logout"],
    ["POST", "/api/feed/impressions"],
    ["POST", "/api/me/email-preferences"],
    ["PATCH", "/api/me"],
    ["POST", "/api/posts"],
    ["POST", "/api/reports"],
    ["POST", "/api/users/u_other/block"],
    ["POST", "/api/users/u_other/mute"],
    ["POST", "/api/dms/u_other"],
    ["POST", "/api/media/assets/asset_123/finalize"],
    ["PATCH", "/api/media/assets/asset_123"],
    ["POST", "/api/media/assets/asset_123/variants/variant_123/finalize"],
    ["DELETE", "/api/media/assets/asset_123"],
    ["POST", "/api/media/finalize"],
    ["POST", "/api/suggestions"],
    ["DELETE", "/api/me"],
  ]) assert.equal(assertAccountMutationAccess({ method, pathname, user: unverified }), true);
});

test("unverified sessions cannot start a new media source or derivative upload", () => {
  for (const pathname of [
    "/api/media/assets",
    "/api/media/presign",
    "/api/media/assets/asset_123/variants",
  ]) {
    assert.throws(
      () => assertAccountMutationAccess({ method: "POST", pathname, user: unverified }),
      (error) => error?.status === 403 && error?.code === "MEDIA_EMAIL_VERIFICATION_REQUIRED",
    );
  }
  assert.equal(assertAccountMutationAccess({ method: "POST", pathname: "/api/media/assets", user: { ...unverified, email_verified_at: Date.now() } }), true);
});

test("administrators retain mutation access before verification backfill", () => {
  assert.equal(assertAccountMutationAccess({
    method: "POST",
    pathname: "/api/media/assets",
    user: { ...unverified, role: "admin" },
  }), true);
});
