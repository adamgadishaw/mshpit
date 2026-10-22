// Disposable browser fixture only. Never imported by application runtime code.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {basename,dirname,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import dgram from 'node:dgram';
import {assertFixtureStartupPolicy} from './newsroom-fixture-startup-policy.mjs';
import {installFixtureTimerIsolation} from './newsroom-fixture-timer-isolation.mjs';
import {image,MARKER} from './newsroom-supported-https-shared.mjs';
assertFixtureStartupPolicy(process.env);
const candidateRoot=fileURLToPath(new URL('../../',import.meta.url));
const timerIsolation=installFixtureTimerIsolation({candidateRoot,scratchRoot:import.meta.dirname});
import {tmpdir} from 'node:os';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import {syncBuiltinESMExports} from 'node:module';

const directory=resolve(process.env.PIT_DATA_DIR || '.');
assert.equal(process.env.PIT_SUPPORTED_HTTPS_FIXTURE,'1');
assert.equal(process.env.NODE_ENV,'production');
assert.equal(dirname(directory),resolve(tmpdir()));
assert.ok(basename(directory).startsWith('pit-newsroom-https-browser-'));
assert.equal(typeof process.send,'function');
const origin=new URL(process.env.PUBLIC_ORIGIN).origin;
assert.equal(new URL(origin).hostname,'127.0.0.1');
assert.equal(new URL(origin).protocol,'https:');
const objects=new Map();let offset=0,outboundBlocked=0;
const realNow=Date.now;Date.now=()=>realNow()+offset;
const denied=()=>{outboundBlocked++;throw Error('Fixture external network disabled');};
function objectResponse(url,options={}) {
  const target=new URL(url);
  assert.equal(target.origin,origin);
  assert.ok(target.pathname.startsWith('/fixture-storage/'));
  const method=String(options.method || 'GET').toUpperCase();
  const signed=target.searchParams.has('X-Amz-Signature');
  if(!signed)return new Response(null,{status:403});
  const headers=new Headers(options.headers),key=target.pathname;
  if(method==='PUT') {
    if(objects.has(key) && headers.get('if-none-match')==='*')return new Response(null,{status:412});
    const bytes=Buffer.from(options.body || []);
    assert.ok(bytes.length>0 && bytes.length<=12*1024*1024);
    const entry={bytes,type:headers.get('content-type') || 'image/png',etag:'"'+createHash('sha256').update(bytes).digest('hex')+'"'};
    objects.set(key,entry);return new Response(null,{status:200,headers:{etag:entry.etag}});
  }
  const entry=objects.get(key);if(!entry)return new Response(null,{status:404});
  if(headers.has('if-match') && headers.get('if-match')!==entry.etag)return new Response(null,{status:412});
  if(!['HEAD','GET'].includes(method))return new Response(null,{status:405});
  return new Response(method==='HEAD'?null:entry.bytes,{status:200,headers:{'content-type':entry.type,'content-length':String(entry.bytes.length),etag:entry.etag}});
}
globalThis.fetch=async(url,options)=>new URL(url).origin===origin && new URL(url).pathname.startsWith('/fixture-storage/')?objectResponse(url,options):denied();
http.request=denied;http.get=denied;https.request=denied;https.get=denied;
net.connect=denied;net.createConnection=denied;tls.connect=denied;net.Socket.prototype.connect=denied;dgram.createSocket=denied;
const listen=net.Server.prototype.listen;
net.Server.prototype.listen=function(port) {
  assert.equal(arguments.length,1);assert.equal(port,Number(process.env.PORT));
  this.once('listening',()=>process.send({kind:'listener-bound',address:this.address().address}));
  return listen.call(this,{port,host:'127.0.0.1'});
};
syncBuiltinESMExports();

