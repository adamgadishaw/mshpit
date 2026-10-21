import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test,{after} from 'node:test';
const directory=mkdtempSync(join(tmpdir(),'pit-newsroom-scope-'));
process.env.NEWSROOM_BROWSER_SESSIONS_ENABLED="true";
process.env.PIT_DATA_DIR=directory;process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP='true';delete process.env.RESEND_API_KEY;delete process.env.MAIL_FROM;
const {db,q}=await import('../../db.js');
const {createSession,createNewsroomSession,getSession,destroySession,renewNewsroomSession,hashPassword,newsroomCookieHeaders,NEWSROOM_SESSION_MAX_MS,PRIVILEGED_SESSION_TTL_MS}=await import('../../auth.js');
const {readAuthorizedRequest}=await import('../../requestAuthorization.js');
const {routes}=await import('../../api.js');
const {newsroomSessionRoutes}=await import('./newsroomSessionRoutes.js');
const {ApiError}=await import('../../errors.js');
const realNow=Date.now;
after(()=>{Date.now=realNow;db.close();rmSync(directory,{recursive:true,force:true});});
let sequence=0;const password='Synthetic-scope-password1',passHash=hashPassword(password);
function user(role='admin'){const id='scoped_'+(++sequence);q.insertUser.run(id,id+'@example.test',id,id,passHash,role,'',null,null,'NS','#123456',realNow());db.prepare("UPDATE users SET email_verified_at=?,age_band='18_plus',onboarding_version=1 WHERE id=?").run(realNow(),id);return q.userById.get(id);}
async function context(token,method='GET',pathname='/api/newsroom-session/status',body={},scope='newsroom',extra={}){return {...await readAuthorizedRequest({token,method,pathname,sessionScope:scope,readBody:async()=>body}),token,ip:'synthetic-scope',params:{},setHeader(){},...extra};}
const digest=value=>createHash('sha256').update(value).digest('hex');

