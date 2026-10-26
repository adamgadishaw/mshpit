import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ensureSourceRegistrySchema, sourceRegistry, sourceRegistryRoutes, registryUrl } from "./sourceRegistry.js";
import { renderSourceRegistryPage, sourceRegistryPageResponse } from "./sourceRegistryPage.js";
import { ApiError } from "../../errors.js";
import { assertNewsroomRoute } from "../newsroomSessions/newsroomSessionPolicy.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
function fixture(path = ":memory:") {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,is_banned INTEGER DEFAULT 0,dormant_at INTEGER,suspended_until INTEGER,profile_audience TEXT DEFAULT 'everyone');
    CREATE TABLE posts(id TEXT PRIMARY KEY,user_id TEXT,kind TEXT DEFAULT 'status',removed INTEGER DEFAULT 0,body TEXT,photo TEXT);
    CREATE TABLE news_stories(id TEXT PRIMARY KEY,post_id TEXT,status TEXT,headline TEXT,sources TEXT,created_at INTEGER);
    CREATE TABLE moderation_actions(id,actor_id,action,target_type,target_id,reason,prior_state,next_state,request_id,created_at);
    INSERT INTO users(id) VALUES('publisher');`);
  for(let i=0;i<25;i++) {
    db.prepare("INSERT INTO posts(id,user_id,body,photo) VALUES(?,'publisher','unchanged body','unchanged photo')").run(`news_${i}`);
    db.prepare("INSERT INTO news_stories VALUES(?,?,'published',?,?,?)").run(`s${i}`,`news_${i}`,`Synthetic article ${i}`,JSON.stringify([{kind:"article",name:"Reporting source",url:"https://www.nme.com/original"},{kind:"photo",name:"Photographer",url:"https://commons.wikimedia.org/wiki/File:Photo.jpg",credit:"Photo credit"}]),i);
  }
  ensureSourceRegistrySchema(db);
  const registry=sourceRegistry(db); registry.saveEdition({slug:"synthetic-edition",title:"Synthetic daily edition",status:"published",revision:0},()=>{},()=>{});
  return {db,registry};
}
const source = changes => ({postId:"news_24",kind:"video",name:"Clip creator",url:"https://www.nme.com/clip",credit:"Original clip",licence:"",edition:"synthetic-edition",position:0,...changes});
test("add/edit persists, CAS rejects stale updates and duplicate entries; article remains unchanged",()=>{
  const {db,registry}=fixture(); const snapshot = db.prepare("SELECT * FROM posts WHERE id='news_24'").get();
  let authorized=0,audited=0;
  const saved=registry.save(source(),()=>authorized++,()=>audited++);
  assert.equal(saved.revision,1); assert.equal(authorized,2);assert.equal(audited,1);
  assert.throws(()=>registry.save(source(),()=>{},()=>{}),e=>e.status===409);
  const updated=registry.save(source({id:saved.id,revision:1,credit:"Updated clip credit",position:2}),()=>{},()=>{});
  assert.equal(updated.revision,2);
  assert.throws(()=>registry.save(source({id:saved.id,revision:1}),()=>{},()=>{}),e=>e.status===409);
  assert.deepEqual(db.prepare("SELECT * FROM posts WHERE id='news_24'").get(),snapshot);
  assert.equal(registry.list({edition:"synthetic-edition"}).articles[0].credits.find(c=>c.id).credit,"Updated clip credit");
});
test("private, draft, removed and banned articles are excluded; authorization and audit failures roll back",()=>{
  const {db,registry}=fixture();
  db.exec("UPDATE news_stories SET status='draft' WHERE post_id='news_24'; UPDATE posts SET removed=1 WHERE id='news_23'");
  assert.equal(registry.list({post:"news_24"}).articles.length,0);
  assert.equal(registry.list({post:"news_23"}).articles.length,0);
  assert.throws(()=>registry.save(source(),()=>{},()=>{}),e=>e.status===404);
  db.exec("UPDATE news_stories SET status='published'; UPDATE users SET profile_audience='members'");
  assert.equal(registry.list().articles.length,0);
  db.exec("UPDATE users SET profile_audience='everyone',is_banned=1"); assert.equal(registry.list().articles.length,0);
  db.exec("UPDATE users SET is_banned=0");
  assert.throws(()=>registry.save(source(),()=>{throw new ApiError(403,"Denied","FORBIDDEN");},()=>{}),e=>e.status===403);
  assert.throws(()=>registry.save(source(),()=>{},()=>{throw Error("audit failed");}),/audit failed/);
  assert.equal(db.prepare("SELECT count(*) n FROM news_source_credits").get().n,0);
});
test("bounded pages, search, kinds, provenance and direct edition/article views",()=>{
  const {registry}=fixture();
  const first=registry.list();assert.equal(first.articles.length,20);assert.equal(first.hasMore,true);
  assert.equal(registry.list({page:2}).articles.length,5);
  assert.equal(registry.list({q:"article 24"}).articles.length,1);
  assert.equal(registry.list({post:"news_24",kind:"photographs"}).articles[0].credits[0].provenance,"published article");
  registry.save(source({kind:"music"}),()=>{},()=>{});
  assert.equal(registry.list({edition:"synthetic-edition"}).articles.length,1);
  const row=registry.list({post:"news_24"}).articles[0];assert.equal(row.credits.length,3);
  registry.save(source({kind:"reporting",url:"https://www.nme.com/original"}),()=>{},()=>{});
  assert.equal(registry.list({post:"news_24"}).articles[0].credits.length,4);
});
test("URL restrictions, invalid fields, XSS escaping and long credits",()=>{
  const {db,registry}=fixture();
  for(const url of ["javascript:alert(1)","https://localhost/foo","https://127.0.0.1/foo","https://user:pass@nme.com/x","https://www.nme.com/x?token=private","https://www.nme.com/x?X-Amz-Signature=secret"]) assert.equal(registryUrl(url),null,url);
  assert.throws(()=>registry.save(source({licence:"x".repeat(1001)}),()=>{},()=>{}),e=>e.status===400);
  assert.throws(()=>registry.save(source({body:"overwrite"}),()=>{},()=>{}),e=>e.status===400);
  registry.save(source({name:'<img src=x onerror=alert(1)>',credit:"Long credit ".repeat(70)}),()=>{},()=>{});
  const html=renderSourceRegistryPage(db,new URLSearchParams("post=news_24"));
  assert.ok(html.includes("&lt;img"));assert.ok(!html.includes("<img src=x"));
  assert.match(html,/post=news_24/);assert.match(html,/Edition: synthetic-edition/);assert.match(html,/label>Find a source or article/);
});
test("admin-only routes reject unauthenticated/editor actors; successful writes audited",()=>{
  const {db}=fixture();
  const routes=sourceRegistryRoutes({database:db,rateLimit(){},requireAdmin(ctx){if(!ctx.user) throw new ApiError(401,"Login","AUTH_REQUIRED");if(ctx.user.role!=="admin")throw new ApiError(403,"Admin","FORBIDDEN");return ctx.user;}});
  const save=routes["PUT /api/moderation/source-credits"];
  for(const [user,status] of [[null,401],[{id:"editor",role:"editor"},403],[{id:"admin",role:"admin",email_verified_at:0},403]]) assert.throws(()=>save({user,body:source()}),e=>e.status===status);
  save({user:{id:"admin",role:"admin",email_verified_at:1},body:source()});
  assert.equal(db.prepare("SELECT count(*) n FROM moderation_actions").get().n,1);
});
test("standalone editions exclude drafts and withdrawn credits, including article relationships",()=>{
  const {db,registry}=fixture();
  registry.saveEdition({slug:"private-edition",title:"Private draft edition",status:"draft",revision:0},()=>{},()=>{});
  registry.save(source({postId:"",edition:"private-edition",name:"Private music creator",kind:"music"}),()=>{},()=>{});
  registry.save(source({edition:"private-edition",name:"Private clip creator"}),()=>{},()=>{});
  assert.equal(registry.list({edition:"private-edition"}).articles.length,0);
  assert.equal(registry.list({edition:"private-edition"}).editions.length,0);
  assert.equal(registry.list({q:"Private clip creator"}).articles.length,0);
  assert.equal(registry.list({post:"news_24"}).articles[0].credits.some(c=>c.name.startsWith("Private")),false);
  assert.equal(registry.list({edition:"private-edition"},{staff:true}).editions[0].credits.length,1);
  registry.saveEdition({slug:"private-edition",title:"Private draft edition",status:"published",revision:1},()=>{},()=>{});
  assert.equal(registry.list({edition:"private-edition"}).editions[0].credits.length,1);
  registry.saveEdition({slug:"private-edition",title:"Private draft edition",status:"withdrawn",revision:2},()=>{},()=>{});
  assert.equal(registry.list({edition:"private-edition"}).editions.length,0);
  for(const route of [["PUT","/api/moderation/source-credits"],["PUT","/api/moderation/source-editions"],["GET","/api/moderation/source-credits"]]) assert.throws(()=>assertNewsroomRoute(...route),e=>e.status===403);
  db.close();
});
test("creator/licence variants survive; exact duplicates merge projections while retaining provenance",()=>{
  const {registry}=fixture();
  registry.save(source({name:"First creator",licence:"CC BY 4.0"}),()=>{},()=>{});
  registry.save(source({name:"Second creator",licence:"CC BY-SA 4.0"}),()=>{},()=>{});
  const original=source({kind:"reporting",name:"Reporting source",url:"https://www.nme.com/original",credit:"",edition:""});
  registry.save(original,()=>{},()=>{});
  const credits=registry.list({post:"news_24"}).articles[0].credits;
  assert.equal(credits.filter(c=>c.kind==="video").length,2);
  assert.equal(credits.filter(c=>c.url===original.url).length,1);
  assert.equal(credits.find(c=>c.url===original.url).provenance,"published article + registry");
});
test("additive schema initialization is idempotent and rollback leaves legacy articles intact",()=>{
  const {db}=fixture();
  const before=db.prepare("SELECT * FROM news_stories ORDER BY id").all();
  ensureSourceRegistrySchema(db);ensureSourceRegistrySchema(db);
  db.exec("DROP TABLE news_source_credits;DROP TABLE news_source_editions");
  assert.deepEqual(db.prepare("SELECT * FROM news_stories ORDER BY id").all(),before);
  ensureSourceRegistrySchema(db);
  assert.equal(sourceRegistry(db).list().articles.length,20);
  db.close();
});
test("credits and edition revisions survive reopening; old article reads ignore additive tables",()=>{
  const directory=mkdtempSync(join(tmpdir(),"pit-sources-restart-"));
  try {
    const path=join(directory,"fixture.sqlite");const first=fixture(path);
    const before=first.db.prepare("SELECT * FROM news_stories ORDER BY id").all();
    first.registry.save(source(),()=>{},()=>{});first.db.close();
    const reopened=new DatabaseSync(path);
    try {
      ensureSourceRegistrySchema(reopened);
      assert.deepEqual(reopened.prepare("SELECT * FROM news_stories ORDER BY id").all(),before);
      const credits=sourceRegistry(reopened).list({edition:"synthetic-edition"}).articles[0].credits;
      assert.equal(credits.find(c=>c.kind==="video").revision,1);
      assert.equal(sourceRegistry(reopened).list({edition:"synthetic-edition"}).editions[0].revision,1);
    } finally {reopened.close();}
  } finally {rmSync(directory,{recursive:true,force:true});}
});
test("historical token/internal URLs never enter public projection, even beside legitimate citations",()=>{
  const {db,registry}=fixture();
  const urls=["https://www.nme.com/report","https://www.nme.com/report?token=secret","https://www.nme.com/private/evidence","https://www.nme.com/%69nternal/record","https://www.nme.com/report?X-Amz-Signature=secret"];
  db.prepare("UPDATE news_stories SET sources=? WHERE post_id='news_24'").run(JSON.stringify(urls.map(url=>({kind:"article",name:"Historical source",url}))));
  const projected=registry.list({post:"news_24"}).articles[0].credits;
  assert.equal(projected.length,1);assert.equal(projected[0].url,urls[0]);
  db.exec("UPDATE news_stories SET status='draft' WHERE post_id='news_24'");assert.equal(registry.list({post:"news_24"}).articles.length,0);
});
test("public read errors have a safe retry view without leaking internal details",()=>{
  const result=sourceRegistryPageResponse({prepare(){throw Error("private database /evidence/token-secret");}},new URLSearchParams());
  assert.equal(result.status,503);assert.match(result.body,/Sources are temporarily unavailable/);
  assert.doesNotMatch(result.body,/token-secret|private database/);assert.match(result.body,/Reload Sources/);
});
