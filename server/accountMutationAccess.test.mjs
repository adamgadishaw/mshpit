import test from "node:test";
import assert from "node:assert/strict";
import { assertAccountMutationAccess as gate } from "./accountMutationAccess.js";

const unverified = { id: "u_unverified", email_verified_at: 0 };
const dormant = { id: "u_dormant", email_verified_at: 100, dormant_at: 200 };
const accountRights = [
  ["POST", "/api/signup"], ["POST", "/api/login"], ["POST", "/api/logout"],
  ["POST", "/api/forgot"], ["POST", "/api/reset"], ["POST", "/api/verify-email"],
  ["POST", "/api/verify-email/resend"], ["POST", "/api/signup/cancel"],
  ["POST", "/api/me/onboarding/complete"], ["POST", "/api/me/password"],
  ["POST", "/api/me/export"], ["POST", "/api/me/email-preferences"],
  ["POST", "/api/me/analytics-consent"], ["POST", "/api/unsubscribe"],
  ["POST", "/api/me/accounts/connect"], ["POST", "/api/me/accounts/switch"],
  ["POST", "/api/reports"], ["POST", "/api/tracks/report"],
  ["POST", "/api/users/u_other/block"], ["POST", "/api/users/u_other/mute"],
  ["DELETE", "/api/media/assets/asset_123"], ["DELETE", "/api/me"],
];
const socialMutations = [
  ["POST", "/api/posts"], ["PATCH", "/api/posts/post_1"], ["DELETE", "/api/posts/post_1"],
  ["POST", "/api/posts/post_1/comments"], ["POST", "/api/posts/post_1/like"],
  ["POST", "/api/users/u_other/follow"], ["POST", "/api/going"],
  ["POST", "/api/dms/u_other"], ["POST", "/api/dms/u_other/read"],
  ["POST", "/api/fanclubs/artist/join"], ["POST", "/api/fanclubs/artist/messages"],
  ["POST", "/api/lounges/show/messages"], ["POST", "/api/venues/venue/reviews"],
  ["POST", "/api/artist-requests"], ["PATCH", "/api/artists/artist/profile"],
  ["POST", "/api/artists/artist/posts"], ["POST", "/api/playlists"],
  ["PATCH", "/api/playlists/list_1"], ["POST", "/api/plays"],
  ["POST", "/api/feed/impressions"], ["POST", "/api/suggestions"],
  ["POST", "/api/events"], ["POST", "/api/events/batch"],
  ["POST", "/api/media/assets/asset_123/finalize"], ["PATCH", "/api/media/assets/asset_123"],
  ["POST", "/api/media/assets/asset_123/variants/variant_123/finalize"],
  ["POST", "/api/media/finalize"], ["POST", "/api/admin/users/u_other/role"],
  ["PUT", "/api/new-future-writer"], ["PATCH", "/api/new-future-writer"],
  ["DELETE", "/api/new-future-writer"], ["POST", "/api/new-future-writer"],
];

function denied(request, code) {
  assert.throws(() => gate(request), (error) => error.status === 403 && error.code === code,
    `${request.method} ${request.pathname}`);
}

test("restricted sessions can browse and retain narrowly scoped recovery, safety, and account rights", () => {
  for (const user of [unverified, dormant]) {
    for (const method of ["GET", "HEAD", "OPTIONS"]) assert.equal(gate({ method, pathname: "/api/feed", user }), true);
    for (const [method, pathname] of accountRights) assert.equal(gate({ method, pathname, user }), true);
  }
});

test("unverified users cannot publish, interact, finalize media, or use future mutation routes", () => {
  for (const [method, pathname] of socialMutations) denied({ method, pathname, user: unverified }, "EMAIL_VERIFICATION_REQUIRED");
});

test("unverified source and derivative uploads retain their specific verification error", () => {
  for (const pathname of ["/api/media/assets", "/api/media/presign", "/api/media/assets/asset_123/variants"]) {
    denied({ method: "POST", pathname, user: unverified }, "MEDIA_EMAIL_VERIFICATION_REQUIRED");
  }
});

test("privacy-only profile patches remain available but cannot carry public or privileged fields", () => {
  const body = { theme: "stage", profileAudience: "only_me", directMessagePolicy: "nobody", searchIndexingOptOut: true, ageBand: "18_plus" };
  for (const user of [unverified, dormant]) {
    const code = user.dormant_at ? "FORBIDDEN" : "EMAIL_VERIFICATION_REQUIRED";
    assert.equal(gate({ method: "PATCH", pathname: "/api/me", body, user }), true);
    for (const [key, value] of Object.entries(body)) assert.equal(gate({ method: "PATCH", pathname: "/api/me", body: { [key]: value }, user }), true);
    for (const key of ["bio", "handle", "name", "email", "role", "emailVerified", "avatarUri", "banner", "city", "genres", "favoriteArtists", "extras", "onboardingVersion"]) {
      denied({ method: "PATCH", pathname: "/api/me", body: { ...body, [key]: "forged" }, user }, code);
    }
    for (const invalid of [null, undefined, [], "theme", {}, JSON.parse('{"__proto__":{"bio":"hidden"},"theme":"stage"}'), Object.assign(Object.create({ bio: "inherited" }), { theme: "stage" })]) {
      denied({ method: "PATCH", pathname: "/api/me", body: invalid, user }, code);
    }
  }
});

test("allowlisted account paths cannot be extended, nested, or used with other write methods", () => {
  for (const [method, pathname] of [["PUT", "/api/me"], ["PATCH", "/api/me/password"],
    ["POST", "/api/me/export/publish"], ["POST", "/api/users/u_other/block/follow"],
    ["POST", "/api/me/accounts/switch/publish"], ["DELETE", "/api/media/assets/a/variants/v"],
    ["DELETE", "/api/media/assets"], ["POST", "/api/verify-email/publish"]]) {
    denied({ method, pathname, body: { theme: "stage" }, user: unverified }, "EMAIL_VERIFICATION_REQUIRED");
  }
});

test("staff roles and user-supplied Owner markers never bypass verification or dormancy", () => {
  for (const role of ["fan", "artist", "moderator", "admin"]) {
    denied({ method: "POST", pathname: "/api/posts", user: { ...unverified, role, isOwner: true } }, "EMAIL_VERIFICATION_REQUIRED");
    denied({ method: "POST", pathname: "/api/media/assets", user: { ...unverified, role } }, "MEDIA_EMAIL_VERIFICATION_REQUIRED");
    denied({ method: "POST", pathname: "/api/posts", user: { ...dormant, role, isOwner: true } }, "FORBIDDEN");
  }
});

test("dormancy blocks all social writes even when the email was already verified", () => {
  for (const [method, pathname] of socialMutations) denied({ method, pathname, user: dormant }, "FORBIDDEN");
  denied({ method: "POST", pathname: "/api/media/assets", user: dormant }, "FORBIDDEN");
});

test("active verified accounts and unauthenticated requests defer to route authorization", () => {
  for (const [method, pathname] of socialMutations) {
    assert.equal(gate({ method, pathname, user: { id: "verified", email_verified_at: Date.now(), dormant_at: null } }), true);
    assert.equal(gate({ method, pathname, user: null }), true);
  }
});
