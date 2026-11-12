import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const directory = mkdtempSync(join(tmpdir(), "pit-calendar-posts-"));
process.env.PIT_DATA_DIR = directory;
Object.assign(process.env, { MEDIA_ENDPOINT: "https://objects.example.com/s3", MEDIA_BUCKET: "pit-media", MEDIA_SOURCE_BUCKET: "pit-media-private", MEDIA_REGION: "auto", MEDIA_ACCESS_KEY_ID: "fixture", MEDIA_SECRET_ACCESS_KEY: "fixture", MEDIA_PUBLIC_BASE_URL: "https://media.example.com/cdn" });
globalThis.fetch = async () => { throw Error("No external requests in calendar tests"); };
const { db, q } = await import("../../db.js");
const { routes, creatorCalendarService } = await import("../../api.js");
const { scanNewTourDates, ensureArtistUpdatesSchema } = await import("../artistUpdates/artistUpdatesService.js");
after(() => db.close());
let sequence = 0;
const day = offset => new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
const account = (role="fan") => {
  const id=`calendar_${++sequence}`, name=`Calendar Artist ${sequence}`;
  q.insertUser.run(id,`${id}@example.test`,id,id,"synthetic",role,"Toronto",0,0,"CA","#123456",Date.now());
  db.prepare("UPDATE users SET artist_name=?,email_verified_at=? WHERE id=?").run(role==="artist"?name:null,Date.now(),id);
  if(role==="artist") db.prepare("INSERT INTO artist_profiles(artist_key,owner_id,updated_at) VALUES (?,?,?)").run(name.toLowerCase(),id,Date.now());
  return q.userById.get(id);
};
const ctx=(user,body={},params={},query={})=>({user,body,params,query,ip:user?.id||"guest"});
const draft=(user, patch={})=>({ clientMutationId:`calendar_submit_${++sequence}`,kind:"status",review:"Doors open at seven.",
  creatorUpdate:{version:1,entityType:"artist",entityKey:user.artist_name.toLowerCase(),kind:"show",title:"New show",date:day(30),
    location:"Fixture Hall, Toronto, Canada",url:"https://tickets.example.com/show",
    calendar:{action:"create",eventId:"",expectedRevision:0,venue:"Fixture Hall",place:"Toronto, Canada",releaseAt:0,...patch}}});
const submit=(user,body)=>routes["POST /api/posts"](ctx(user,body));
const fail=(fn,status)=>assert.throws(fn,error=>error.status===status);
const notices=post=>db.prepare("SELECT * FROM notifications WHERE post_id=? AND type='creator_update'").all(post);

test("calendar and post publish atomically with stable ID, one receipt and one opted-in notice",()=>{
  const artist=account("artist"),fan=account(),off=account();
  for(const user of [fan,off]) db.prepare("UPDATE users SET favorite_artists=? WHERE id=?").run(JSON.stringify([artist.artist_name]),user.id);
  routes["PUT /api/creators/:type/:key/notifications"](ctx(off,{notifyUpdates:false},{type:"artist",key:artist.artist_name.toLowerCase()}));
  const body=draft(artist),first=submit(artist,body),second=submit(artist,structuredClone(body));
  assert.equal(second.id,first.id); assert.equal(second.calendarReceipt.eventId,first.calendarReceipt.eventId);
  assert.equal(first.post.creatorUpdate.calendarEvent.id,first.calendarReceipt.eventId);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tour_dates WHERE owner_id=?").get(artist.id).n,1);
  assert.deepEqual(notices(first.id).map(row=>row.user_id),[fan.id]);
  const changed=structuredClone(body);changed.creatorUpdate.title="Different";fail(()=>submit(artist,changed),409);
  const duplicate=draft(artist);fail(()=>submit(artist,duplicate),409);
});

