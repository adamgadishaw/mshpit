import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ensureSocialReactionSchema, socialReactionRoutes, repostInfo, repostInfoPage, followingPostIds, visibleReactionComment, SOCIAL_NOTIFICATION_VISIBLE_SQL } from "./socialReactions.js";

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,handle TEXT,email_verified_at INTEGER,is_banned INTEGER DEFAULT 0,dormant_at INTEGER,suspended_until INTEGER,profile_audience TEXT DEFAULT 'everyone');
    CREATE TABLE posts(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,artist TEXT,removed INTEGER DEFAULT 0,created_at INTEGER);
    CREATE TABLE comments(id TEXT PRIMARY KEY,post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,parent_id TEXT,removed INTEGER DEFAULT 0);
    CREATE TABLE follows(follower_id TEXT,followee_id TEXT);
    CREATE TABLE blocks(blocker_id TEXT,blocked_id TEXT);
    CREATE TABLE account_mutes(muter_id TEXT,muted_id TEXT);
    CREATE TABLE recommendation_preferences(user_id TEXT,post_id TEXT);
    CREATE TABLE notifications(id TEXT PRIMARY KEY,type TEXT,user_id TEXT,actor_id TEXT,post_id TEXT);
    CREATE INDEX idx_posts_user_history ON posts(user_id,removed,created_at DESC,id DESC);
    CREATE INDEX idx_follows_user ON follows(follower_id,followee_id);
    INSERT INTO users(id,name,handle,email_verified_at) VALUES ('author','Author','author',1),('fan','Fan','fan',1),('viewer','Viewer','viewer',1),('parent','Parent','parent',1);
    INSERT INTO posts(id,user_id,artist,created_at) VALUES ('p_original','author','Artist',100),('p_other','author','Artist',90);
    INSERT INTO comments(id,post_id,user_id,parent_id) VALUES ('c_parent','p_original','parent',NULL),('c_reply','p_original','author','c_parent');
    INSERT INTO follows VALUES ('viewer','fan');`);
  ensureSocialReactionSchema(db); ensureSocialReactionSchema(db);
  let time = 1000;
  const notifications = [];
  class ApiError extends Error { constructor(status,message,code) { super(message); this.status=status; this.code=code; } }
  const routes = socialReactionRoutes({ database:db, ApiError, now:()=>time++, rateLimit:()=>{},
    requireUser:(ctx)=> { if (!ctx.user) throw new ApiError(401,"Login","AUTH_REQUIRED"); return ctx.user; },
    atomicWrite:(work)=> { db.exec("BEGIN IMMEDIATE"); try { const result=work(); db.exec("COMMIT"); return result; } catch(error) { db.exec("ROLLBACK"); throw error; } },
    addNotif:(recipient,actor,type,extra)=> { if (recipient!==actor) notifications.push({recipient,actor,type,...extra}); },
  });
  const context = (body={},userId="fan",params={id:"p_original"}) => ({body,params,user:userId ? {id:userId} : null,setHeader:()=>{}});
  const repost = (value=true,userId="fan",postId="p_original") => routes["POST /api/posts/:id/repost"](context({reposted:value},userId,{id:postId}));
  const like = (value=true,userId="fan",commentId="c_reply",postId="p_original") => routes["POST /api/posts/:postId/comments/:id/like"](context({liked:value},userId,{postId,id:commentId}));
  return {db,routes,context,notifications,repost,like};
}

test("comment/reply likes have authoritative counts and at most one lifetime notification per actor",t=>{
  const f=fixture(t);
  assert.deepEqual(f.like(),{ok:true,id:"c_reply",postId:"p_original",likes:1,liked:true});
  f.like(); f.like(false); f.like(true);
  assert.equal(f.notifications.length,1);
  assert.equal(f.notifications[0].commentId,"c_reply");
  assert.equal(f.notifications[0].type,"comment_like");
  assert.equal(f.like(false).likes,0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM comment_likes").get().n,1);
});

test("like validates exact post, target and full visible ancestry",t=>{
  const f=fixture(t);
  assert.throws(()=>f.like(true,"fan","c_reply","p_other"),{status:404});
  f.db.exec("INSERT INTO blocks VALUES ('parent','fan')");
  assert.throws(()=>f.like(),{status:404});
  f.db.exec("DELETE FROM blocks; UPDATE comments SET removed=1 WHERE id='c_parent'");
  assert.equal(f.like().liked,true); // live reply under a content-free tombstone
  assert.throws(()=>f.like(true,"fan","c_parent"),{status:404});
  f.db.exec("UPDATE comments SET parent_id='c_reply' WHERE id='c_parent'");
  assert.equal(visibleReactionComment(f.db,"p_original","c_reply","fan"),null);
});

for (const mutation of ["UPDATE users SET is_banned=1 WHERE id='author'","UPDATE users SET dormant_at=1 WHERE id='author'","UPDATE posts SET removed=1 WHERE id='p_original'","INSERT INTO blocks VALUES ('author','fan')","INSERT INTO blocks VALUES ('fan','author')"]) {
  test(`both mutations reject newly hidden targets: ${mutation}`,t=>{
    const f=fixture(t); f.db.exec(mutation);
    assert.throws(()=>f.like(),{status:404}); assert.throws(()=>f.repost(),{status:404});
    assert.equal(f.notifications.length,0);
  });
}

test("auth and strict booleans are enforced inside mutation authority",t=>{
  const f=fixture(t);
  assert.throws(()=>f.repost(true,null),{status:401});
  assert.throws(()=>f.routes["POST /api/posts/:id/repost"](f.context({})),{status:400});
  for (const value of [null,"false",1,{},[]]) {
    assert.throws(()=>f.repost(value),{status:400});
    assert.throws(()=>f.like(value),{status:400});
  }
  f.db.exec("UPDATE users SET email_verified_at=0 WHERE id='fan'");
  assert.throws(()=>f.repost(),{code:"EMAIL_VERIFICATION_REQUIRED"});
  f.db.exec("UPDATE users SET email_verified_at=1,dormant_at=1 WHERE id='fan'");
  assert.throws(()=>f.like(),{status:403});
});

test("reposts keep one original, immutable activity time and no toggle notification spam",t=>{
  const f=fixture(t);
  const first=f.repost(); f.repost(); f.repost(false); const last=f.repost();
  assert.equal(first.reposted,true); assert.equal(last.reposts,1);
  assert.equal(first.repostedBy[0].createdAt,last.repostedBy[0].createdAt);
  assert.equal(f.notifications.length,1); assert.equal(f.notifications[0].type,"repost");
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM posts").get().n,2);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM post_reposts").get().n,1);
  assert.deepEqual(followingPostIds(f.db,{viewerId:"viewer"}).map(p=>p.id),["p_original"]);
});

test("Following deduplicates own/followed posts with reposts and pages by activity plus id",t=>{
  const f=fixture(t); f.repost(); f.repost(true,"fan","p_other");
  f.db.exec("INSERT INTO follows VALUES ('viewer','author')");
  const rows=followingPostIds(f.db,{viewerId:"viewer",limit:1});
  assert.equal(rows.length,2); assert.equal(rows[0].id,"p_other");
  const next=followingPostIds(f.db,{viewerId:"viewer",cursor:{createdAt:rows[0].activity_at,id:rows[0].id}});
  assert.deepEqual(next.map(r=>r.id),["p_original"]);
});

for (const mutation of ["UPDATE users SET profile_audience='only_me' WHERE id='fan'","UPDATE users SET dormant_at=1 WHERE id='fan'","INSERT INTO blocks VALUES ('fan','viewer')","INSERT INTO blocks VALUES ('viewer','fan')","INSERT INTO blocks VALUES ('author','fan')","INSERT INTO account_mutes VALUES ('viewer','fan')","UPDATE post_reposts SET active=0"]) {
  test(`repost provenance and delivery revalidate: ${mutation}`,t=>{
    const f=fixture(t); f.repost(); f.db.exec(mutation);
    assert.deepEqual(followingPostIds(f.db,{viewerId:"viewer"}),[]);
    assert.deepEqual(repostInfo(f.db,"p_original","viewer"),{reposts:0,reposted:false,repostedBy:[]});
  });
}

test("original deletion/block removes repost delivery; account deletion cascades reaction graph",t=>{
  const f=fixture(t); f.repost(); f.like();
  f.db.exec("INSERT INTO blocks VALUES ('viewer','author')");
  assert.deepEqual(followingPostIds(f.db,{viewerId:"viewer"}),[]);
  f.db.exec("DELETE FROM users WHERE id='fan'");
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM post_reposts").get().n,0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM comment_likes").get().n,0);
  assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(),[]);
});

test("batched repost projection uses two statements for a whole feed and preserves private provenance",t=>{
  const f=fixture(t);f.repost();f.repost(true,"fan","p_other");
  let prepares=0;
  const counted={prepare:sql=>{prepares++;return f.db.prepare(sql);}};
  const result=repostInfoPage(counted,["p_original","p_other"],"viewer");
  assert.equal(prepares,2);
  assert.deepEqual(result.get("p_original"),repostInfo(f.db,"p_original","viewer"));
  f.db.exec("UPDATE users SET profile_audience='only_me' WHERE id='fan'");
  assert.equal(repostInfoPage(f.db,["p_original"],"viewer").get("p_original").reposts,0);
});

test("Following pages never resurrect older duplicate activities and query indexed network edges",t=>{
  const f=fixture(t);
  f.db.exec("INSERT INTO follows VALUES ('viewer','author'),('viewer','parent');");
  f.repost();f.repost(true,"parent","p_original");f.repost(true,"fan","p_other");
  f.db.exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<10000)
    INSERT INTO posts(id,user_id,created_at) SELECT 'unfollowed_'||n,'viewer',n FROM seq;
    INSERT INTO users(id,name,email_verified_at) VALUES ('outsider','outsider',1);
    UPDATE posts SET user_id='outsider' WHERE id LIKE 'unfollowed_%';`);
  let plan=[];
  const inspected={prepare:sql=>({all:params=>{
    plan=f.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(params).map(row=>row.detail).join("\n");
    return f.db.prepare(sql).all(params);
  }})};
  const first=followingPostIds(inspected,{viewerId:"viewer",limit:1});
  assert.equal(first[0].id,"p_other");
  const next=followingPostIds(f.db,{viewerId:"viewer",limit:1,cursor:{createdAt:first[0].activity_at,id:first[0].id}});
  assert.equal(next[0].id,"p_original");
  const end=followingPostIds(f.db,{viewerId:"viewer",limit:1,cursor:{createdAt:next[0].activity_at,id:next[0].id}});
  assert.deepEqual(end,[]);
  assert.match(plan,/SEARCH p USING (?:COVERING )?INDEX idx_posts_user_history/u);
  assert.match(plan,/idx_post_reposts_user_recent/u);
  assert.doesNotMatch(plan,/\bSCAN p\b/u,"following requests must not walk the site's unrelated posts");
});

