// Real app -> authenticated HTTP -> disposable SQLite. Only delivery is
// interrupted; synthetic data setup does not replace the API being verified.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { registerPitSqliteFunctions } from '../server/sqliteFunctions.js';

const root=dirname(dirname(fileURLToPath(import.meta.url))),shots=join(root,'.tmp/private-calendar-cleanup-browser');
const wait=async(check,label,ms=25000)=>{const deadline=Date.now()+ms;while(!await check()){assert.ok(Date.now()<deadline,label);await new Promise(done=>setTimeout(done,40));}};
mkdirSync(shots,{recursive:true});
const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
const origin=`http://127.0.0.1:${port}`,directory=mkdtempSync(join(tmpdir(),'pit-auth-real-browser-'));
const env=Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
Object.assign(env,{NODE_ENV:'test',PORT:String(port),PUBLIC_ORIGIN:origin,PIT_DATA_DIR:directory,PIT_AUTH_BROWSER_FIXTURE:'1',PIT_ALLOW_EMPTY_DB_BOOTSTRAP:'true',ADMIN_PASSWORD:'Synthetic-local-password1',ADMIN_EMAIL:'owner@example.test',EMAIL_VERIFICATION_ENABLED:'true',EMAIL_CAMPAIGN_RECOVERY_ENABLED:'false',BACKUP_ENABLED:'false',TOURDATE_REFRESH_ENABLED:'false',TOURDATE_DEMAND_REFRESH_ENABLED:'false',ARTIST_GENRE_REFRESH_ENABLED:'false',ARTIST_PHOTO_SEED_ENABLED:'false',ARTIST_DEATH_WATCH_SCHEDULER_ENABLED:'false',CACHE_WARM_ENABLED:'false',MEDIA_ENDPOINT:'https://objects.example.com/s3',MEDIA_BUCKET:'pit-media',MEDIA_SOURCE_BUCKET:'pit-media-private',MEDIA_REGION:'auto',MEDIA_ACCESS_KEY_ID:'fixture',MEDIA_SECRET_ACCESS_KEY:'fixture',MEDIA_PUBLIC_BASE_URL:'https://media.example.com/cdn'});
const child=fork(join(root,'server/index.js'),[],{cwd:root,env,execArgv:['--import',pathToFileURL(join(root,'scripts/fixtures/calendar-cleanup-server-preload.mjs')).href],stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
let fixture,bound,output='',browser,db,passed=0;
child.on('message',m=>{if(m.kind==='fixture')fixture=m;if(m.kind==='listener-bound')bound=m.address;});
let dueSequence=0;const dueResults=new Map();
child.on('message',m=>{if(m.kind==='calendar-cleanup-due-result')dueResults.set(m.id,m);});
const runDue=async()=>{const id=++dueSequence;child.send({kind:'calendar-cleanup-run-due',id});await wait(()=>dueResults.has(id),'Real calendar worker response');const result=dueResults.get(id);dueResults.delete(id);assert.equal(result.error,undefined);return result.result;};
for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{output=(output+b).slice(-8000);});
try{
  await wait(()=>{assert.equal(child.exitCode,null,output);return fixture&&bound;},'Server startup',60000);assert.equal(bound,'127.0.0.1');
  db=new DatabaseSync(join(directory,'pit.db'));registerPitSqliteFunctions(db);db.exec('PRAGMA busy_timeout=10000');
  const {chromium}=createRequire(import.meta.url)(process.env.PIT_PLAYWRIGHT_MODULE||'playwright');
  browser=await chromium.launch({headless:true,executablePath:process.env.PIT_BROWSER_EXECUTABLE||undefined});
  for(const width of [375,1280])for(const mode of ['held','lost-response','stale','revoked','account-read','account-write','due-first','withdrawal-first']){
    const race=mode==='due-first'||mode==='withdrawal-first';let publishedSnapshot;
    const member=fixture.readers[passed],other=fixture.readers[90],name=`Cleanup Artist ${passed}`,key=name.toLowerCase();
    const request=async(path,body,method='POST',actor=member)=>{const r=await fetch(origin+path,{method,headers:{Cookie:actor.cookie,Origin:origin,'Content-Type':'application/json','X-Pit-Expected-Account':actor.id},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});return{status:r.status,data:await r.json()};};
    db.prepare("UPDATE users SET role='artist',artist_name=? WHERE id=?").run(name,member.id);
    db.prepare('INSERT INTO artist_profiles(artist_key,owner_id,updated_at) VALUES(?,?,?)').run(key,member.id,Date.now());
    const image=addReadyPostImage(member.id,`browser${passed}`),date=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
    const body={clientMutationId:`browser_schedule_${passed}`,kind:'status',review:'Retain the full authored announcement.',photos:[image.renderUrl],mediaAssetIds:[image.assetId],creatorUpdate:{version:1,entityType:'artist',entityKey:key,kind:'show',title:'Private show',date,location:'Cleanup Hall, Toronto, Canada',url:'',calendar:{action:'create',eventId:'',expectedRevision:0,venue:'Cleanup Hall',place:'Toronto, Canada',releaseAt:Date.now()+3600000}}};
    const saved=await request('/api/posts',body);assert.equal(saved.status,200,JSON.stringify(saved.data));
    const eventId=saved.data.calendarReceipt.eventId,payload=db.prepare('SELECT payload FROM creator_calendar_publications WHERE id=?').get(saved.data.calendarReceipt.id).payload;
    if(race)db.prepare('UPDATE users SET favorite_artists=? WHERE id=?').run(JSON.stringify([name]),fixture.readers[89].id);
    else{
      db.prepare("UPDATE artist_profiles SET identity_review_status='pending' WHERE artist_key=?").run(key);
      db.prepare("UPDATE creator_calendar_publications SET state='blocked' WHERE event_id=?").run(eventId);
      assert.deepEqual((await request('/api/me/creator-entities',undefined,'GET')).data.entities,[]);
    }
    assert.equal((await request(`/api/media/assets/${image.assetId}`,undefined,'DELETE')).status,409);
    const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
    const setCookie=actor=>context.addCookies([{name:fixture.cookieName,value:actor.cookie.slice(fixture.cookieName.length+1),url:origin,httpOnly:true,sameSite:'Lax'}]);await setCookie(member);
    const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[],writes=[],deletes=[];let lose=mode==='lost-response',delay=mode.startsWith('account-'),release,delayed=false;
    page.on('pageerror',e=>errors.push(e.message));
    await context.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());if(url.origin!==origin)return route.abort();
      const write=url.pathname==='/api/posts'&&req.method()==='POST',remove=url.pathname.startsWith('/api/media/assets/')&&req.method()==='DELETE';
      const hold=delay&&(mode==='account-read'?url.pathname==='/api/me/artist-calendar':write);
      if(write||remove||hold){
        const response=await route.fetch();const data=await response.json();
        if(write){assert.equal(req.headers()['x-pit-expected-account'],member.id);assert.equal(req.postDataJSON().creatorUpdate.calendar.privateOnly,true);writes.push({body:req.postDataJSON(),status:response.status(),data});}
        if(remove)deletes.push({status:response.status(),data});
        if(hold){delayed=true;await new Promise(done=>{release=done;});}
        if(write&&lose)return route.abort('failed');
        return route.fulfill({response}).catch(()=>{});
      }
      return route.continue();
    });
    try{
      await page.goto(origin+'/you');await page.getByRole('button',{name:'Manage profile',exact:true}).last().click();
      if(mode==='held'){
        await page.getByRole('button',{name:'Post to followers',exact:true}).first().click();
        await page.getByText('This account does not manage this page.',{exact:false}).waitFor();
        assert.equal(await page.getByRole('button',{name:'Post',exact:true}).first().isEnabled(),false);
        await page.goto(origin+'/you');await page.getByRole('button',{name:'Manage profile',exact:true}).last().click();
      }
      await page.getByRole('button',{name:'Manage private scheduled shows',exact:true}).click();
      const label=`Cleanup Hall on ${date}`,withdraw=page.getByRole('button',{name:`Withdraw ${label}`,exact:true});
      if(mode!=='account-read'){
        await withdraw.waitFor();assert.equal(await page.getByRole('button',{name:/Remove unused uploads for/}).count(),0);
        // Collapse/reopen must not mutate or publish the private record.
        if(mode==='held'){await page.getByRole('button',{name:'Manage private scheduled shows',exact:true}).click();await page.getByRole('button',{name:'Manage private scheduled shows',exact:true}).click();await withdraw.waitFor();}
        if(mode==='stale')db.prepare('UPDATE tour_dates SET creator_revision=2 WHERE id=?').run(eventId);
        if(mode==='revoked')db.prepare('UPDATE artist_profiles SET owner_id=NULL WHERE artist_key=?').run(key);
        await withdraw.click();
        if(mode==='due-first'){
          // Only advance the fixture's deadline. The actual worker must write
          // the public event, post, media linkage and Activity notification.
          db.prepare('UPDATE creator_calendar_publications SET release_at=? WHERE id=?').run(Date.now()-1000,saved.data.calendarReceipt.id);
          const due=await runDue();assert.equal(due.blocked,0);assert.ok(due.published<=1);
          assert.equal(db.prepare('SELECT count(*) n FROM posts WHERE user_id=?').get(member.id).n,1);
          assert.equal(db.prepare("SELECT count(*) n FROM notifications WHERE actor_id=? AND type='creator_update'").get(member.id).n,1);
          publishedSnapshot=db.prepare('SELECT * FROM tour_dates WHERE id=?').get(eventId);
        }
        await page.getByRole('button',{name:`Confirm withdrawal for ${label}`,exact:true}).click();
      }
      if(mode.startsWith('account-')){
        await wait(()=>delayed,'Response must be pending before account switch');
        if(mode==='account-write')assert.equal(await page.getByRole('button',{name:'Working...',exact:true}).isEnabled(),false,'Repeated confirmation is disabled while the response is pending');
        await setCookie(other);await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'pit.auth.epoch.v1',newValue:JSON.stringify({at:Date.now()})})));
        await page.getByRole('button',{name:'Manage private scheduled shows',exact:true}).waitFor({state:'hidden'});
        delay=false;release();await page.waitForTimeout(250);
        assert.equal(await page.getByText('Private scheduled shows',{exact:true}).count(),0);
        assert.equal(deletes.length,0);assert.equal(writes.length,mode==='account-write'?1:0);
        assert.deepEqual((await request('/api/me/creator-entities',undefined,'GET',other)).data.entities,[]);
      }else if(['stale','revoked'].includes(mode)){
        await wait(()=>writes.length===1,'Denied withdrawal');assert.equal(writes[0].status,mode==='stale'?409:403);
        await page.getByRole('alert').first().waitFor();assert.equal(await withdraw.isEnabled(),false);
        assert.equal(await page.getByRole('button',{name:`Confirm withdrawal for ${label}`,exact:true}).isEnabled(),false);
        assert.equal(await page.getByRole('button',{name:'Retry withdrawal',exact:true}).count(),0);assert.equal(deletes.length,0);
        assert.equal(db.prepare('SELECT event_status FROM tour_dates WHERE id=?').get(eventId).event_status,null,'Rejected withdrawal preserves the original stored status');
      }else if(mode==='due-first'){
        await wait(()=>writes.length===1,'Private-only stale confirmation');assert.equal(writes[0].status,409);
        assert.match(writes[0].data.error,/This show is no longer private/);
        await page.getByRole('alert').filter({hasText:'Refresh your private calendar. This attempt did not publish a cancellation.'}).waitFor();
        assert.equal(await page.getByRole('button',{name:`Confirm withdrawal for ${label}`,exact:true}).isEnabled(),false);
        assert.equal(await page.getByRole('button',{name:'Retry withdrawal',exact:true}).count(),0);
        for(const retry of [writes[0].body,{...writes[0].body,review:'Changed retry'}])assert.equal((await request('/api/posts',retry)).status,409);
        assert.deepEqual(db.prepare('SELECT * FROM tour_dates WHERE id=?').get(eventId),publishedSnapshot);
        assert.equal(db.prepare('SELECT 1 FROM creator_calendar_publications WHERE mutation_id=?').get(writes[0].body.clientMutationId),undefined);
        assert.equal(db.prepare('SELECT count(*) n FROM posts WHERE user_id=?').get(member.id).n,1);
        assert.equal(db.prepare("SELECT count(*) n FROM notifications WHERE actor_id=? AND type='creator_update'").get(member.id).n,1);
        assert.equal((await request(`/api/media/assets/${image.assetId}`,undefined,'DELETE')).status,409);
        assert.equal(db.prepare('SELECT count(*) n FROM post_media WHERE asset_id=?').get(image.assetId).n,1);
        await page.getByRole('button',{name:'Refresh private calendar',exact:true}).click();
        await page.getByText('No private schedules to withdraw on this page.',{exact:true}).waitFor();
        assert.equal(await withdraw.count(),0);assert.equal(deletes.length,0);
        // Separate, explicitly authorized ordinary public cancellation remains
        // available. It is not the cleanup request or a retry of that request.
        const explicit=structuredClone(writes[0].body);delete explicit.creatorUpdate.calendar.privateOnly;explicit.clientMutationId=`explicit_public_cancel_${passed}`;
        const normal=await request('/api/posts',explicit);assert.equal(normal.status,200,JSON.stringify(normal.data));assert.ok(normal.data.post);
        assert.equal((await request('/api/posts',structuredClone(explicit))).data.id,normal.data.id);
      }else{
        if(lose){
          await page.getByRole('button',{name:'Retry withdrawal',exact:true}).waitFor();assert.equal(writes.length,1);assert.equal(writes[0].status,200);
          lose=false;await page.getByRole('button',{name:'Retry withdrawal',exact:true}).click();
          await wait(()=>writes.length===2,'Same withdrawal retry');assert.deepEqual(writes[1].body,writes[0].body);assert.deepEqual(writes[1].data.calendarReceipt,writes[0].data.calendarReceipt);
        }
        await page.getByText('Show withdrawn. No update was published.',{exact:true}).waitFor();
        if(mode==='withdrawal-first'){
          db.prepare('UPDATE creator_calendar_publications SET release_at=? WHERE id=?').run(Date.now()-1000,saved.data.calendarReceipt.id);
          assert.deepEqual(await runDue(),{published:0,blocked:0});
          assert.equal((await request('/api/posts',structuredClone(writes[0].body))).data.calendarReceipt.id,writes[0].data.calendarReceipt.id);
          for(const changed of [{...writes[0].body,review:'Changed retry'},{...writes[0].body,creatorUpdate:{...writes[0].body.creatorUpdate,calendar:{...writes[0].body.creatorUpdate.calendar,privateOnly:undefined}}}])assert.equal((await request('/api/posts',changed)).status,409);
        }
        // Cold restoration must rediscover cleanup eligibility from the server.
        await page.goto(origin+'/you');await page.getByRole('button',{name:'Manage profile',exact:true}).last().click();await page.getByRole('button',{name:'Manage private scheduled shows',exact:true}).click();
        await page.getByRole('button',{name:`Remove unused uploads for ${label}`,exact:true}).click();
        await page.getByRole('button',{name:`Confirm upload removal for ${label}`,exact:true}).click();
        await page.getByText('Unused uploads removed.',{exact:true}).waitFor();assert.equal(deletes.length,1);assert.equal(deletes[0].status,200);
        assert.equal(db.prepare('SELECT 1 FROM media_assets WHERE id=?').get(image.assetId),undefined);
        for(const objectKey of [image.sourceKey,image.renderKey])assert.ok(db.prepare('SELECT 1 FROM media_deletion_queue WHERE object_key=?').get(objectKey));
        assert.equal(db.prepare('SELECT event_status FROM tour_dates WHERE id=?').get(eventId).event_status,'cancelled');
        if(!race){
          assert.deepEqual((await request('/api/me/creator-entities',undefined,'GET')).data.entities,[]);
          assert.equal((await request('/api/posts',{...body,clientMutationId:`denied_publish_${passed}`})).status,409);
        }
      }
      assert.equal(db.prepare('SELECT count(*) n FROM posts WHERE user_id=?').get(member.id).n,mode==='due-first'?2:0);
      assert.equal(db.prepare('SELECT count(*) n FROM notifications WHERE actor_id=?').get(member.id).n,mode==='due-first'?2:0);
      assert.equal(db.prepare('SELECT payload FROM creator_calendar_publications WHERE id=?').get(saved.data.calendarReceipt.id).payload,payload);
      assert.deepEqual(errors,[]);await page.screenshot({path:join(shots,`${mode}-${width}.png`)});passed++;console.log(JSON.stringify({width,mode,passed:true,writes:writes.length,deletes:deletes.length}));
    }catch(error){await page.screenshot({path:join(shots,`failure-${mode}-${width}.png`)});console.error((await page.locator('body').innerText()).slice(-6000));throw error;}
    finally{release?.();await context.close();}
  }
  console.log(JSON.stringify({passed,failed:0,boundary:'real app/authenticated HTTP/disposable SQLite; all outbound blocked'}));
}finally{await browser?.close();db?.close();if(child.exitCode===null){const exited=new Promise(done=>child.once('exit',done));child.kill();await exited;}rmSync(directory,{recursive:true,force:true});}

