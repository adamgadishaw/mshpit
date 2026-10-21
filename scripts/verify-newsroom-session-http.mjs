// Actual server listener and cookies; synthetic SQLite, loopback only, no provider traffic.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'..'),directory=mkdtempSync(join(tmpdir(),'pit-auth-real-browser-'));
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const origin=`http://127.0.0.1:${port}`;
const env=Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP','LOCALAPPDATA'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
Object.assign(env,{NEWSROOM_BROWSER_SESSIONS_ENABLED:'true',NODE_ENV:'test',PORT:String(port),PUBLIC_ORIGIN:origin,PIT_DATA_DIR:directory,PIT_AUTH_BROWSER_FIXTURE:'1',PIT_NEWSROOM_BROWSER_FIXTURE:'1',PIT_ALLOW_EMPTY_DB_BOOTSTRAP:'true',
 ADMIN_PASSWORD:'Synthetic-bootstrap-pass1',ADMIN_EMAIL:'bootstrap@example.test',NEWS_DESK_ACCOUNT_ID:'newsroom_http_publisher',MEDIA_PUBLIC_BASE_URL:'https://media.example.test',
 NEWS_DESK_ENABLED:'false',PIT_MEDIA_API_ENABLED:'false',BACKUP_ENABLED:'false',EMAIL_CAMPAIGN_RECOVERY_ENABLED:'false',CACHE_WARM_ENABLED:'false',TOURDATE_REFRESH_ENABLED:'false',TOURDATE_DEMAND_REFRESH_ENABLED:'false',ARTIST_GENRE_REFRESH_ENABLED:'false',ARTIST_PHOTO_SEED_ENABLED:'false',ARTIST_DEATH_WATCH_SCHEDULER_ENABLED:'false'});