test('separate hashed cookie cannot authorize full access even in the full cookie name',()=>{
 const actor=user(),full=createSession(actor.id),scoped=createNewsroomSession(actor.id);
 assert.ok(getSession(full.token));assert.equal(getSession(scoped.token),null);assert.equal(getSession(full.token,{scope:'newsroom'}),null);
 const row=getSession(scoped.token,{scope:'newsroom'});assert.equal(row.session_scope,'newsroom');assert.equal(row.auth_role,'admin');assert.equal(q.sessionByHash.get(digest(scoped.token)),undefined,'legacy full-session lookup cannot find this token');assert.equal(JSON.stringify(row).includes(scoped.token),false);
 const cookie=newsroomCookieHeaders(scoped,true)[0];assert.match(cookie,/^__Host-pit_newsroom=/);assert.match(cookie,/HttpOnly; SameSite=Lax/);assert.match(cookie,/; Secure/);assert.ok(!cookie.includes('Domain='));
});
test('full staff ends at twelve hours; Newsroom renews only within seven days',()=>{
 const actor=user(),full=createSession(actor.id),scoped=createNewsroomSession(actor.id),start=getSession(scoped.token,{scope:'newsroom'}).created_at;
 try{Date.now=()=>start+PRIVILEGED_SESSION_TTL_MS+100;assert.equal(getSession(full.token),null);assert.ok(getSession(scoped.token,{scope:'newsroom'}));
 for(let day=1;day<7;day++){Date.now=()=>start+day*86400000;renewNewsroomSession(scoped.token);const row=getSession(scoped.token,{scope:'newsroom'});assert.ok(row);assert.equal(row.created_at,start);assert.ok(row.expires_at<=start+NEWSROOM_SESSION_MAX_MS);}
 Date.now=()=>start+NEWSROOM_SESSION_MAX_MS;assert.equal(renewNewsroomSession(scoped.token),null);
 }finally{Date.now=realNow;}
});
test('idle expiry, absent tokens and explicit deletion cannot renew',()=>{
 const actor=user(),scoped=createNewsroomSession(actor.id);try{Date.now=()=>scoped.expiresAt;assert.equal(renewNewsroomSession(scoped.token),null);}finally{Date.now=realNow;}
 const revoked=createNewsroomSession(actor.id);destroySession(revoked.token);assert.equal(renewNewsroomSession(revoked.token),null);assert.equal(renewNewsroomSession(undefined),null);
});
test('authorization rejects unrelated routes and encoded or unknown extensions',async()=>{
 const actor=user(),scoped=createNewsroomSession(actor.id);
 for(const [method,path] of [['GET','/api/me'],['GET','/api/moderation/news-desk/editor'],['POST','/api/moderation/news-desk/editor/drafts'],['POST','/api/media/assets'],['POST','/api/me/newsroom-session'],['PATCH','/api/newsroom-session/status'],['POST','/api/newsroom-session/media/x/variants'],['GET','/api/newsroom-session/drafts/abcdef%2Fadmin'],['GET','/api/newsroom-session/settings']]) await assert.rejects(context(scoped.token,method,path),e=>e.status===403);
 const ctx=await context(scoped.token);assert.equal(ctx.assertCurrentSession().id,actor.id);const projection=routes['GET /api/newsroom-session/status'](ctx);assert.equal(projection.scope,'self-written-newsroom');assert.equal(projection.account.role,undefined);
});
test('role loss even when restored, password change, ban, suspension, dormancy and lost verification revoke irreversibly',()=>{
 for(const action of [id=>{db.prepare("UPDATE users SET role='fan' WHERE id=?").run(id);db.prepare("UPDATE users SET role='admin' WHERE id=?").run(id);},id=>db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(hashPassword('Synthetic-replacement2'),id),id=>db.prepare('UPDATE users SET is_banned=1 WHERE id=?').run(id),id=>db.prepare('UPDATE users SET suspended_until=? WHERE id=?').run(Date.now()+3600000,id),id=>db.prepare('UPDATE users SET dormant_at=? WHERE id=?').run(Date.now(),id),id=>db.prepare('UPDATE users SET email_verified_at=0 WHERE id=?').run(id)]){
 const actor=user(),s=createNewsroomSession(actor.id);action(actor.id);assert.equal(db.prepare("SELECT * FROM newsroom_browser_sessions WHERE token_hash=?").get(digest(s.token)),undefined);assert.equal(renewNewsroomSession(s.token),null);
 }
});
test('revocation during body buffering and after authorization stops later actions',async()=>{
 const actor=user(),s=createNewsroomSession(actor.id);const ctx=await readAuthorizedRequest({token:s.token,method:'POST',pathname:'/api/newsroom-session/drafts',sessionScope:'newsroom',readBody:async()=>{db.prepare("UPDATE users SET role='fan' WHERE id=?").run(actor.id);return {};}});assert.equal(ctx.user,null);
 const actor2=user(),s2=createNewsroomSession(actor2.id),ctx2=await context(s2.token);destroySession(s2.token);assert.throws(()=>ctx2.assertCurrentSession(),e=>e.status===401);
});
test('enable needs a fresh password and full token; scope token cannot mint another session',async()=>{
 const actor=user(),full=createSession(actor.id);let issued;const good=await context(full.token,'POST','/api/me/newsroom-session',{currentPassword:password},'full',{setNewsroomSession:s=>{issued=s;}});
 assert.equal((await routes['POST /api/me/newsroom-session'](good)).enabled,true);assert.equal(issued.scope,'newsroom');
 const bad=await context(full.token,'POST','/api/me/newsroom-session',{currentPassword:'wrong'},'full',{setNewsroomSession(){assert.fail();}});await assert.rejects(routes['POST /api/me/newsroom-session'](bad),e=>e.status===401);
 const scoped=await context(issued.token);await assert.rejects(routes['POST /api/me/newsroom-session']({...scoped,body:{currentPassword:password},setNewsroomSession(){assert.fail();}}),e=>e.status===401);
});
test('logout-all removes only this actor scoped sessions, preserving unrelated full sessions',async()=>{
 const actor=user(),other=user(),a=createNewsroomSession(actor.id),b=createNewsroomSession(actor.id),c=createNewsroomSession(other.id),full=createSession(actor.id);let cleared=false;
 const ctx=await context(a.token,'POST','/api/newsroom-session/logout-all',{},'newsroom',{clearNewsroomSession(){cleared=true;}});assert.equal(routes['POST /api/newsroom-session/logout-all'](ctx).revoked,2);assert.ok(cleared);assert.equal(getSession(b.token,{scope:'newsroom'}),null);assert.ok(getSession(c.token,{scope:'newsroom'}));assert.ok(getSession(full.token));
});
test('photo adapters reject video, URL, arbitrary purpose, oversize files and foreign assets before storage',async()=>{
 const actor=user(),scoped=createNewsroomSession(actor.id);let calls=0;const isolated=newsroomSessionRoutes({database:db,editor:{},ApiError,requireEditor(){throw Error('unexpected');},verifyPassword:async()=>false,atomicWrite:work=>work(),rateLimit(){},mediaRoutes:()=>new Proxy({},{get(){calls++;throw Error('storage reached');}})});
 for(const input of [{clientAssetId:'photo',contentType:'video/mp4',fileSize:1},{clientAssetId:'photo',contentType:'image/jpeg',fileSize:10*1024*1024+1},{clientAssetId:'photo',contentType:'image/jpeg',fileSize:2,purpose:'avatar'},{clientAssetId:'photo',contentType:'image/jpeg',fileSize:2,url:'https://untrusted.example/object'}]){const ctx=await context(scoped.token,'POST','/api/newsroom-session/media',input);await assert.rejects(isolated['POST /api/newsroom-session/media'](ctx),e=>e.status===400);}
 const ctx=await context(scoped.token,'GET','/api/newsroom-session/media/foreign',{},'newsroom',{params:{id:'foreign'}});assert.throws(()=>isolated['GET /api/newsroom-session/media/:id'](ctx),e=>e.status===404);assert.equal(calls,0);
});
test('password reset revokes every scoped browser before issuing its ordinary replacement',async()=>{
 const actor=user(),a=createNewsroomSession(actor.id),b=createNewsroomSession(actor.id),token='synthetic-reset-'+actor.id;db.prepare('UPDATE users SET reset_hash=?,reset_expires=? WHERE id=?').run(digest(token),Date.now()+60000,actor.id);let replacement;
 await routes['POST /api/reset']({body:{token,password:'New-synthetic-reset3'},ip:'reset-'+actor.id,setSession:s=>{replacement=s;}});assert.equal(getSession(a.token,{scope:'newsroom'}),null);assert.equal(getSession(b.token,{scope:'newsroom'}),null);assert.ok(getSession(replacement.token));
});

