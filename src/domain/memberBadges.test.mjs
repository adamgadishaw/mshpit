import assert from "node:assert/strict";
import test from "node:test";
import { memberBadgeTypes } from "./memberBadges.mjs";
import { STATUS_BADGES } from "./badges.mjs";
import { RESERVED_SLUGS } from "./badgeArt.mjs";
import { publicProfileCacheEntry } from "./dataPolicy.mjs";

test("membership badges are cosmetic and never inferred from role or email flags",()=>{
  assert.deepEqual(memberBadgeTypes({membershipBadge:"first-wave",role:"fan",verified:false}),["first-wave"]);
  assert.deepEqual(memberBadgeTypes({membershipBadge:"email-confirmed"}),["email-confirmed"]);
  for(const user of [null,{}, {emailVerified:true},{role:"admin"},{membershipBadge:"verified"},{firstWave:true}]) assert.deepEqual(memberBadgeTypes(user),[]);
  for(const kind of ["first-wave","email-confirmed"]) {
    assert.ok(RESERVED_SLUGS.has(kind));
    assert.match(STATUS_BADGES[kind].desc,/not.*identity|does not verify/i);
  }
});
test("public cache preserves only a valid cosmetic milestone, never confirmation details",()=>{
  const projected=publicProfileCacheEntry({id:"u",membershipBadge:"first-wave",email:"secret@realmail.com",emailVerified:true,email_verified_at:123});
  assert.deepEqual(projected,{id:"u",membershipBadge:"first-wave"});
  assert.deepEqual(publicProfileCacheEntry({id:"u",membershipBadge:"admin"}),{id:"u"});
});