test("edits retain calendar identity; stale revisions and provider overwrites fail; cancellation retains history",()=>{
  const artist=account("artist"),body=draft(artist),created=submit(artist,body);
  const id=created.calendarReceipt.eventId;
  const edit=draft(artist,{action:"edit",eventId:id,expectedRevision:1});edit.creatorUpdate.date=day(40);edit.creatorUpdate.url="https://tickets.example.com/revised";
  const changed=submit(artist,edit);assert.equal(changed.calendarReceipt.eventId,id);assert.equal(changed.calendarReceipt.revision,2);
  assert.equal(submit(artist,edit).id,changed.id);
  assert.equal(routes["GET /api/posts/:id"](ctx(artist,{}, {id:created.id})).post.creatorUpdate.calendarEvent.ticketUrl,edit.creatorUpdate.url);
  fail(()=>submit(artist,{...edit,clientMutationId:`stale_update_${++sequence}`}),409);
  const cancel=draft(artist,{action:"cancel",eventId:id,expectedRevision:2});cancel.creatorUpdate.date=day(40);cancel.creatorUpdate.title="Show cancelled";
  const cancelled=submit(artist,cancel);assert.equal(submit(artist,cancel).id,cancelled.id);
  assert.equal(db.prepare("SELECT event_status FROM tour_dates WHERE id=?").get(id).event_status,"cancelled");
  assert.equal(routes["GET /api/tourdates"](ctx(artist)).tourDates.some(row=>row.id===id),false);
  const provider=draft(artist,{action:"edit",eventId:id,expectedRevision:3});
  db.prepare("UPDATE tour_dates SET source='ticketmaster',owner_id=NULL WHERE id=?").run(id);
  fail(()=>submit(artist,provider),403);
});

test("scheduled publications have no post/notices until due; retry and cancelled schedules cannot resurrect",async()=>{
  const { createPublicDocumentRepository } = await import("../seo/publicDocumentRepository.js");
  const artist=account("artist"),fan=account();db.prepare("UPDATE users SET favorite_artists=? WHERE id=?").run(JSON.stringify([artist.artist_name]),fan.id);
  const releaseAt=Date.now()+3600000,body=draft(artist,{releaseAt}),result=submit(artist,body);
  assert.equal(result.calendarReceipt.state,"scheduled");assert.equal(result.post,undefined);
  fail(()=>routes["POST /api/tourdates"](ctx(artist,{artist:artist.artist_name,releaseAt:0,dates:[{venue:body.creatorUpdate.calendar.venue,place:body.creatorUpdate.calendar.place,date:body.creatorUpdate.date,ticketUrl:body.creatorUpdate.url}]})),409);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM posts WHERE user_id=?").get(artist.id).n,0);
  assert.equal(routes["GET /api/tourdates"]({query:{}}).tourDates.some(row=>row.id===result.calendarReceipt.eventId),false);
  assert.equal(submit(artist,body).calendarReceipt.id,result.calendarReceipt.id);
  assert.equal(creatorCalendarService.runDue().published,0);
  assert.equal(createPublicDocumentRepository(db).readEvent({id:result.calendarReceipt.eventId,at:releaseAt+1}),null,"calendar cannot release ahead of its post transaction");
  const cancel=draft(artist,{action:"cancel",eventId:result.calendarReceipt.eventId,expectedRevision:1});
  assert.equal(submit(artist,cancel).calendarReceipt.state,"cancelled");
  assert.equal(submit(artist,body).calendarReceipt.state,"cancelled");
  assert.equal(creatorCalendarService.runDue({at:releaseAt+1}).published,0);
  assert.equal(createPublicDocumentRepository(db).readEvent({id:result.calendarReceipt.eventId,at:releaseAt+7200000}),null,"withdrawn private date stays private after its old release time");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE actor_id=?").get(artist.id).n,0);
  const next=draft(artist,{releaseAt,venue:"Second Hall"}); const scheduled=submit(artist,next);
  assert.equal(creatorCalendarService.runDue({at:releaseAt+1}).published,1);
  assert.equal(creatorCalendarService.runDue({at:releaseAt+1}).published,0);
  const replay=submit(artist,next);assert.ok(replay.post);assert.equal(replay.calendarReceipt.eventId,scheduled.calendarReceipt.eventId);
  assert.equal(notices(replay.id).length,1);
});

