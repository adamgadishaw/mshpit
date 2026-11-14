import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePostAuthor } from './postAuthor.mjs';
import { postBadgeBundle, reconcilePostAuthorBadges, reconcileCommentAuthorBadges } from './postBadgeBundle.mjs';
import { displayedProfileBadges } from './profileBadges.mjs';

test('fresh embedded badge bundle clears all stale cache authority regardless of avatar version', () => {
  const author = resolvePostAuthor({ userId:'u', cached:{role:'admin',verified:true,sponsor:true,artistName:'Old artist',membershipBadge:'first-wave',profileBadges:null,profileUpdatedAt:999}, embedded:{...postBadgeBundle({role:'fan',profileBadges:[]}),profileUpdatedAt:1} });
  assert.equal(author.role,'fan');
  assert.equal(author.verified,false);
  assert.equal(author.sponsor,false);
  assert.equal(author.artistName,null);
  assert.equal(author.membershipBadge,null);
  assert.deepEqual(author.profileBadges,[]);
});

test('confirmed profile changes update historical posts and comments without changing their contents or authority', () => {
  const user={id:'u',role:'fan',verified:false,profileBadges:['verified']};
  const other={id:'p2',userId:'v',user:{role:'moderator'}};
  const posts=[{id:'p1',userId:'u',review:'Old memory',user:{name:'Fan',verified:true}},other];
  const updated=reconcilePostAuthorBadges(posts,user);
  assert.equal(updated[0].review,'Old memory');
  assert.equal(updated[1],other);
  assert.equal(updated[0].user.verified,false);
  assert.deepEqual(displayedProfileBadges([],updated[0].user.profileBadges),[],'selection never grants eligibility');
  assert.equal(reconcilePostAuthorBadges(updated,user),updated,'unchanged bundles preserve references');
  const comments=reconcileCommentAuthorBadges({p:[{id:'c',userId:'u',text:'hello'},{id:'deleted',userId:'u',deleted:true}]}, {...user,profileBadges:[]});
  assert.equal(comments.p[0].text,'hello');
  assert.deepEqual(comments.p[0].profileBadges,[]);
  assert.equal(comments.p[1].badgeSnapshot,undefined);
});
