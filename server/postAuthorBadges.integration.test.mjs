import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { displayedProfileBadges } from '../src/domain/profileBadges.mjs';
import { resolvePostAuthor } from '../src/domain/postAuthor.mjs';
const dataDir=mkdtempSync(join(tmpdir(),'pit-post-badges-'));
process.env.PIT_DATA_DIR=dataDir;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP='true';
const {db,q}=await import('./db.js');
const {routes}=await import('./api.js');
after(()=>{db.close();rmSync(dataDir,{recursive:true,force:true});});
function addUser(id){q.insertUser.run(id,`${id}@example.test`,id,id,'test-hash','fan',null,null,null,'PF','#123456',Date.now());return q.userById.get(id);}
const owner=addUser('badge_owner'), viewer=addUser('badge_viewer');
const created=routes['POST /api/posts']({user:owner,ip:'post-badge-create',body:{kind:'status',review:'A historic memory'}});
const read=(user=viewer)=>routes['GET /api/posts/:id']({user,params:{id:created.id}}).post;

test('old post follows current eligibility and cosmetic selections on every read',()=>{
  db.prepare("UPDATE users SET verified=1,sponsor=1,role='moderator',extras=? WHERE id=?").run(JSON.stringify({profileBadges:['verified']}),owner.id);
  const before=read();
  assert.equal(before.user.verified,true);
  assert.equal(before.user.role,'moderator');
  assert.deepEqual(displayedProfileBadges(['mod','verified','sponsor'],before.user.profileBadges),['verified']);
  db.prepare("UPDATE users SET verified=0,sponsor=0,role='fan',extras=? WHERE id=?").run(JSON.stringify({profileBadges:[]}),owner.id);
  const after=read();
  const author=resolvePostAuthor({userId:owner.id,cached:{...before.user,profileUpdatedAt:9999999999999},embedded:after.user});
  assert.equal(author.verified,false);assert.equal(author.sponsor,false);assert.equal(author.role,'fan');
  assert.deepEqual(author.profileBadges,[]);
  assert.equal(after.review,before.review);assert.equal(after.version,before.version);
  for(const key of ['email','pass_hash','extras','profileAudience','emailVerified'])assert.equal(Object.hasOwn(after.user,key),false,key);
});

test('public posts do not expose hidden profile badge preferences or artist identity holds',()=>{
  db.prepare("UPDATE users SET verified=1,role='admin',profile_audience='only_me',extras=? WHERE id=?").run(JSON.stringify({profileBadges:['staff']}),owner.id);
  for(const user of [null,viewer]){const post=read(user);assert.equal(post.user.role,'fan');assert.equal(post.user.verified,false);assert.deepEqual(post.user.profileBadges,[]);}
  assert.equal(read(q.userById.get(owner.id)).user.role,'admin');
  db.prepare("UPDATE users SET profile_audience='everyone' WHERE id=?").run(owner.id);
  db.prepare('INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)').run(viewer.id,owner.id,Date.now());
  assert.throws(()=>read(),e=>e.status===404);
});