test("scheduled release rechecks revoked authority and transaction failures roll back calendar and notices",()=>{
  const artist=account("artist"),body=draft(artist,{releaseAt:Date.now()+3600000});submit(artist,body);
  db.prepare("UPDATE users SET role='fan' WHERE id=?").run(artist.id);
  assert.equal(creatorCalendarService.runDue({at:Date.now()+7200000}).blocked,1);
  fail(()=>submit(artist,body),403);
  const owner=account("artist"),fan=account();db.prepare("UPDATE users SET favorite_artists=? WHERE id=?").run(JSON.stringify([owner.artist_name]),fan.id);
  db.exec("CREATE TRIGGER fail_calendar_notice BEFORE INSERT ON notifications WHEN NEW.type='creator_update' BEGIN SELECT RAISE(ABORT,'fixture notice failure'); END");
  const publish=draft(owner);assert.throws(()=>submit(owner,publish));db.exec("DROP TRIGGER fail_calendar_notice");
  for(const table of ["posts","tour_dates"]) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${table==='posts'?'user_id':'owner_id'}=?`).get(owner.id).n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM creator_calendar_publications WHERE account_id=?").get(owner.id).n,0);
  assert.ok(submit(owner,publish).id);
});

test("private calendar dates stay private and creator publications do not produce scanner duplicates",()=>{
  const artist=account("artist");db.prepare("UPDATE users SET profile_audience='only_me' WHERE id=?").run(artist.id);
  const created=submit(q.userById.get(artist.id),draft(artist));
  assert.equal(routes["GET /api/tourdates"]({query:{}}).tourDates.some(row=>row.id===created.calendarReceipt.eventId),false);
  assert.equal(routes["GET /api/tourdates"](ctx(artist)).tourDates.some(row=>row.id===created.calendarReceipt.eventId),true);
  assert.equal(notices(created.id).length,0);
  db.prepare("UPDATE users SET profile_audience='everyone' WHERE id=?").run(artist.id);
  ensureArtistUpdatesSchema(db);
  db.prepare("INSERT OR REPLACE INTO artist_update_state(key,value) VALUES ('tour_baseline_at','1')").run();
  const scanned=scanNewTourDates(db,{newId:()=>`scan_${++sequence}`});
  assert.equal(scanned.created.some(row=>JSON.parse(row.payload).dates.some(date=>date.id===created.calendarReceipt.eventId)),false);
});

test("unclaimed canonical event/festival follows preserve preference and never grant identity; stale/held targets fail",()=>{
  const fan=account();
  for(const kind of ["festival","event"]){
    const id=`follow-target-${++sequence}`;
    if(kind==="festival") db.prepare("INSERT INTO festivals(slug,name,updated_at) VALUES (?,'Follow Festival',?)").run(id,Date.now());
    else db.prepare("INSERT INTO tour_dates(id,artist,venue,date,updated_at,music_qualified,music_evidence,provider_active) VALUES (?,'The Cure','Hall',?,?,1,'ticketmaster:classification:music',1)").run(id,day(30),Date.now());
    const key=`${kind}:${id}`,params={type:"event",key:encodeURIComponent(key)};
    const page=routes["GET /api/event-accounts/target"](ctx(fan,{}, {},{kind,id}));assert.equal(page.canFollow,true);assert.equal(page.claimed,false);
    assert.equal(db.prepare("SELECT 1 FROM creator_entities WHERE entity_key=?").get(key),undefined,"GET is read-only");
    const put=body=>routes["PUT /api/creators/:type/:key/follow"](ctx(fan,body,params));
    assert.deepEqual(put({following:true,notifyUpdates:false}),{following:true,notifyUpdates:false});
    assert.deepEqual(put({following:true,notifyUpdates:false}),{following:true,notifyUpdates:false});
    assert.equal(db.prepare("SELECT owner_id FROM creator_entities WHERE entity_key=?").get(key).owner_id,null);
    assert.equal(q.userById.get(fan.id).role,"fan");
    db.prepare("UPDATE creator_entities SET status='held' WHERE entity_key=?").run(key);fail(()=>put({following:true,notifyUpdates:false}),404);
    assert.equal(put({following:false,notifyUpdates:false}).following,false);
    db.prepare("UPDATE creator_entities SET status='active' WHERE entity_key=?").run(key);
    db.prepare(kind==="festival"?"DELETE FROM festivals WHERE slug=?":"DELETE FROM tour_dates WHERE id=?").run(id);
    fail(()=>put({following:true,notifyUpdates:false}),404);
    assert.equal(put({following:false,notifyUpdates:false}).following,false);
  }
});

async function publicationWorker(admin, body, name) {
  const { spawn } = await import("node:child_process"); const { fileURLToPath } = await import("node:url");
  const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
  writeFileSync(join(directory,name+"-body.json"),JSON.stringify(body));
  const child = spawn(process.execPath, [fileURLToPath(new URL("./fixtures/calendarPublicationWorker.mjs", import.meta.url)), directory, admin.id, name], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !["NODE_TEST_CONTEXT", "RESEND_API_KEY", "MAIL_FROM"].includes(key))),
  });
  let output = ""; for(const stream of [child.stdout, child.stderr]) stream.on("data", part => { output += part; });
  const ended = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(Error(`Event approval worker exited ${code}: ${output}`))); });
  void ended.catch(() => {});
  const timer = setTimeout(() => child.kill(), 35000);
  const wait = async suffix => {
    const deadline = Date.now() + 20000;
    while (!existsSync(join(directory, name + suffix))) { if(Date.now() > deadline) throw Error(`Event approval coordination timed out: ${name}${suffix}`); await new Promise(resolve => setTimeout(resolve, 10)); }
  };
  return { wait, go: () => writeFileSync(join(directory, name + "-go"), "go"), result: async () => { await ended; return JSON.parse(readFileSync(join(directory, name + "-result.json"), "utf8")); },
    stop: async () => { clearTimeout(timer); if(child.exitCode === null && child.signalCode === null) child.kill(); await ended.catch(() => {}); } };
}


test("independent connections serialize duplicate creates and conflicting edits without duplicate posts", {timeout:45000},async()=>{
  const artist=account("artist"),body=draft(artist);
  const race=async (bodies,label)=>{
    const workers=[];
    try {
      for(let i=0;i<bodies.length;i++)workers.push(await publicationWorker(artist,bodies[i],label+i));
      await Promise.all(workers.map(worker=>worker.wait("-ready")));
      db.exec("BEGIN IMMEDIATE");workers.forEach(worker=>worker.go());
      await Promise.all(workers.map(worker=>worker.wait("-waiting")));db.exec("COMMIT");
      return await Promise.all(workers.map(worker=>worker.result()));
    } finally {if(db.isTransaction)db.exec("ROLLBACK");await Promise.all(workers.map(worker=>worker.stop()));}
  };
  const created=await race([body,body],"same-key");
  assert.ok(created[0].id);assert.equal(created[0].id,created[1].id);
  const a=draft(artist,{action:"edit",eventId:created[0].calendarReceipt.eventId,expectedRevision:1});a.creatorUpdate.date=day(42);
  const b=structuredClone(a);b.clientMutationId+= "_second";b.creatorUpdate.date=day(43);
  const edits=await race([a,b],"same-revision");
  assert.equal(edits.filter(row=>row.id).length,1);assert.equal(edits.filter(row=>row.status===409).length,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tour_dates WHERE owner_id=?").get(artist.id).n,1);
});

test("revocation committed while publication waits on the writer lock prevents calendar, post and receipt writes",{timeout:45000},async()=>{
  const artist=account("artist"),body=draft(artist),worker=await publicationWorker(artist,body,"revoke-wait");
  try {
    await worker.wait("-ready");db.exec("BEGIN IMMEDIATE");worker.go();await worker.wait("-waiting");
    db.prepare("UPDATE users SET role='fan' WHERE id=?").run(artist.id);db.exec("COMMIT");
    const result=await worker.result();assert.ok([401,403].includes(result.status));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM tour_dates WHERE owner_id=?").get(artist.id).n,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM creator_calendar_publications WHERE account_id=?").get(artist.id).n,0);
  } finally {if(db.isTransaction)db.exec("ROLLBACK");await worker.stop();}
});

test("calendar schema, backup, private export and authenticated erasure include pending publications",async()=>{
  const {ensureCreatorCalendarSchema}=await import("./creatorCalendarSchema.js");
  const {backupSourceManifest}=await import("../../../scripts/backup-db-verification.mjs");
  const {hashPassword}=await import("../../auth.js");
  const artist=account("artist"),body=draft(artist,{releaseAt:Date.now()+3600000}),saved=submit(artist,body);
  ensureCreatorCalendarSchema(db);ensureCreatorCalendarSchema(db);
  assert.ok(backupSourceManifest(db).creator_calendar_publications.minimumRows>0);
  const password="creator-calendar-private-export1";
  db.prepare("UPDATE users SET pass_hash=? WHERE id=?").run(hashPassword(password),artist.id);
  const actor=q.userById.get(artist.id),exported=await routes["POST /api/me/export"](ctx(actor,{password}));
  assert.equal(exported.creatorAccount.calendar.length,1);assert.equal(exported.creatorAccount.calendar[0].id,saved.calendarReceipt.id);
  await routes["DELETE /api/me"](ctx(actor,{password}));
  assert.equal(db.prepare("SELECT 1 FROM creator_calendar_publications WHERE account_id=?").get(artist.id),undefined);
  assert.equal(db.prepare("SELECT 1 FROM tour_dates WHERE owner_id=?").get(artist.id),undefined);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
});

function addReadyPostImage(ownerId, suffix, at = 1_000) {
  const assetId = `ma_lease_${suffix}`;
  const variantId = `mv_lease_${suffix}`;
  const sourceKey = `users/${ownerId}/post/${suffix}-source.jpg`;
  const renderKey = `users/${ownerId}/post/${suffix}-safe.jpg`;
  const renderUrl = `https://media.example.com/cdn/${renderKey}`;
  db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'issued',?,?)`).run(sourceKey, ownerId, "private", "post", 4_096, at, at);
  db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'issued',?,?)`).run(renderKey, ownerId, "public", "post", 2_048, at, at);
  db.prepare(`INSERT INTO media_assets
    (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,
      original_name,mime_type,byte_size,width,height,orientation,metadata_status,codec_status,status,
      edit_recipe,recipe_version,finalize_hash,source_verified_at,render_state,render_variant_id,created_at,updated_at)
    VALUES (?,?,?,?,?,'image',?,?,?,'lease.jpg','image/jpeg',4096,1200,1500,0,'declared','not_applicable','ready','{}',1,?,?,'ready',?,?,?)`)
    .run(assetId, ownerId, `client_${suffix}`, "a".repeat(64), "post", sourceKey, `pit-private:${sourceKey}`, "private",
      "b".repeat(64), at, variantId, at, at);
  db.prepare(`INSERT INTO media_variants
    (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,
      status,finalize_hash,verified_at,verification_origin,created_at,updated_at)
    VALUES (?,?,?,?,'render',?,?,'image/jpeg',2048,1200,1500,'verified',?,?,'private_derivative_v1',?,?)`)
    .run(variantId, assetId, `client_${variantId}`, "c".repeat(64), renderKey, renderUrl, "d".repeat(64), at, at, at);
  return { assetId, sourceKey, renderKey, renderUrl };
}