test('photo tickets force post purpose and scoped namespace, with a durable twelve-attempt rolling day cap',async()=>{
 const {seedNewsroomPhoto}=await import('./newsroomSessionFixtures.mjs');const actor=user(),scoped=createNewsroomSession(actor.id),photo=seedNewsroomPhoto(db,actor.id,'quota');let captured;
 function atomic(work){db.exec('BEGIN IMMEDIATE');try{const value=work();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}}
 const isolated=newsroomSessionRoutes({database:db,editor:{},ApiError,requireEditor(){},verifyPassword:async()=>false,atomicWrite:atomic,rateLimit(){},mediaRoutes:()=>({'POST /api/media/assets':ctx=>{captured=ctx.body;return {asset:{id:photo.assetId},upload:null};}})});
 for(let i=0;i<12;i++){const ctx=await context(scoped.token,'POST','/api/newsroom-session/media',{clientAssetId:'valid-'+i,contentType:'image/jpeg',fileSize:1000,name:'photo.jpg'});await isolated['POST /api/newsroom-session/media'](ctx);assert.equal(captured.purpose,'post');assert.match(captured.clientAssetId,/^newsroom:[a-f0-9]{16}:valid-/);}
 const excessive=await context(scoped.token,'POST','/api/newsroom-session/media',{clientAssetId:'over-limit',contentType:'image/jpeg',fileSize:1000});await assert.rejects(isolated['POST /api/newsroom-session/media'](excessive),e=>e.status===429);
 const replay=await context(scoped.token,'POST','/api/newsroom-session/media',{clientAssetId:'valid-0',contentType:'image/jpeg',fileSize:1000,name:'photo.jpg'});await isolated['POST /api/newsroom-session/media'](replay);
 assert.equal(db.prepare('SELECT count(*) n FROM newsroom_browser_photo_uses WHERE owner_id=?').get(actor.id).n,12);
});