test("notifications recheck the exact reaction, original post and full comment ancestry",t=>{
  const f=fixture(t);f.repost();f.repost(true,"viewer");f.like();
  f.db.prepare("INSERT INTO notifications(id,type,user_id,actor_id,post_id,comment_id) VALUES (?,?,?,?,?,?)").run("nr","repost","author","fan","p_original",null);
  f.db.prepare("INSERT INTO notifications(id,type,user_id,actor_id,post_id,comment_id) VALUES (?,?,?,?,?,?)").run("nc","comment_like","author","fan","p_original","c_reply");
  const visible=()=>f.db.prepare(`SELECT id FROM notifications n WHERE ${SOCIAL_NOTIFICATION_VISIBLE_SQL} ORDER BY id`).all({$viewer:"author"}).map(row=>row.id);
  assert.deepEqual(visible(),["nc","nr"]);
  f.repost(false);
  assert.deepEqual(visible(),["nc"],"another actor's live repost must not keep this actor's withdrawn notification");
  f.db.exec("INSERT INTO blocks VALUES ('parent','author')");
  assert.deepEqual(visible(),[]);
  f.db.exec("DELETE FROM blocks; UPDATE comments SET removed=1 WHERE id='c_parent'");
  assert.deepEqual(visible(),["nc"],"deleted parents are safe content-free tombstones");
  f.db.exec("UPDATE comments SET parent_id='c_reply' WHERE id='c_parent'");
  assert.deepEqual(visible(),[],"cyclic or truncated ancestry fails closed");
});

test("Following excludes news even through a followed publisher and followed friend's repost",t=>{
  const f=fixture(t);
  f.db.exec("INSERT INTO posts(id,user_id,created_at) VALUES ('news_story','author',110); INSERT INTO follows VALUES ('viewer','author')");
  f.repost(true,"fan","news_story");
  assert.equal(repostInfo(f.db,"news_story","viewer").reposts,1,"news can retain its reaction in the News surface");
  const rows=followingPostIds(f.db,{viewerId:"viewer"});
  assert.ok(rows.length>0);assert.equal(rows.some(row=>row.id==="news_story"),false);
});
