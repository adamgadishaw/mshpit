import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createConnections } from "./connectionsRoutes.js";
import { profileAudienceAllows } from "../../accountVisibility.js";
import { MAX_FOLLOWED_ARTISTS } from "../../../src/domain/artistFollowFanClub.mjs";

class ApiError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,handle TEXT,verified INTEGER DEFAULT 0,profile_audience TEXT DEFAULT 'everyone',is_banned INTEGER DEFAULT 0,dormant_at INTEGER,suspended_until INTEGER,favorite_artists TEXT DEFAULT '[]',profile_updated_at INTEGER DEFAULT 0,email_verified_at INTEGER DEFAULT 1);
    ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'fan'; ALTER TABLE users ADD COLUMN artist_name TEXT;
    CREATE TABLE follows(follower_id TEXT,followee_id TEXT,PRIMARY KEY(follower_id,followee_id));
    CREATE TABLE blocks(blocker_id TEXT,blocked_id TEXT);
    CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT,source TEXT,photo TEXT,genre TEXT);
    CREATE TABLE artist_profiles(artist_key TEXT PRIMARY KEY,owner_id TEXT,removed INTEGER DEFAULT 0,identity_review_status TEXT DEFAULT 'clear');`);
  const addUser = (id, name = id, audience = "everyone") => { db.prepare("INSERT INTO users(id,name,handle,profile_audience) VALUES(?,?,?,?)").run(id,name,id,audience); return user(id); };
  const user = (id) => db.prepare("SELECT * FROM users WHERE id=?").get(id);
  const blocked = (a,b) => !!(a && b && db.prepare("SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)").get(a,b,b,a));
  const api = createConnections({
    database:db, ApiError, requireUser:(ctx) => { if (!ctx.user) throw new ApiError(401,"Sign in"); const actor=user(ctx.user.id); if (!actor?.email_verified_at || actor.is_banned) throw new ApiError(403,"Forbidden"); return actor; },
    rateLimit:()=>{}, visibleProfileOrNull:(id, viewer) => profileAudienceAllows(user(id),viewer) ? user(id) : null,
    blockedEitherWay:blocked, projectUser:(row)=>({id:row.id,name:row.name,handle:row.handle,favoriteArtists:Array(500).fill("Music"),bio:"Unneeded biography"}),projectArtist:(row)=>({name:row.name,photo:row.photo}),
    resolveArtist:(key)=>db.prepare("SELECT * FROM artists WHERE norm=?").get(key.toLowerCase()), decodeKey:(ctx)=>ctx.params.key,
    atomicWrite:(fn)=>{ db.exec("BEGIN");try{const result=fn();db.exec("COMMIT");return result;}catch(e){db.exec("ROLLBACK");throw e;} },now:()=>1000,
  });
  addUser("owner"); addUser("viewer");
  const context = (id="owner", viewer="viewer", query={})=>({user:viewer ? user(viewer):null,params:{id},query});
  const list=(mode,query={},viewer="viewer",id="owner")=>api.routes[`GET /api/users/:id/${mode}`](context(id,viewer,query));
  const addArtist=(name,source="catalog")=>db.prepare("INSERT INTO artists(norm,name,source) VALUES(?,?,?)").run(name.toLowerCase(),name,source);
  const followArtist=(key,following=true,viewer="viewer")=>api.routes["POST /api/artists/:key/follow"]({user:viewer?user(viewer):null,params:{key},body:{following}});
  return {db,addUser,user,api,context,list,addArtist,followArtist};
}
const status=(code)=>(error)=>error.status===code;

test("people pages search the entire graph, page stable name ties and preserve counts",()=>{
  const f=fixture();try{
    for(let i=0;i<65;i++){f.addUser("u"+String(i).padStart(3,"0"),i===64?"Zelda":"Same");f.db.prepare("INSERT INTO follows VALUES('owner',?)").run("u"+String(i).padStart(3,"0"));}
    const first=f.list("following",{limit:"30"});const second=f.list("following",{limit:"30",cursor:first.nextCursor});const third=f.list("following",{limit:"30",cursor:second.nextCursor});
    assert.equal(new Set([...first.users,...second.users,...third.users].map(x=>x.id)).size,65);assert.equal(third.nextCursor,null);
    assert.deepEqual(f.list("following",{q:"zelda"}).users.map(x=>x.name),["Zelda"]);
    assert.equal(f.api.counts(f.context()).following,65);
    assert.deepEqual(Object.keys(first.users[0]).sort(),["handle","id","name"]);
  }finally{f.db.close();}
});
test("owner and row audiences plus bilateral blocks apply before paging/search/counts",()=>{
  const f=fixture();try{
    for(const [id,audience]of [["public","everyone"],["member","members"],["private","only_me"],["banned","everyone"],["blocked","everyone"],["blocking","everyone"]]){f.addUser(id,id,audience);f.db.prepare("INSERT INTO follows VALUES('owner',?)").run(id);}
    f.db.exec("UPDATE users SET is_banned=1 WHERE id='banned'; INSERT INTO blocks VALUES('viewer','blocked'),('blocking','viewer');");
    assert.deepEqual(f.list("following").users.map(x=>x.id),["member","public"]);assert.equal(f.api.counts(f.context()).following,2);
    assert.equal(f.list("following",{q:"private"}).users.length,0);
    assert.deepEqual(f.list("following",{} ,null).users.map(x=>x.id),["blocked","blocking","public"]);
    f.db.exec("UPDATE users SET profile_audience='only_me' WHERE id='owner'");
    assert.throws(()=>f.list("following"),status(404));assert.throws(()=>f.list("artist-following"),status(404));
    assert.ok(f.list("following",{},"owner"));
    f.db.exec("UPDATE users SET profile_audience='everyone' WHERE id='owner'; INSERT INTO blocks VALUES('owner','viewer')");
    assert.throws(()=>f.list("followers"),status(404));
  }finally{f.db.close();}
});
test("verified and you-follow filters are server-side, names and handles search literally",()=>{
  const f=fixture();try{
    f.addUser("verified","Beyoncé");f.addUser("ordinary","100% Live");
    f.db.exec("UPDATE users SET verified=1 WHERE id='verified'; INSERT INTO follows VALUES('owner','verified'),('owner','ordinary'),('viewer','ordinary')");
    assert.deepEqual(f.list("following",{filter:"verified"}).users.map(x=>x.id),["verified"]);
    assert.deepEqual(f.list("following",{filter:"following"}).users.map(x=>x.id),["ordinary"]);
    assert.deepEqual(f.list("following",{q:"BEYONCE"}).users.map(x=>x.id),["verified"]);
    assert.deepEqual(f.list("following",{q:"@ordinary"}).users.map(x=>x.id),["ordinary"]);
    assert.deepEqual(f.list("following",{q:"%"}).users.map(x=>x.id),["ordinary"]);
    assert.equal(f.list("following",{filter:"following"},null).users.length,0);
  }finally{f.db.close();}
});
test("cursor cannot cross viewer, owner, filter or query scope and malformed inputs fail cleanly",()=>{
  const f=fixture();try{
    f.addUser("one");f.addUser("two");f.db.exec("INSERT INTO follows VALUES('owner','one'),('owner','two')");
    const cursor=f.list("following",{limit:1}).nextCursor;
    for(const query of [{limit:1,cursor,q:"one"},{limit:1,cursor,filter:"verified"},{cursor:"<bad>"},{q:"a".repeat(81)},{limit:"1.5"},{filter:"admin"}])assert.throws(()=>f.list("following",query),status(400));
    assert.throws(()=>f.list("following",{cursor},null),status(400));
  }finally{f.db.close();}
});

test("verified filter never advertises a check held by artist identity review",()=>{
 const f=fixture();try{
  for(const [id,statusValue] of [["pending","pending"],["rejected","rejected"],["approved","approved"],["clear","clear"]]){
   f.addUser(id);f.db.prepare("UPDATE users SET role='artist',verified=1,artist_name=? WHERE id=?").run("  Artist "+id.toUpperCase()+"  ",id);
   f.db.prepare("INSERT INTO artist_profiles(artist_key,owner_id,identity_review_status) VALUES(?,?,?)").run("artist "+id,id,statusValue);
   f.db.prepare("INSERT INTO follows VALUES('owner',?)").run(id);
  }
  const first=f.list("following",{filter:"verified",limit:1}); const second=f.list("following",{filter:"verified",limit:1,cursor:first.nextCursor});
  assert.deepEqual([...first.users,...second.users].map(row=>row.id),["approved","clear"]);assert.equal(second.nextCursor,null);
 }finally{f.db.close();}
});
test("artist following updates only selected account, is idempotent and never follows owner or joins club",()=>{
  const f=fixture();try{
    f.addArtist("Moon Walker");f.addArtist("Beyoncé");
    const first=f.followArtist("moon walker");const second=f.followArtist("beyoncé");const retry=f.followArtist("moon walker");
    assert.deepEqual(second.favoriteArtists,["Moon Walker","Beyoncé"]);assert.deepEqual(retry.favoriteArtists,second.favoriteArtists);
    assert.ok(second.profileUpdatedAt>first.profileUpdatedAt);assert.equal(retry.profileUpdatedAt,second.profileUpdatedAt);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM follows").get().n,0);assert.equal(f.user("owner").favorite_artists,"[]");
    assert.deepEqual(f.list("artist-following",{},"viewer","viewer").artists.map(x=>x.name),["Beyoncé","Moon Walker"]);
    assert.equal(f.api.counts(f.context("viewer")).artistFollowing,2);assert.equal(f.api.counts(f.context("viewer")).following,0);
    assert.deepEqual(f.followArtist("moon walker",false).favoriteArtists,["Beyoncé"]);
  }finally{f.db.close();}
});
test("guest/unverified/restricted artist follow is rejected and missing artist cannot be subscribed",()=>{
  const f=fixture();try{
    f.addArtist("Moon Walker");assert.throws(()=>f.followArtist("moon walker",true,null),status(401));
    f.db.exec("UPDATE users SET email_verified_at=NULL WHERE id='viewer'");assert.throws(()=>f.followArtist("moon walker"),status(403));
    f.db.exec("UPDATE users SET email_verified_at=1,is_banned=1 WHERE id='viewer'");assert.throws(()=>f.followArtist("moon walker"),status(403));
    f.db.exec("UPDATE users SET is_banned=0 WHERE id='viewer'");assert.throws(()=>f.followArtist("no artist"),status(404));
    assert.equal(f.user("viewer").favorite_artists,"[]");
  }finally{f.db.close();}
});
test("member-created artist audience/block hides list rows and rejects new follows; revocation remains possible",()=>{
  const f=fixture();try{
    f.addArtist("Private Act","artist-created");f.addUser("artist_owner","Artist Owner","only_me");
    f.db.exec("INSERT INTO artist_profiles(artist_key,owner_id) VALUES('private act','artist_owner'); UPDATE users SET favorite_artists='[\"Private Act\"]' WHERE id='owner'");
    assert.equal(f.list("artist-following").artists.length,0);assert.throws(()=>f.followArtist("private act"),status(404));
    f.db.exec("UPDATE users SET profile_audience='everyone' WHERE id='artist_owner'; INSERT INTO blocks VALUES('artist_owner','viewer')");
    assert.equal(f.list("artist-following").artists.length,0);assert.throws(()=>f.followArtist("private act"),status(404));
    f.db.exec("UPDATE users SET favorite_artists='[\"Private Act\"]' WHERE id='viewer'");
    assert.deepEqual(f.followArtist("private act",false).favoriteArtists,[]);
  }finally{f.db.close();}
});
test("500 artist cap never silently drops old subscriptions; removals remain available",()=>{
  const f=fixture();try{
    const full=Array.from({length:MAX_FOLLOWED_ARTISTS},(_,i)=>"Artist "+i);f.db.prepare("UPDATE users SET favorite_artists=? WHERE id='viewer'").run(JSON.stringify(full));f.addArtist("New Act");
    assert.throws(()=>f.followArtist("new act"),status(400));assert.equal(JSON.parse(f.user("viewer").favorite_artists).length,500);
    assert.equal(f.followArtist("artist 0",false).favoriteArtists.length,499);assert.equal(f.followArtist("new act").favoriteArtists.length,500);
  }finally{f.db.close();}
});
test("artist search paginates, hides missing catalogue identities from other viewers and marks own unavailable",()=>{
  const f=fixture();try{
    f.addArtist("Beyoncé");f.addArtist("Moon Walker");f.db.exec("UPDATE users SET favorite_artists='[\"Beyoncé\",\"Moon Walker\",\"Missing Act\"]' WHERE id='owner'");
    const first=f.list("artist-following",{limit:1});const last=f.list("artist-following",{limit:1,cursor:first.nextCursor});
    assert.deepEqual([...first.artists,...last.artists].map(x=>x.name),["Beyoncé","Moon Walker"]);assert.equal(last.nextCursor,null);
    assert.equal(f.list("artist-following",{q:"beyonce"}).artists[0].name,"Beyoncé");
    assert.equal(f.list("artist-following",{},"owner").artists.find(x=>x.name==="Missing Act").unavailable,true);
  }finally{f.db.close();}
});