test('every legacy API route is outside the Newsroom authorization context by default',async()=>{
 const actor=user(),session=createNewsroomSession(actor.id);let checked=0;
 for(const route of Object.keys(routes)){
  const [method,path]=route.split(' ');if(path.startsWith('/api/newsroom-session/'))continue;
  await assert.rejects(context(session.token,method,path),error=>error.status===403,route);checked++;
 }
 assert.ok(checked>200,'the invariant must cover the real route registry');
});

test('feature is disabled by default: no scoped authorization or issuance before explicit activation',async()=>{
 const actor=user(),full=createSession(actor.id),scoped=createNewsroomSession(actor.id);
 delete process.env.NEWSROOM_BROWSER_SESSIONS_ENABLED;
 try {
  assert.equal(getSession(scoped.token,{scope:'newsroom'}),null);
  assert.throws(()=>createNewsroomSession(actor.id),/not enabled/);
  await assert.rejects(routes['POST /api/me/newsroom-session'](await context(full.token,'POST','/api/me/newsroom-session',{currentPassword:password},'full')),e=>e.status===404);
  assert.throws(()=>routes['GET /api/newsroom-session/status']({}),e=>e.status===404);
  assert.ok(getSession(full.token),'full staff sessions keep existing behavior');
 } finally {process.env.NEWSROOM_BROWSER_SESSIONS_ENABLED='true';destroySession(scoped.token);}
});

test('restricted accounts cannot issue remembered access, including dormant accounts',()=>{
 for(const [column,value] of [['is_banned',1],['suspended_until',Date.now()+3600000],['dormant_at',Date.now()],['email_verified_at',0]]){
  const actor=user();db.prepare('UPDATE users SET '+column+'=? WHERE id=?').run(value,actor.id);
  assert.throws(()=>createNewsroomSession(actor.id),/active verified editor/);
 }
});

test('disabled startup purges scoped rows so later re-enabling cannot revive them',()=>{
 const actor=user(),scoped=createNewsroomSession(actor.id),full=createSession(actor.id);
 const env=Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP','LOCALAPPDATA'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
 Object.assign(env,{NODE_ENV:'test',PIT_DATA_DIR:directory,PIT_ALLOW_EMPTY_DB_BOOTSTRAP:'true'});
 const child=spawnSync(process.execPath,['--input-type=module','-e',
  'await import("./server/auth.js");const {db}=await import("./server/db.js");if(db.prepare("SELECT count(*) n FROM newsroom_browser_sessions").get().n!==0)throw Error("Scoped rows retained");db.close();'],
  {cwd:new URL('../../../',import.meta.url),env,encoding:'utf8',windowsHide:true,timeout:15000});
 assert.equal(child.status,0,child.stderr);
 assert.equal(getSession(scoped.token,{scope:'newsroom'}),null);
 assert.ok(getSession(full.token),'disabling Newsroom must preserve the full-session store');
});

test('editor failures use the canonical public API status and code without leaking unknown errors',async()=>{
 const {NewsEditorError}=await import('../newsDesk/newsDeskEditor.js');
 const {seedNewsroomPhoto}=await import('./newsroomSessionFixtures.mjs');
 const actor=user(),session=createNewsroomSession(actor.id),photo=seedNewsroomPhoto(db,actor.id,'error-map');
 for(const [code,status] of [['VALIDATION_FAILED',400],['NOT_FOUND',404],['CONFLICT',409],['ACTION_REQUIRED',422],['RATE_LIMITED',429],['PROVIDER_UNAVAILABLE',502],['UNKNOWN_INTERNAL',500]]) {
  const isolated=newsroomSessionRoutes({database:db,editor:{writeSelfWritten(){throw new NewsEditorError(code,'Synthetic private failure');}},ApiError,requireEditor(){},verifyPassword:async()=>false,atomicWrite:work=>work(),rateLimit(){},mediaRoutes:()=>({})});
  const ctx=await context(session.token,'POST','/api/newsroom-session/drafts',{photo:{assetId:photo.assetId},idempotencyKey:'error-map-'+code});
  await assert.rejects(isolated['POST /api/newsroom-session/drafts'](ctx),error=>error.status===status && error.code===(status===500?'INTERNAL_ERROR':code) && (status!==500 || !error.message.includes('Synthetic private')));
 }
});
