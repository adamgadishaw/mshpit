import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test,{after} from "node:test";

const dir=mkdtempSync(join(tmpdir(),"pit-member-badges-"));
process.env.PIT_DATA_DIR=dir;
delete process.env.RESEND_API_KEY;
const {db,q,publicUser}=await import("./db.js");
const {mintVerifyToken,completeVerification}=await import("./verification.js");
const {routes}=await import("./api.js");
const {grantFirstWaveBadge}=await import("./memberBadges.js");
after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
let seq=0;
function user() {
  const id=`u_member_${++seq}`;
  q.insertUser.run(id,`${id}@realmail.com`,id,id,"scrypt:fixture:fixture","fan",null,null,null,"M","#123456",Date.now());
  return q.userById.get(id);
}
test("email confirmation and setup award one cosmetic badge without permissions or private data",()=>{
  const member=user();
  db.prepare("UPDATE users SET onboarding_version=0 WHERE id=?").run(member.id);
  const token=mintVerifyToken(member.id);
  const first=completeVerification(token);
  assert.equal(publicUser(first.user).membershipBadge,null,"unfinished signup does not consume a place");
  const finished=routes["POST /api/me/onboarding/complete"]({user:first.user,body:{version:1},ip:"badge-fixture"});
  assert.equal(finished.user.membershipBadge,"first-wave");
  assert.equal(finished.user.role,"fan"); assert.equal(finished.user.verified,false);
  assert.equal(completeVerification(token).replayed,true);
  assert.equal(db.prepare("SELECT count(*) AS n FROM first_wave_grants WHERE user_id=?").get(member.id).n,1);
  const view=publicUser(q.userById.get(member.id));
  for(const key of ["email","emailVerified","email_verified_at","firstWaveNumber"]) assert.equal(view[key],undefined,key);
  assert.throws(()=>routes["GET /api/admin/badges"]({user:q.userById.get(member.id)}),error=>error.status===403);
  db.prepare("UPDATE users SET extras=? WHERE id=?").run(JSON.stringify({membershipBadge:"admin",role:"admin",verified:true}),member.id);
  const spoofed=publicUser(q.userById.get(member.id));
  assert.equal(spoofed.membershipBadge,"first-wave");assert.equal(spoofed.role,"fan");assert.equal(spoofed.verified,false);
});
test("confirmed legacy signup receives First Wave at verification, idempotently",()=>{
  const member=user();const token=mintVerifyToken(member.id);
  assert.equal(publicUser(completeVerification(token).user).membershipBadge,"first-wave");
  assert.equal(publicUser(completeVerification(token).user).membershipBadge,"first-wave");
  assert.equal(db.prepare("SELECT count(*) AS n FROM first_wave_grants WHERE user_id=?").get(member.id).n,1);
});
test("comments and previews never advertise a held artist check; eligible member milestone is retained",()=>{
  const owner=user();const artist=user();const fan=user();const at=Date.now();
  db.prepare("UPDATE users SET email_verified_at=? WHERE id IN (?,?,?)").run(at,owner.id,artist.id,fan.id);
  grantFirstWaveBadge(db,fan.id);
  grantFirstWaveBadge(db,owner.id);
  db.prepare("UPDATE users SET role='artist',artist_name='Held Artist',verified=1 WHERE id=?").run(artist.id);
  db.prepare("INSERT INTO artist_profiles(artist_key,owner_id,identity_review_status,updated_at) VALUES (?,?,?,?)").run("held artist",artist.id,"pending",at);
  db.prepare("INSERT INTO posts(id,user_id,artist,venue,overall,review,kind,created_at) VALUES (?,?, '', '',0,'A night to remember','status',?)").run("p_badge_comments",owner.id,at);
  const insert=db.prepare("INSERT INTO comments(id,post_id,user_id,text,created_at) VALUES (?,'p_badge_comments',?,'Good show',?)");
  insert.run("c_badge_artist",artist.id,at);insert.run("c_badge_fan",fan.id,at+1);
  for(const status of ["pending","rejected"]) {
    db.prepare("UPDATE artist_profiles SET identity_review_status=? WHERE artist_key='held artist'").run(status);
    const result=routes["GET /api/posts/:id/comments"]({user:q.userById.get(owner.id),params:{id:"p_badge_comments"},query:{}});
    const held=result.comments.find(c=>c.id==="c_badge_artist");
    assert.equal(held.role,"fan");assert.equal(held.verified,false);assert.equal(held.membershipBadge,null);
    assert.equal(result.comments.find(c=>c.id==="c_badge_fan").membershipBadge,"first-wave");
    const post=routes["GET /api/posts/:id"]({user:q.userById.get(owner.id),params:{id:"p_badge_comments"},query:{}}).post;
    assert.equal(post.user.membershipBadge,"first-wave","fresh feed author snapshot must not depend on having visited a profile");
    const preview=post.commentPreview.find(c=>c.id==="c_badge_artist");
    assert.equal(preview.role,"fan");assert.equal(preview.verified,false);
    for(const key of ["email_verified_at","artist_identity_held"]) assert.equal(preview[key],undefined);
  }
});
test("a later identity hold strips official styling from legacy campaign posts without an artist binding",()=>{
  const artist=user();const admin=user();const at=Date.now();
  db.prepare("UPDATE users SET role='admin',email_verified_at=? WHERE id=?").run(at,admin.id);
  db.prepare("UPDATE users SET role='artist',artist_name='Campaign Legacy',verified=1,email_verified_at=? WHERE id=?").run(at,artist.id);
  db.prepare("INSERT INTO artist_profiles(artist_key,owner_id,identity_review_status,updated_at) VALUES ('campaign legacy',?,'approved',?)").run(artist.id,at);
  db.prepare("INSERT INTO posts(id,user_id,artist,venue,overall,review,kind,campaign,created_at) VALUES (?,?, '', '',0,'New music','status',?,?)")
    .run("p_badge_legacy_campaign",artist.id,JSON.stringify({version:1,treatment:"spotlight",artistKey:"campaign legacy"}),at);
  const read=()=>routes["GET /api/posts/:id"]({user:q.userById.get(admin.id),params:{id:"p_badge_legacy_campaign"},query:{}}).post;
  assert.equal(read().campaign?.artistKey,"campaign legacy");
  routes["POST /api/admin/artists/:key/identity-review"]({user:q.userById.get(admin.id),params:{key:"campaign legacy"},body:{action:"hold",reason:"Identity evidence requires a separate review."}});
  assert.equal(db.prepare("SELECT removed FROM posts WHERE id='p_badge_legacy_campaign'").get().removed,0,"legacy NULL binding cannot be assumed quarantined by the hold write");
  assert.equal(read().campaign,null);
  assert.equal(read().user.membershipBadge,null);
});