test("scheduled uploads are held through orphan cleanup and released by private cancellation",async()=>{
  const {enqueueExpiredMediaTickets}=await import("../../mediaDeletion.js");
  const {cancelMediaAsset}=await import("../../mediaAssets.js");
  const artist=account("artist"),image=addReadyPostImage(artist.id,"scheduledfixture"),body=draft(artist,{releaseAt:Date.now()+7200000});
  body.photos=[image.renderUrl];body.mediaAssetIds=[image.assetId];
  const saved=submit(artist,body);
  for(const key of [image.sourceKey,image.renderKey])assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(key).status,"associated");
  fail(()=>cancelMediaAsset(db,{ownerId:artist.id,assetId:image.assetId}),409);
  enqueueExpiredMediaTickets(db,{at:Date.now()+10*86400000});
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(image.sourceKey).status,"associated");
  const cancel=draft(artist,{action:"cancel",eventId:saved.calendarReceipt.eventId,expectedRevision:1});submit(artist,cancel);
  for(const key of [image.sourceKey,image.renderKey])assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(key).status,"issued");
  assert.equal(cancelMediaAsset(db,{ownerId:artist.id,assetId:image.assetId}).removed,true);
});

test("due publication applies current follower preferences and rejects foreign artist/date authority",()=>{
  const artist=account("artist"),fan=account(),body=draft(artist,{releaseAt:Date.now()+3600000});
  db.prepare("UPDATE users SET favorite_artists=? WHERE id=?").run(JSON.stringify([artist.artist_name]),fan.id);
  const saved=submit(artist,body);
  routes["PUT /api/creators/:type/:key/notifications"](ctx(fan,{notifyUpdates:false},{type:"artist",key:artist.artist_name.toLowerCase()}));
  creatorCalendarService.runDue({at:Date.now()+3600001});const published=submit(artist,body);assert.equal(notices(published.id).length,0);
  for(const role of ["fan","venue","event","admin"])fail(()=>submit(account(role),body),403);
  const other=account("artist"),spoof=draft(other,{action:"edit",eventId:saved.calendarReceipt.eventId,expectedRevision:1});fail(()=>submit(other,spoof),403);
});

test("scheduled submissions remain bounded while exact retries do not consume another slot",()=>{
  const artist=account("artist"), first=draft(artist,{releaseAt:Date.now()+86400000});
  const saved=submit(artist,first);
  for(let i=1;i<20;i++) submit(artist,draft(artist,{releaseAt:Date.now()+86400000,venue:"Scheduled Hall "+i}));
  fail(()=>submit(artist,draft(artist,{releaseAt:Date.now()+86400000,venue:"Excess Hall"})),429);
  assert.equal(submit(artist,first).calendarReceipt.id,saved.calendarReceipt.id);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM creator_calendar_publications WHERE account_id=?").get(artist.id).n,20);
});
