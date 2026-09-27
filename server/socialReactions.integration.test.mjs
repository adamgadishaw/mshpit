import test,{after} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
const directory=mkdtempSync(join(tmpdir(),"pit-social-reactions-"));
process.env.PIT_DATA_DIR=directory;
const {db,q}=await import("./db.js");
const {routes}=await import("./api.js");
const {ensureNewsDeskSchema,createNewsDeskReader}=await import("./features/newsDesk/newsDeskService.js");
const {repostInfoPage}=await import("./features/socialReactions/socialReactions.js");
const {hashPassword}=await import("./auth.js");
const passwordHash=hashPassword("social-test-password1");
after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});
let sequence=0;
function user(){const id=`social_${++sequence}`;q.insertUser.run(id,`${id}@example.test`,id,id,passwordHash,"fan","Toronto",43,-79,"QA","#123456",Date.now());db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(),id);return q.userById.get(id);}
function fixture(){
  const owner=user(),fan=user(),viewer=user(),postId=`post_${sequence}`,commentId=`comment_${sequence}`;
  db.prepare("INSERT INTO posts(id,user_id,artist,venue,overall,review,created_at) VALUES(?,?,'Artist','Venue',4,'Review',?)").run(postId,owner.id,Date.now());
  db.prepare("INSERT INTO comments(id,post_id,user_id,text,created_at) VALUES(?,?,?,'Reply',?)").run(commentId,postId,owner.id,Date.now());
  db.prepare("INSERT INTO follows(follower_id,followee_id) VALUES(?,?)").run(viewer.id,fan.id);
  const repost=desired=>routes["POST /api/posts/:id/repost"]({user:fan,params:{id:postId},body:{reposted:desired}});
  const like=desired=>routes["POST /api/posts/:postId/comments/:id/like"]({user:fan,params:{postId,id:commentId},body:{liked:desired}});
  const inbox=()=>routes["GET /api/me/notifications"]({user:owner,query:{}});
  const following=()=>routes["GET /api/feed"]({user:viewer,query:{mode:"following"}});
  return {owner,fan,viewer,postId,commentId,repost,like,inbox,following};
}

test("real routes connect comment counts, exact notifications, social delivery and own-data exports",async()=>{
  const f=fixture();f.like(true);f.like(true);f.repost(true);f.repost(true);
  const inbox=f.inbox();assert.equal(inbox.notifications.length,2);assert.equal(inbox.unread,2);
  assert.equal(inbox.notifications.find(n=>n.type==="comment_like").commentId,f.commentId);
  const comment=routes["GET /api/posts/:id/comments"]({user:f.fan,params:{id:f.postId},query:{}}).comments[0];
  assert.equal(comment.likes,1);assert.equal(comment.liked,true);assert.equal(comment.canLike,true);
  const cards=f.following().posts;assert.equal(cards.length,1);assert.equal(cards[0].id,f.postId);assert.equal(cards[0].userId,f.owner.id);
  assert.equal(cards[0].reposts,1);assert.equal(cards[0].repostedBy[0].userId,f.fan.id);
  const exported=await routes["POST /api/me/export"]({user:f.fan,query:{},body:{password:"social-test-password1"}});
  assert.equal(exported.commentLikes[0].commentId,f.commentId);assert.equal(exported.reposts[0].postId,f.postId);
  assert.ok("membershipMilestone" in exported);
  f.like(false);f.repost(false);assert.equal(f.inbox().unread,0);assert.deepEqual(f.inbox().notifications,[]);assert.deepEqual(f.following().posts,[]);
  f.like(true);f.repost(true);assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE actor_id=?").get(f.fan.id).n,2);
  db.prepare("UPDATE posts SET removed=1 WHERE id=?").run(f.postId);assert.equal(f.inbox().unread,0);assert.deepEqual(f.following().posts,[]);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
});

test("a blocked reply ancestor removes like authority without erasing another author's readable reply",()=>{
  const f=fixture(),ancestor=user();
  db.prepare("INSERT INTO comments(id,post_id,user_id,text,created_at) VALUES(?,?,?,'Ancestor',?)").run("ancestor",f.postId,ancestor.id,Date.now()-1);
  db.prepare("UPDATE comments SET parent_id='ancestor' WHERE id=?").run(f.commentId);
  db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)").run(ancestor.id,f.fan.id,Date.now());
  const comment=routes["GET /api/posts/:id/comments"]({user:f.fan,params:{id:f.postId},query:{}}).comments.find(c=>c.id===f.commentId);
  assert.equal(comment.canLike,false);assert.equal(comment.text,"Reply");assert.throws(()=>f.like(true),error=>error.status===404);
});

test("news list and standalone story carry the same authoritative repost state",()=>{
  const f=fixture();ensureNewsDeskSchema(db);
  db.prepare("INSERT INTO news_stories(id,status,headline,summary,post_id,created_at,updated_at) VALUES(?,'published','Music news','Summary',?,?,?)").run("story_social",f.postId,Date.now(),Date.now());
  f.repost(true);
  const listing=routes["GET /api/news-desk/stories"]({user:f.fan,query:{},setHeader:()=>{}});
  const story=listing.stories.find(s=>s.id==="story_social");assert.equal(story.reposts,1);assert.equal(story.reposted,true);
  const reader=createNewsDeskReader(db,{projectReposts:(ids,viewerId)=>repostInfoPage(db,ids,viewerId)});
  assert.equal(reader.get("story_social",{viewerId:f.fan.id}).reposted,true);
});