let fixture,output='',listener,checks=0,sequence=0;const pending=new Map();
const child=fork(join(root,'server/index.js'),[],{cwd:root,env,execArgv:['--max-old-space-size=192','--import',pathToFileURL(join(root,'scripts/fixtures/newsroom-session-preload.mjs')).href],stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
child.stdout.on('data',v=>{output=(output+v).slice(-10000);});child.stderr.on('data',v=>{output=(output+v).slice(-10000);});
child.on('message',m=>{if(m.kind==='fixture')fixture=m;if(m.kind==='listener-bound')listener=m.address;if(m.kind==='reply'){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.result);}});
const exited=new Promise(r=>child.once('exit',r));
function ipc(operation,extra={}){return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});child.send({id,operation,...extra});});}
async function request(path,{cookie,method='GET',body,expected,foreign=false}={}){
 const response=await fetch(origin+path,{method,redirect:'error',headers:{...(cookie?{Cookie:cookie}:{}),...(expected?{'X-Pit-Expected-Account':expected}:{}),...(body===undefined?{}:{'Content-Type':'application/json',Origin:foreign?'https://untrusted.example':origin})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
 return {status:response.status,data:await response.json(),cookies:response.headers.getSetCookie()};
}
const cookie=(result,name)=>result.cookies.find(c=>c.startsWith(name+'='))?.split(';')[0];
async function enable(fullCookie,previous){return request('/api/me/newsroom-session',{cookie:fullCookie+(previous?'; '+previous:''),method:'POST',body:{currentPassword:fixture.password}});}
function check(name){checks++;console.log(JSON.stringify({name,passed:true}));}
try{
 const deadline=Date.now()+25000;while(!fixture||!listener){if(child.exitCode!==null||Date.now()>deadline)throw Error(output);await new Promise(r=>setTimeout(r,30));}
 assert.equal(listener,'127.0.0.1');await fetch(origin+'/api/health');
 assert.equal((await request('/api/newsroom-session/status')).status,401);check('cleared or absent cookies do not recover identity');
 assert.equal((await enable(fixture.users.fan.cookie)).status,403);check('member cannot enable a Newsroom credential');
 assert.equal((await request('/api/me/newsroom-session',{cookie:fixture.users.owner.cookie,method:'POST',body:{currentPassword:'wrong'}})).status,401);check('fresh password proof required');
 const issued=await enable(fixture.users.owner.cookie);assert.equal(issued.status,200);const scoped=cookie(issued,'pit_newsroom');assert.ok(scoped);assert.match(issued.cookies.find(c=>c.startsWith('pit_newsroom=')),/HttpOnly; SameSite=Lax; Expires=/);check('fresh full staff session issues separate persistent scope cookie');
 assert.equal((await request('/api/me',{cookie:scoped})).data.user,null);check('scoped cookie is not a website account session');
 assert.equal((await request('/api/me',{cookie:scoped.replace('pit_newsroom=','pit_session=')})).data.user,null);check('placing scoped token in full cookie cannot grant staff access');
 for(const [method,path,body] of [['POST','/api/media/assets',{contentType:'image/jpeg',fileSize:1000}],['POST','/api/moderation/news-desk/editor/drafts',{}],['GET','/api/moderation/news-desk/editor'],['POST','/api/me/newsroom-session',{currentPassword:fixture.password}],['POST','/api/me/export',{}],['POST','/api/admin/users/'+fixture.users.fan.id+'/ban',{}]]){
  const denied=await request(path,{method,body,cookie:scoped});assert.ok([401,403,404].includes(denied.status),path+' '+denied.status);check('scope denied: '+method+' '+path);
 }
 for(const [body,label] of [[{clientAssetId:'video',contentType:'video/mp4',fileSize:1},'video'],[{clientAssetId:'large',contentType:'image/jpeg',fileSize:11*1024*1024},'oversize'],[{clientAssetId:'avatar',contentType:'image/jpeg',fileSize:1,purpose:'avatar'},'arbitrary purpose'],[{clientAssetId:'url',contentType:'image/jpeg',fileSize:1,url:'https://untrusted.example'},'arbitrary URL']]){
  assert.equal((await request('/api/newsroom-session/media',{cookie:scoped,method:'POST',body})).status,400);check('photo rejected before storage: '+label);
 }
 assert.equal((await request('/api/newsroom-session/media/'+fixture.photos.peer.assetId,{cookie:scoped})).status,404);check('foreign photo denied');
 assert.equal((await request('/api/newsroom-session/media/'+fixture.photos.owner.assetId,{cookie:scoped})).status,200);check('bound own verified photo readable');
 for(const id of [fixture.foreignDraft,fixture.ordinaryDraft]){assert.equal((await request('/api/newsroom-session/drafts/'+id,{cookie:scoped})).status,404);check('foreign or full-Newsroom draft excluded');}
 const payload={headline:'Radiohead announce new world tour dates',summary:'Radiohead have announced a new world tour with confirmed concert dates.',body:'The band announced the tour on its official website.',category:'tour',sources:[{kind:'article',name:'Radiohead',url:'https://radiohead.com/news/tour-new'}],photo:{assetId:fixture.photos.owner.assetId,source:{name:'Fixture photographer',url:'https://example.test/photo-rights',credit:'Synthetic image'}},idempotencyKey:'http-scope-article-1'};
 assert.equal((await request('/api/newsroom-session/drafts',{cookie:scoped,method:'POST',body:payload,foreign:true})).status,403);check('CSRF origin guard retained');
 const saved=await request('/api/newsroom-session/drafts',{cookie:scoped,method:'POST',body:payload,expected:fixture.users.owner.id});assert.equal(saved.status,200,JSON.stringify(saved.data));const id=saved.data.draft.id;check('self-written actor-bound article and source citations saved');
 const foreignPhoto=await request('/api/newsroom-session/drafts',{cookie:scoped,method:'POST',body:{...payload,photo:{...payload.photo,assetId:fixture.photos.peer.assetId},idempotencyKey:'http-foreign-photo'}});assert.equal(foreignPhoto.status,404);check('save cannot attach another editor photo');
 const replay=await request('/api/newsroom-session/drafts',{cookie:scoped,method:'POST',body:payload});assert.equal(replay.data.draft.id,id);check('stable save retries do not duplicate the draft');
 const own=await request('/api/newsroom-session/drafts/'+id,{cookie:scoped});assert.equal(own.status,200);assert.equal(own.data.draft.photo.status,'ready');assert.equal(own.data.draft.body,payload.body);check('scoped preview reads exact own article and safe derivative');
 const reopened=await request('/api/newsroom-session/drafts',{cookie:scoped,method:'POST',body:{...payload,headline:'Radiohead confirm additional world tour dates',idempotencyKey:'http-reopened-copy-1'}});assert.equal(reopened.status,200,JSON.stringify(reopened.data));assert.notEqual(reopened.data.draft.id,id);assert.equal((await request('/api/newsroom-session/drafts/'+id,{cookie:scoped})).data.draft.headline,payload.headline);check('reopened editable copy reuses owned verified photo and preserves original draft');
 assert.equal((await request('/api/newsroom-session/drafts/'+id+'/publish',{cookie:scoped,method:'POST',body:{expectedRevision:999}})).status,409);check('publish requires matching preview revision');
 const published=await request('/api/newsroom-session/drafts/'+id+'/publish',{cookie:scoped,method:'POST',body:{expectedRevision:own.data.draft.revision}});assert.equal(published.status,200,JSON.stringify(published.data));assert.equal(published.data.draft.status,'published');check('own self-written article publishes through existing publication checks');
 assert.equal((await ipc('snapshot')).paid,0);check('no generated-news or paid receipt work invoked');
 const baseline=await request('/api/newsroom-session/status',{cookie:scoped});
 await ipc('advance',{hours:0.25});const early=await request('/api/newsroom-session/status',{cookie:scoped});assert.equal(early.status,200);assert.ok(cookie(early,'pit_newsroom'));assert.ok(early.data.expiresAt>baseline.data.expiresAt+14*60000);assert.equal(early.data.absoluteExpiresAt,baseline.data.absoluteExpiresAt);check('successful confirmation refreshes seven-day inactivity before twelve hours without moving absolute deadline');
 await ipc('advance',{hours:0.5});const deniedRenewal=await request('/api/newsroom-session/status',{cookie:scoped,expected:fixture.users.peer.id});assert.equal(deniedRenewal.status,409);assert.equal(cookie(deniedRenewal,'pit_newsroom'),undefined);
 const afterDenied=await request('/api/newsroom-session/status',{cookie:scoped});assert.ok(cookie(afterDenied,'pit_newsroom'));assert.ok(afterDenied.data.expiresAt>early.data.expiresAt+14*60000);assert.equal(afterDenied.data.absoluteExpiresAt,baseline.data.absoluteExpiresAt);check('failed identity confirmation does not renew scope');
 await ipc('advance',{hours:13});assert.equal((await request('/api/me',{cookie:fixture.users.owner.cookie})).data.user,null);assert.equal((await request('/api/newsroom-session/status',{cookie:scoped})).status,200);check('after twelve hours only the separate Newsroom authority remains');
 await ipc('advance',{hours:36});assert.equal((await request('/api/newsroom-session/status',{cookie:scoped})).status,200);check('valid scope confirmation renews its bounded idle window');
 const loggedOut=await request('/api/logout',{cookie:scoped,method:'POST',body:{}});assert.equal(loggedOut.status,200);assert.ok(loggedOut.cookies.some(c=>c.startsWith('pit_newsroom=;')&&c.includes('Max-Age=0')));assert.equal((await request('/api/newsroom-session/status',{cookie:scoped})).status,401);check('normal website logout revokes scoped cookie even with expired full session');
 await ipc('advance',{hours:0});
 const login=await request('/api/login',{method:'POST',body:{email:fixture.users.owner.email,password:fixture.password}});const full=cookie(login,'pit_session');assert.equal(login.status,200);
 const roleScope=cookie(await enable(full),'pit_newsroom');await ipc('role-loss');assert.equal((await request('/api/newsroom-session/status',{cookie:roleScope})).status,401);await ipc('restore-role');assert.equal((await request('/api/newsroom-session/status',{cookie:roleScope})).status,401);check('role loss and restoration cannot resurrect scope');
 const peerA=cookie(await enable(fixture.users.peer.cookie),'pit_newsroom'),peerB=cookie(await enable(fixture.users.peer.cookie),'pit_newsroom');assert.ok(peerA&&peerB);
 const all=await request('/api/newsroom-session/logout-all',{cookie:peerA,method:'POST',body:{}});assert.equal(all.data.revoked,2);assert.equal((await request('/api/newsroom-session/status',{cookie:peerB})).status,401);assert.equal((await request('/api/me',{cookie:fixture.users.peer.cookie})).data.user.id,fixture.users.peer.id);check('own scope logout-all revokes all remembered browsers without extending or deleting full authority');
 console.log(JSON.stringify({passed:checks,failed:0,listener:'actual server/index.js on loopback',database:'synthetic temporary',providers:'outbound blocked'}));
}finally{if(child.exitCode===null)child.kill();await exited;rmSync(directory,{recursive:true,force:true});}