function addReadyPostImage(ownerId,suffix){
  const at=Date.now(),assetId=`ma_cleanup_${suffix}`,variantId=`mv_cleanup_${suffix}`,sourceKey=`users/${ownerId}/post/${suffix}-source.jpg`,renderKey=`users/${ownerId}/post/${suffix}-safe.jpg`,renderUrl=`https://media.example.com/cdn/${renderKey}`;
  for(const [key,scope,size] of [[sourceKey,'private',4096],[renderKey,'public',2048]])db.prepare("INSERT INTO media_objects(object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at) VALUES(?,?,?,'post',?,'issued',?,?)").run(key,ownerId,scope,size,at,at);
  db.prepare(`INSERT INTO media_assets(id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,original_name,mime_type,byte_size,width,height,orientation,metadata_status,codec_status,status,edit_recipe,recipe_version,finalize_hash,source_verified_at,render_state,render_variant_id,created_at,updated_at)
    VALUES(?,?,?,?,'post','image',?,?,'private','fixture.jpg','image/jpeg',4096,1200,1500,0,'declared','not_applicable','ready','{}',1,?,?,'ready',?,?,?)`).run(assetId,ownerId,`client_${suffix}`,'a'.repeat(64),sourceKey,`pit-private:${sourceKey}`,'b'.repeat(64),at,variantId,at,at);
  db.prepare(`INSERT INTO media_variants(id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,status,finalize_hash,verified_at,verification_origin,created_at,updated_at)
    VALUES(?,?,?,?,'render',?,?,'image/jpeg',2048,1200,1500,'verified',?,?,'private_derivative_v1',?,?)`).run(variantId,assetId,`client_${variantId}`,'c'.repeat(64),renderKey,renderUrl,'d'.repeat(64),at,at,at);
  return{assetId,sourceKey,renderKey,renderUrl};
}