const {db,q}=await import('../../server/db.js');
const {hashPassword,sessionCookieName,NEWSROOM_SESSION_IDLE_MS,NEWSROOM_SESSION_MAX_MS}=await import('../../server/auth.js');
const {reconcileAdminAccount}=await import('../../server/adminBootstrap.js');
reconcileAdminAccount({database:db,queries:q,env:process.env,production:true,log:{info(){},warn(){}}});
await import('../../server/api.js');
const password=randomBytes(32).toString('base64url'),users={};
for(const [name,role] of [['owner','admin'],['peer','editor'],['publisher','moderator']]) {
  const id='https_newsroom_'+name,email=id+'@example.test';
  q.insertUser.run(id,email,'Fixture '+name,id,hashPassword(password),role,'Toronto',null,null,'HN','#123456',Date.now());
  db.prepare("UPDATE users SET email_verified_at=?,age_band='18_plus',onboarding_version=1 WHERE id=?").run(Date.now(),id);
  users[name]={id,email,name:'Fixture '+name};
}
process.on('message',async message=>{
  try {
    let result;
    if(message.operation==='advance'){offset=Number(message.hours)*3600000;result=true;}
    else if(message.operation==='role'){assert.ok(['fan','admin'].includes(message.role));db.prepare('UPDATE users SET role=? WHERE id=?').run(message.role,users.owner.id);result=true;}
    else if(message.operation==='storage-put') {
      const response=objectResponse(message.url,{method:'PUT',headers:message.headers,body:Buffer.from(message.bytes,'base64')});
      result={status:response.status,headers:Object.fromEntries(response.headers)};
    } else if(message.operation==='storage-get') {
      assert.ok(message.path.startsWith('/fixture-media/'));
      const entry=objects.get('/fixture-storage/pit-browser-public/'+message.path.slice('/fixture-media/'.length));
      result=entry?{status:200,type:entry.type,bytes:entry.bytes.toString('base64')}:{status:404};
    } else if(message.operation==='image-proof') {
      const row=db.prepare("SELECT a.source_key,a.source_storage_scope,v.object_key,v.verification_origin FROM media_assets a JOIN media_variants v ON v.id=a.render_variant_id WHERE a.owner_id=? AND a.status='ready'").get(users.owner.id);
      assert.ok(row);assert.notEqual(row.source_key,row.object_key);assert.equal(row.source_storage_scope,'private');assert.equal(row.verification_origin,'private_derivative_v1');
      const entry=objects.get('/fixture-storage/pit-browser-public/'+row.object_key);assert.ok(entry);
      const sharp=createRequire(import.meta.url)('sharp'),expected=image();
      const metadata=await sharp(entry.bytes).metadata(),decoded=await sharp(entry.bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      assert.equal(metadata.width,1200);assert.equal(metadata.height,900);assert.ok(!metadata.exif&&!metadata.xmp&&!metadata.iptc&&!metadata.icc);assert.equal(entry.bytes.includes(Buffer.from(MARKER)),false);
      for(const p of expected.manifest.samples){const at=(p.y*decoded.info.width+p.x)*decoded.info.channels;assert.deepEqual([...decoded.data.subarray(at,at+4)],p.rgba);}
      result={dimensions:[1200,900],pixelSamplesMatched:4,metadataRemoved:true,sourcePrivate:true,derivativeDistinct:true};
    } else if(message.operation==='gif-proof') {
      const rows=db.prepare("SELECT a.id,a.source_key,a.source_storage_scope,v.object_key,v.verification_origin FROM media_assets a JOIN media_variants v ON v.id=a.render_variant_id WHERE a.owner_id=? AND a.status='ready'").all(users.owner.id);
      const row=rows.find(r=>objects.get('/fixture-storage/pit-browser-private/'+r.source_key)?.type==='image/gif');
      assert.ok(row);assert.equal(row.source_storage_scope,'private');assert.equal(row.verification_origin,'private_derivative_v1');assert.notEqual(row.source_key,row.object_key);
      const entry=objects.get('/fixture-storage/pit-browser-public/'+row.object_key);assert.equal(entry.type,'image/webp');
      const sharp=createRequire(import.meta.url)('sharp'),metadata=await sharp(entry.bytes,{animated:true}).metadata();
      assert.equal(metadata.width,1);assert.equal(metadata.pageHeight,1);assert.equal(metadata.pages,2);assert.deepEqual(metadata.delay,[400,400]);assert.equal(metadata.loop,0);
      assert.ok(!metadata.exif&&!metadata.xmp&&!metadata.iptc&&!metadata.icc);
      result={assetId:row.id,url:origin+'/fixture-media/'+row.object_key,frames:2,delay:metadata.delay,loop:0,metadataRemoved:true,sourcePrivate:true};
    } else if(message.operation==='gif-document') {
      const row=db.prepare("SELECT story_post_id FROM news_drafts WHERE json_extract(result,'$.headline')=? AND created_by=? AND status='published'").get(message.headline,users.owner.id);assert.ok(row);
      const {createNewsDeskReader}=await import('../../server/features/newsDesk/newsDeskService.js');
      const {newsStoryPostDocument}=await import('../../server/features/seo/publicDocumentProjection.js');
      const {renderPublicDocumentMain,renderPublicDocumentHead}=await import('../../server/features/seo/publicDocumentRenderer.js');
      const story=createNewsDeskReader(db).forPost(row.story_post_id);assert.ok(story);
      const doc=newsStoryPostDocument({story,card:{comments:0},comments:[],path:'/post/'+row.story_post_id,origin,paths:{}});
      assert.equal(doc.imageMimeType,'image/webp');
      result='<!doctype html><html><head>'+renderPublicDocumentHead(doc)+'</head><body>'+renderPublicDocumentMain(doc)+'</body></html>';
    } else if(message.operation==='teardown'){db.prepare('DELETE FROM newsroom_browser_sessions').run();db.prepare('DELETE FROM sessions').run();objects.clear();result={scoped:0,full:0,objects:0};}
    else if(message.operation==='snapshot') result={
      scoped:db.prepare('SELECT count(*) n FROM newsroom_browser_sessions').get().n,
      drafts:db.prepare('SELECT count(*) n FROM news_drafts').get().n,
      published:db.prepare("SELECT count(*) n FROM news_drafts WHERE status='published'").get().n,
      paid:db.prepare('SELECT count(*) n FROM news_desk_receipts').get().n,
      readyPhotos:db.prepare("SELECT count(*) n FROM media_assets WHERE status='ready'").get().n,
      objects:objects.size,outboundBlocked,timerIsolation:timerIsolation.snapshot(),
    };
    else throw Error('Unknown fixture operation');
    process.send({kind:'reply',id:message.id,result});
  } catch(error){process.send({kind:'reply',id:message.id,error:error.message});}
});
process.send({kind:'fixture',users,password,cookieName:sessionCookieName(true),policy:{idleMs:NEWSROOM_SESSION_IDLE_MS,maxMs:NEWSROOM_SESSION_MAX_MS}});
