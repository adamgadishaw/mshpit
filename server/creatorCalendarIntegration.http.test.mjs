import assert from "node:assert/strict";
import test from "node:test";
import { fork } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { venuePath } from "../src/domain/urls.mjs";
import { registerPitSqliteFunctions } from "./sqliteFunctions.js";

// Actual auth/venue HTTP routes, SQLite and public metadata. The established
// local preload prevents outbound connections and binds only loopback.
test("calendar receipts, privacy and venue/event/festival follows share the real authenticated HTTP boundary", { timeout: 60000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const reservation = createServer();
  await new Promise(done => reservation.listen(0, "127.0.0.1", done));
  const port = reservation.address().port;
  await new Promise(done => reservation.close(done));
  const origin = `http://127.0.0.1:${port}`;
  const directory = mkdtempSync(join(tmpdir(), "pit-auth-real-browser-"));
  const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA"].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  Object.assign(env, { NODE_ENV: "test", PORT: String(port), PUBLIC_ORIGIN: origin, PIT_DATA_DIR: directory,
    PIT_AUTH_BROWSER_FIXTURE: "1", PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "true", ADMIN_PASSWORD: "Synthetic-local-password1", ADMIN_EMAIL: "owner@example.test",
    EMAIL_VERIFICATION_ENABLED: "true", EMAIL_CAMPAIGN_RECOVERY_ENABLED: "false", BACKUP_ENABLED: "false",
    TOURDATE_REFRESH_ENABLED: "false", TOURDATE_DEMAND_REFRESH_ENABLED: "false", ARTIST_GENRE_REFRESH_ENABLED: "false", ARTIST_PHOTO_SEED_ENABLED: "false",
    ARTIST_DEATH_WATCH_SCHEDULER_ENABLED: "false", CACHE_WARM_ENABLED: "false" });
  const child = fork(join(root, "server/index.js"), [], { cwd: root, env,
    execArgv: ["--import", pathToFileURL(join(root, "scripts/fixtures/auth-real-server-preload.mjs")).href], stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  let fixture, bound, output = "";
  child.on("message", message => { if (message.kind === "fixture") fixture = message; if (message.kind === "listener-bound") bound = message.address; });
  child.stdout.on("data", bytes => { output = (output + bytes).slice(-4000); });
  child.stderr.on("data", bytes => { output = (output + bytes).slice(-4000); });
  let database;
  try {
    const deadline = Date.now() + 20000;
    while (!fixture || !bound) { assert.equal(child.exitCode, null, output); assert.ok(Date.now() < deadline, output); await new Promise(done => setTimeout(done, 40)); }
    assert.equal(bound, "127.0.0.1");
    const member = fixture.readers[0];
    const request = async (path, body, method = "POST", serialized = JSON.stringify(body)) => {
      const response = await fetch(origin + path, { method, headers: { Cookie: member.cookie, "X-Pit-Expected-Account": member.id, Origin: origin, "Content-Type": "application/json" }, body: serialized, signal: AbortSignal.timeout(10000) });
      return { status: response.status, data: await response.json() };
    };
    database = new DatabaseSync(join(directory, "pit.db"));
    registerPitSqliteFunctions(database);
    database.exec('PRAGMA busy_timeout=10000; BEGIN IMMEDIATE');
    const artistName = 'HTTP Calendar Artist', artistKey = artistName.toLowerCase(), fan = fixture.readers[1];
    database.prepare("UPDATE users SET role='artist',artist_name=? WHERE id=?").run(artistName, member.id);
    database.prepare('INSERT INTO artist_profiles(artist_key,owner_id,updated_at) VALUES(?,?,?)').run(artistKey,member.id,Date.now());
    database.prepare('UPDATE users SET favorite_artists=? WHERE id=?').run(JSON.stringify([artistName]),fan.id);
    const name = 'Shared Registry Hall', path = venuePath({ name, source: 'ticketmaster', providerVenueId: 'shared-registry-hall' });
    database.prepare(`INSERT INTO tour_dates(id,artist,venue,place,date,source,updated_at,release_at,provider_active,music_qualified,music_evidence,
      venue_provider_id,venue_city,venue_region,venue_country_code,venue_country)
      VALUES('http-registry-event','The Cure',?,'Toronto, Ontario, Canada','2099-01-01','ticketmaster',1,0,1,1,'ticketmaster:classification:music',
        'shared-registry-hall','Toronto','Ontario','CA','Canada')`).run(name);
    database.prepare("INSERT INTO festivals(slug,name,updated_at) VALUES('http-follow-festival','HTTP Festival',1)").run();
    database.prepare("INSERT INTO venue_reviews(id,venue_key,user_id,rating,text,created_at) VALUES('http-shared-score',?,?,4.2,'',1)").run(path,fan.id);
    database.exec('COMMIT');
    const fanRequest = async (path, body, method='PUT') => {
      const response = await fetch(origin + path, { method, headers: { Cookie: fan.cookie, 'X-Pit-Expected-Account': fan.id, Origin:origin, 'Content-Type':'application/json' },
        body:body === undefined ? undefined : JSON.stringify(body),signal:AbortSignal.timeout(10000) });
      return {status:response.status,data:await response.json()};
    };
    const endpoint = (type,key) => '/api/creators/'+type+'/'+encodeURIComponent(key)+'/follow';
    for (const [type,key] of [['venue',path],['event','event:http-registry-event'],['event','festival:http-follow-festival']]) {
      const read = await fanRequest(endpoint(type,key),undefined,'GET');
      assert.equal(read.status,200,JSON.stringify(read.data));
      assert.equal(database.prepare('SELECT count(*) n FROM creator_entities WHERE entity_type=? AND entity_key=?').get(type,key).n,0);
      for(const preference of [{following:true,notifyUpdates:false},{following:false},{following:true}]) {
        const result = await fanRequest(endpoint(type,key),preference);
        assert.equal(result.status,200,JSON.stringify(result.data));
        assert.equal(result.data.following,preference.following); assert.equal(result.data.notifyUpdates,false);
      }
      const registry = database.prepare('SELECT * FROM creator_entities WHERE entity_type=? AND entity_key=?').get(type,key);
      assert.equal(registry.owner_id,null); assert.equal(registry.status,'active');
      assert.equal(database.prepare('SELECT count(*) n FROM creator_follows WHERE account_id=? AND entity_type=? AND entity_key=?').get(fan.id,type,key).n,1);
    }
    assert.equal(database.prepare('SELECT role FROM users WHERE id=?').get(fan.id).role,'fan');
    assert.deepEqual((await fanRequest('/api/me/creator-entities',undefined,'GET')).data.entities,[]);
    database.prepare("UPDATE creator_entities SET status='held' WHERE entity_key='event:http-registry-event'").run();
    assert.equal((await fanRequest(endpoint('event','event:http-registry-event'),{following:true})).status,404);
    assert.equal((await fanRequest(endpoint('event','event:http-registry-event'),{following:false})).status,200);
    database.prepare("DELETE FROM festivals WHERE slug='http-follow-festival'").run();
    assert.equal((await fanRequest(endpoint('event','festival:http-follow-festival'),{following:true})).status,404);
    assert.equal((await fanRequest(endpoint('event','festival:http-follow-festival'),{following:false})).status,200);
    const review = await fanRequest('/api/venue-community?path='+encodeURIComponent(path),undefined,'GET');
    assert.deepEqual(review.data.rating,{count:1,average:4.2});
    const day = new Date(Date.now()+30*86400000).toISOString().slice(0,10);
    const draft = (id,patch={}) => ({clientMutationId:id,kind:'status',review:'Doors open at seven.',creatorUpdate:{version:1,entityType:'artist',entityKey:artistKey,
      kind:'show',title:'New show',date:day,location:'Calendar Hall, Toronto, Canada',url:'https://tickets.example.com/show',
      calendar:{action:'create',eventId:'',expectedRevision:0,venue:'Calendar Hall',place:'Toronto, Canada',releaseAt:0,...patch}}});
    const original = draft('http_calendar_original'), created = await request('/api/posts',original);
    assert.equal(created.status,200,JSON.stringify(created.data));
    const eventId = created.data.calendarReceipt.eventId, postId = created.data.id;
    assert.ok(eventId); assert.ok(postId);
    // Deliberately discard the first response at the client boundary and retry
    // the original body: persisted post/calendar/notice identity must survive.
    const retry = await request('/api/posts',structuredClone(original));
    assert.equal(retry.status,200); assert.equal(retry.data.id,postId); assert.equal(retry.data.calendarReceipt.eventId,eventId);
    assert.equal(database.prepare('SELECT count(*) n FROM posts WHERE user_id=?').get(member.id).n,1);
    assert.equal(database.prepare('SELECT count(*) n FROM notifications WHERE post_id=? AND user_id=?').get(postId,fan.id).n,1);
    const changed = structuredClone(original); changed.review += ' Changed suffix.';
    assert.equal((await request('/api/posts',changed)).status,409);
    assert.equal((await fanRequest(endpoint('event','event:'+eventId),{following:true})).status,200);
    const pending = draft('http_calendar_scheduled',{venue:'Private Calendar Hall',releaseAt:Date.now()+3600000});
    const scheduled = await request('/api/posts',pending);
    assert.equal(scheduled.status,200,JSON.stringify(scheduled.data)); assert.equal(scheduled.data.calendarReceipt.state,'scheduled');
    assert.equal(scheduled.data.post,undefined);
    const pendingId = scheduled.data.calendarReceipt.eventId;
    assert.equal((await request('/api/posts',pending)).data.calendarReceipt.id,scheduled.data.calendarReceipt.id);
    assert.equal((await fanRequest(endpoint('event','event:'+pendingId),{following:true})).status,404);
    const publicDates = await fetch(origin+'/api/tourdates').then(r=>r.json());
    assert.equal(publicDates.tourDates.some(row=>row.id===pendingId),false);
    const cancelled = await request('/api/posts',draft('http_calendar_withdraw',{action:'cancel',eventId:pendingId,expectedRevision:1,venue:'Private Calendar Hall'}));
    assert.equal(cancelled.status,200,JSON.stringify(cancelled.data)); assert.equal(cancelled.data.calendarReceipt.state,'cancelled');
    assert.equal((await request('/api/posts',pending)).data.calendarReceipt.state,'cancelled');
    assert.equal(database.prepare('SELECT count(*) n FROM posts WHERE user_id=?').get(member.id).n,1);
    const edit = draft('http_calendar_edit',{action:'edit',eventId,expectedRevision:1,venue:'Updated Calendar Hall'});
    const edited = await request('/api/posts',edit);
    assert.equal(edited.status,200,JSON.stringify(edited.data)); assert.equal(edited.data.calendarReceipt.eventId,eventId);
    assert.equal(edited.data.calendarReceipt.revision,2);
    assert.equal((await request('/api/posts',{...edit,clientMutationId:'http_calendar_stale'})).status,409);
    // Real authenticated withdrawal of a persisted private receipt after its
    // publication is blocked. The service suite exercises the actual due
    // worker; here the state transition is a disposable SQLite fixture.
    const withdrawals=[];
    for(const suffix of ['memorial','held']){
      const body=draft('http_private_'+suffix,{venue:'Withdraw Hall '+suffix,releaseAt:Date.now()+3600000});
      const result=await request('/api/posts',body);assert.equal(result.status,200,JSON.stringify(result.data));
      withdrawals.push({body,result});
    }
    const stamp=Date.now(),mbid='4825c19c-4185-46a3-bd87-2d1537fe3e4f';
    database.exec('BEGIN IMMEDIATE');
    database.prepare('INSERT INTO artists(norm,name,mbid,created_at,updated_at) VALUES(?,?,?,?,?)').run(artistKey,artistName,mbid,stamp,stamp);
    database.prepare(`INSERT INTO artist_memorials(artist_key,artist_name,artist_mbid,status,death_date,summary,thank_you,accomplishments,source_url,published_at,spotlight_started_at,created_at,updated_at)
      VALUES(?,?,?,'published',?,'Verified fixture memorial.','Thank you.','["A musical legacy"]','https://example.com/memorial',?,?,?,?)`)
      .run(artistKey,artistName,mbid,new Date(stamp).toISOString().slice(0,10),stamp,stamp,stamp,stamp);
    for(const {result} of withdrawals)database.prepare("UPDATE creator_calendar_publications SET state='blocked' WHERE id=?").run(result.data.calendarReceipt.id);
    database.exec('COMMIT');
    const postsBefore=database.prepare('SELECT count(*) n FROM posts WHERE user_id=?').get(member.id).n;
    const noticesBefore=database.prepare('SELECT count(*) n FROM notifications WHERE actor_id=?').get(member.id).n;
    for(const [index,{body,result}] of withdrawals.entries()){
      if(index)database.prepare("UPDATE artist_profiles SET identity_review_status='pending' WHERE artist_key=?").run(artistKey);
      const eventId=result.data.calendarReceipt.eventId;
      const list=await request('/api/me/artist-calendar',undefined,'GET');assert.equal(list.status,200);assert.ok(list.data.events.some(row=>row.id===eventId));
      const cancel=draft('http_withdraw_'+index,{...body.creatorUpdate.calendar,action:'cancel',eventId,expectedRevision:1});
      assert.equal((await request('/api/posts',{...cancel,creatorUpdate:{...cancel.creatorUpdate,calendar:{...cancel.creatorUpdate.calendar,expectedRevision:0}}})).status,409);
      const withdrawn=await request('/api/posts',cancel);assert.equal(withdrawn.status,200,JSON.stringify(withdrawn.data));
      assert.equal(withdrawn.data.calendarReceipt.state,'cancelled');assert.equal(withdrawn.data.post,undefined);
      // Discard the first response and retry the unchanged authored request.
      const replay=await request('/api/posts',structuredClone(cancel));
      assert.equal(replay.status,200);assert.deepEqual(replay.data.calendarReceipt,withdrawn.data.calendarReceipt);assert.equal(replay.data.post,undefined);
      assert.equal((await request('/api/posts',{...cancel,review:'Changed withdrawal body'})).status,409);
      const row=database.prepare('SELECT * FROM tour_dates WHERE id=?').get(eventId);assert.equal(row.creator_revision,2);assert.equal(row.event_status,'cancelled');assert.equal(row.release_at,Number.MAX_SAFE_INTEGER);
      assert.equal((await fanRequest(endpoint('event','event:'+eventId),{following:true})).status,404);
    }
    assert.equal(database.prepare('SELECT count(*) n FROM posts WHERE user_id=?').get(member.id).n,postsBefore);
    assert.equal(database.prepare('SELECT count(*) n FROM notifications WHERE actor_id=?').get(member.id).n,noticesBefore);
    database.prepare('UPDATE artist_profiles SET owner_id=NULL WHERE artist_key=?').run(artistKey);
    const denied = await request('/api/posts',draft('http_calendar_revoked',{action:'cancel',eventId,expectedRevision:2}));
    assert.equal(denied.status,403,JSON.stringify(denied.data));
    assert.equal(database.prepare('SELECT creator_revision FROM tour_dates WHERE id=?').get(eventId).creator_revision,2);
    assert.equal(database.prepare('SELECT rating FROM venue_reviews WHERE id=?').get('http-shared-score').rating,4.2);
    assert.deepEqual((await fanRequest('/api/venue-community?path='+encodeURIComponent(path),undefined,'GET')).data.rating,{count:1,average:4.2});
    assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  } finally {
    database?.close();
    if (child.exitCode === null) { const exited = new Promise(done => child.once('exit',done)); child.kill(); await exited; }
    rmSync(directory,{recursive:true,force:true});
  }
});
