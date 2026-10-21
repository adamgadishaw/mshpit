import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {ApiError,errorEnvelope} from '../server/errors.js';
import {normalizeSelfWrittenStory} from '../server/features/newsDesk/newsDeskService.js';
const html=readFileSync(new URL('../public/newsroom-remembered.html',import.meta.url),'utf8');
const source=readFileSync(new URL('../public/newsroom-remembered.js',import.meta.url),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
let surfaceSequence=0;
function fixture({remembered=true,disabled=false,putFailures=0,finalizeFailures=0,saveFailures=0}={}) {
 return {account:{id:'owner-a',name:'Fixture owner'},remembered,disabled,revoked:false,nextFailure:null,putFailures,finalizeFailures,saveFailures,drafts:new Map(),draftOwners:new Map(),assets:new Map(),saveKeys:new Map()};
}
function surface({initiallyRemembered=false,backend=fixture({remembered:initiallyRemembered}),autoPageShow=true}={}) {
 const instance=++surfaceSequence,requests=[],elements=new Map(),events=new Map(),timers=[];let sequence=0;
 const window={addEventListener(name,fn){const handlers=events.get(name)||[];handlers.push(fn);events.set(name,handlers);}};
 const dispatch=(name,event={})=>{for(const fn of events.get(name)||[])fn(event);};
 const runTasks=()=>{for(const fn of timers.splice(0))fn();};
 function element(id){let value='';return {id,hidden:['enable','work','held-notice','restore-article'].includes(id),get value(){return value;},set value(next){value=next;if(id==='photo'&&next==='')this.files=[];},files:[],required:id==='photo',children:[],listeners:{},disabled:false,textContent:'',addEventListener(name,fn){this.listeners[name]=fn;},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},reset(){for(const item of elements.values())if(!['status','error'].includes(item.id))item.value='';}};}
 for(const match of html.matchAll(/\bid="([^"]+)"/g))elements.set(match[1],element(match[1]));
 const document={getElementById:id=>{assert.ok(elements.has(id),'real page is missing '+id);return elements.get(id);},querySelectorAll:()=>[...elements.values()].filter(item=>['refresh','restore-article','forget','forget-all','save'].includes(item.id)),createElement:tag=>element(tag)};
 const fetch=async(path,options)=>{
  requests.push({path,options});
  const deferred=backend.deferredResponse?.path===path?backend.deferredResponse:null;if(deferred)backend.deferredResponse=null;
  const respond=async(status,data)=>{if(deferred?.stage==='fetch')await deferred.promise;return {ok:status===200,status,json:async()=>{if(deferred?.stage==='json')await deferred.promise;return data;}};};
  let status=200,data;const body=typeof options.body==='string'?JSON.parse(options.body):options.body;
  if(backend.nextFailure?.path===path) {
   const failure=backend.nextFailure;backend.nextFailure=null;if(failure.transport)throw Error(failure.message);status=failure.status;data=errorEnvelope(new ApiError(status,failure.message,failure.code),'synthetic-request');
  }else if(path==='/api/newsroom-session/status') {
   if(backend.disabled){status=404;data=errorEnvelope(new ApiError(404,'Remembered Newsroom is not enabled.','NOT_FOUND'),'synthetic-request');}
   else if(!backend.remembered||backend.revoked){status=401;data=errorEnvelope(new ApiError(401,'Sign in again.','AUTH_REQUIRED'),'synthetic-request');}
   else if(options.headers['X-Pit-Expected-Account'] && options.headers['X-Pit-Expected-Account']!==backend.account.id){status=409;data=errorEnvelope(new ApiError(409,'Your active account changed. Confirm the current account.','IDENTITY_CHANGED'),'synthetic-request');}
   else data={account:backend.account,expiresAt:Date.now()+48*3600000,absoluteExpiresAt:Date.now()+7*86400000};
  }else if(path==='/api/me')data={user:{id:'owner-a',role:'admin'}};
  else if(path==='/api/me/newsroom-session'){backend.remembered=true;data={enabled:true};}
  else if(path==='/api/newsroom-session/media'){
   let asset=backend.assets.get(body.clientAssetId);
   if(!asset){asset={id:'ma_browser_photo_'+(backend.assets.size+1),status:'upload_pending'};backend.assets.set(body.clientAssetId,asset);}
   data={asset:clone(asset),upload:asset.status==='ready'?null:{uploadUrl:'https://upload.example.test/'+asset.id,method:'PUT',requiredHeaders:{'Content-Type':body.contentType}}};
  }else if(path.startsWith('https://upload.example.test/')){
   if(backend.putFailures-->0)return respond(503);
   return respond(200);
  }else if(/^\/api\/newsroom-session\/media\/[^/]+\/finalize$/u.test(path)){
   const id=path.split('/').at(-2),asset=[...backend.assets.values()].find(item=>item.id===id);assert.ok(asset,'finalize needs its minted asset');
   asset.status='ready';if(backend.finalizeFailures-->0)throw Error('Finalize response lost.');data={asset:clone(asset)};
  }else if(path==='/api/newsroom-session/drafts'&&options.method==='POST'){
   let draft=backend.saveKeys.get(body.idempotencyKey);
   if(!draft){
    let normalized;
    try{normalized=normalizeSelfWrittenStory(body,{assetOwnerId:backend.account.id});}
    catch(error){return respond(400,errorEnvelope(new ApiError(400,error.message,'VALIDATION_FAILED'),'synthetic-request'));}
    draft={...normalized,id:'draft_'+(backend.drafts.size+1),status:'draft',revision:1,expired:false,photo:{...normalized.photo,status:'ready',url:'https://media.example.test/'+body.photo.assetId}};backend.drafts.set(draft.id,draft);backend.draftOwners.set(draft.id,backend.account.id);backend.saveKeys.set(body.idempotencyKey,draft);
   }
   if(backend.saveFailures-->0)throw Error('Save response lost.');data={draft:clone(draft)};
  }else if(path==='/api/newsroom-session/drafts')data={drafts:[...backend.drafts.values()].filter(draft=>backend.draftOwners.get(draft.id)===backend.account.id).map(clone)};
  else if(/^\/api\/newsroom-session\/drafts\/[^/]+$/u.test(path)){const draft=backend.drafts.get(path.split('/').at(-1));assert.ok(draft,'only seeded owned drafts are available');assert.equal(backend.draftOwners.get(draft.id),backend.account.id);data={draft:clone(draft)};}
  else if((path==='/api/newsroom-session/logout'||path==='/api/newsroom-session/logout-all')){backend.revoked=true;data={ok:true};}
  else throw Error('Unexpected endpoint '+path);
  return respond(status,data);
 };
 vm.runInNewContext(source,{document,window,setTimeout:fn=>{timers.push(fn);return timers.length;},fetch,AbortSignal,URL,Date,console,crypto:{randomUUID:()=> 'synthetic-test-'+instance+'-'+(++sequence)},localStorage:new Proxy({},{get(){throw Error('Credential web storage forbidden');}})},{filename:'newsroom-remembered.js'});
 if(autoPageShow){dispatch('pageshow',{persisted:false});runTasks();}
 return {requests,backend,dispatch,runTasks,node:id=>elements.get(id),revoke:()=>{backend.revoked=true;}};
}
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
const file=()=>({name:'fixture.jpg',size:1000,type:'image/jpeg',lastModified:1});
function fill(f){for(const [id,value] of Object.entries({headline:'Radiohead announce a new tour',summary:'Radiohead have announced a new tour with confirmed dates.',body:'A factual article.',category:'tour',sources:'Radiohead | https://radiohead.com/news/tour | Official announcement','photo-name':'Fixture photographer','photo-url':'https://example.test/photo-rights','photo-credit':'Synthetic attribution'}))f.node(id).value=value;f.node('photo').files=[file()];}
async function submit(f){f.node('article').listeners.submit({preventDefault(){}});await settle();}
const posts=(f,path)=>f.requests.filter(r=>r.path===path&&r.options.method==='POST');
function button(card,label){const found=card.children.find(item=>item.textContent===label);assert.ok(found,'missing '+label);return found;}
async function reopen(f,index=0){const card=f.node('drafts').children[index];button(card,'Preview saved article').listeners.click();await settle();button(card,'Edit a copy').listeners.click();await settle();}

test('disabled policy stops before offering password enable or recovering an account',async()=>{
 const f=surface({backend:fixture({disabled:true})});await settle();assert.equal(f.node('status').textContent,'Remembered Newsroom is not enabled.');assert.equal(f.node('enable').hidden,true);assert.equal(f.node('work').hidden,true);assert.deepEqual(f.requests.map(r=>r.path),['/api/newsroom-session/status']);
});
test('remembered page never auto-enables a credential; fresh password is sent only on explicit form submission and immediately cleared',async()=>{
 const f=surface();await settle();assert.equal(f.node('enable').hidden,false);assert.equal(f.requests.filter(r=>r.options.method==='POST').length,0);
 f.node('password').value='synthetic-once-password';f.node('enable-form').listeners.submit({preventDefault(){}});await settle();
 const issuance=posts(f,'/api/me/newsroom-session');assert.equal(issuance.length,1);assert.deepEqual(JSON.parse(issuance[0].options.body),{currentPassword:'synthetic-once-password'});assert.equal(issuance[0].options.credentials,'same-origin');assert.equal(f.node('password').value,'');assert.equal(f.node('work').hidden,false);assert.equal(f.requests.some(r=>r.path==='/api/login'),false);
});
test('authoritative expiry or revocation clears the article UI without hidden reauthentication',async()=>{
 const f=surface({initiallyRemembered:true});await settle();assert.equal(f.node('work').hidden,false);f.node('body').value='Private unsaved article';f.node('password').value='must-clear';
 f.revoke();f.node('refresh').listeners.click();await settle();assert.equal(f.node('work').hidden,true);assert.equal(f.node('body').value,'');assert.equal(f.node('password').value,'');assert.equal(f.node('drafts').children.length,0);assert.equal(f.requests.filter(r=>r.options.method==='POST').length,0);
});
test('explicit forget calls revocation and clears local article state',async()=>{
 const f=surface({initiallyRemembered:true});await settle();f.node('body').value='Article';f.node('forget').listeners.click();await settle();assert.equal(f.node('work').hidden,true);assert.equal(f.node('body').value,'');assert.equal(f.requests.at(-1).path,'/api/newsroom-session/logout');
});
test('article form sends typed citations and bound photo provenance without hidden actor or scope fields',async()=>{
 const f=surface({initiallyRemembered:true});await settle();fill(f);await submit(f);
 const saved=posts(f,'/api/newsroom-session/drafts')[0];assert.ok(saved);
 const payload=JSON.parse(saved.options.body);assert.equal(payload.sources[0].kind,'article');assert.equal(payload.photo.assetId,'ma_browser_photo_1');assert.equal(payload.photo.source.credit,'Synthetic attribution');assert.equal('photoSource' in payload,false);assert.equal('actorId' in payload,false);assert.equal('sessionScope' in payload,false);assert.equal(saved.options.headers['X-Pit-Expected-Account'],'owner-a');
 const upload=f.requests.find(r=>r.path.startsWith('https://upload.example.test/'));assert.equal(upload.options.credentials,'omit');
});
test('save, reload and edit a copy restores fields and reuses the owned photo without altering the saved original',async()=>{
 const backend=fixture(),first=surface({backend});await settle();fill(first);await submit(first);const original=clone([...backend.drafts.values()][0]);
 const f=surface({backend});await settle();assert.equal(f.node('body').value,'');await reopen(f);
 assert.equal(f.node('headline').value,original.headline);assert.equal(f.node('summary').value,original.summary);assert.equal(f.node('body').value,original.body);assert.equal(f.node('category').value,original.category);assert.equal(f.node('sources').value,'Radiohead | https://radiohead.com/news/tour | Official announcement');assert.equal(f.node('photo-name').value,original.photo.source.name);assert.equal(f.node('photo-url').value,original.photo.source.url);assert.equal(f.node('photo-credit').value,original.photo.source.credit);assert.equal(f.node('photo').files.length,0);assert.equal(f.node('photo').required,false);assert.match(f.node('editor-status').textContent,/Editing a copy/);
 f.node('body').value='Continued writing after reopening.';await submit(f);assert.equal(f.node('error').textContent,'');assert.equal(backend.drafts.size,2);assert.deepEqual(backend.drafts.get(original.id),original);const copy=JSON.parse(posts(f,'/api/newsroom-session/drafts')[0].options.body);assert.equal(copy.photo.assetId,original.photo.assetId);assert.equal(copy.body,'Continued writing after reopening.');assert.equal(posts(f,'/api/newsroom-session/media').length,0);assert.equal(f.requests.some(r=>r.path.endsWith('/finalize')),false);
});
test('repeated edit-copy saves keep real combined article and photo sources separate without accumulating citations',async()=>{
 for(const photoUrl of ['https://example.test/photo-rights','https://www.radiohead.com/photo-rights']){
  const backend=fixture(),first=surface({backend});await settle();fill(first);first.node('photo-url').value=photoUrl;await submit(first);
  assert.equal(first.node('error').textContent,'');const original=clone([...backend.drafts.values()][0]);
  assert.deepEqual(original.sources.map(item=>item.kind),['article','photo']);
  for(let copyNumber=1;copyNumber<=3;copyNumber++){
   const f=surface({backend});await settle();await reopen(f,backend.drafts.size-1);
   assert.equal(f.node('sources').value,'Radiohead | https://radiohead.com/news/tour | Official announcement');
   assert.equal(f.node('photo-name').value,original.photo.source.name);assert.equal(f.node('photo-url').value,original.photo.source.url);assert.equal(f.node('photo-credit').value,original.photo.source.credit);
   f.node('body').value+=' Continued local copy '+copyNumber+'.';await submit(f);
   assert.equal(f.node('error').textContent,'');assert.equal(backend.drafts.size,copyNumber+1);
   const payload=JSON.parse(posts(f,'/api/newsroom-session/drafts')[0].options.body),saved=[...backend.drafts.values()].at(-1);
   assert.deepEqual(payload.sources,[{kind:'article',name:'Radiohead',url:'https://radiohead.com/news/tour',title:'Official announcement'}]);
   assert.deepEqual(saved.sources.map(item=>item.kind),['article','photo']);assert.equal(saved.sources.length,2);
   assert.equal(saved.photo.assetId,original.photo.assetId);assert.deepEqual(saved.photo.source,original.photo.source);assert.deepEqual(saved.sources[1],original.photo.source);
   assert.equal(posts(f,'/api/newsroom-session/media').length,0);assert.equal(f.requests.some(r=>r.path.endsWith('/finalize')),false);assert.deepEqual(backend.drafts.get(original.id),original);
  }
 }
});

test('selecting a different File with identical metadata replaces the photo and save key',async()=>{
 const f=surface({initiallyRemembered:true});await settle();fill(f);await submit(f);const first=JSON.parse(posts(f,'/api/newsroom-session/drafts')[0].options.body);
 f.node('photo').files=[file()];await submit(f);const second=JSON.parse(posts(f,'/api/newsroom-session/drafts')[1].options.body);assert.notEqual(second.photo.assetId,first.photo.assetId);assert.notEqual(second.idempotencyKey,first.idempotencyKey);assert.equal(f.backend.assets.size,2);
});
test('failed photo PUT retries the same source ticket and saves only after successful transfer',async()=>{
 const f=surface({backend:fixture({putFailures:1})});await settle();fill(f);await submit(f);assert.match(f.node('error').textContent,/photo transfer did not complete/);assert.equal(posts(f,'/api/newsroom-session/drafts').length,0);
 await submit(f);assert.equal(f.node('error').textContent,'');const tickets=posts(f,'/api/newsroom-session/media').map(r=>JSON.parse(r.options.body));assert.equal(tickets.length,2);assert.equal(tickets[0].clientAssetId,tickets[1].clientAssetId);assert.equal(f.backend.assets.size,1);assert.equal(f.backend.drafts.size,1);
});
test('lost finalize response retries the same asset without uploading again',async()=>{
 const f=surface({backend:fixture({finalizeFailures:1})});await settle();fill(f);await submit(f);assert.equal(f.node('error').textContent,'Finalize response lost.');assert.equal(f.backend.drafts.size,0);
 await submit(f);assert.equal(f.node('error').textContent,'');assert.equal(posts(f,'/api/newsroom-session/media').length,1);assert.equal(f.requests.filter(r=>r.path.endsWith('/finalize')).length,2);assert.equal(f.backend.drafts.size,1);
});
test('lost save response retries the stable key and returns the already saved draft',async()=>{
 const f=surface({backend:fixture({saveFailures:1})});await settle();fill(f);await submit(f);assert.equal(f.node('error').textContent,'Save response lost.');assert.equal(f.backend.drafts.size,1);
 await submit(f);assert.equal(f.node('error').textContent,'');const saves=posts(f,'/api/newsroom-session/drafts').map(r=>JSON.parse(r.options.body));assert.equal(saves.length,2);assert.deepEqual(saves[0],saves[1]);assert.equal(f.backend.drafts.size,1);assert.equal(posts(f,'/api/newsroom-session/media').length,1);assert.equal(f.node('drafts').children.length,1);
});

test('real 409 IDENTITY_CHANGED envelope clears old-account UI and restores held text only after explicit same-owner confirmation',async()=>{
 const f=surface({initiallyRemembered:true});await settle();fill(f);f.node('password').value='must-clear';
 f.backend.account={id:'owner-b',name:'Other editor'};f.node('refresh').listeners.click();await settle();
 assert.equal(f.node('work').hidden,true);assert.equal(f.node('body').value,'');assert.equal(f.node('photo').files.length,0);assert.equal(f.node('password').value,'');assert.equal(f.node('drafts').children.length,0);assert.match(f.node('error').textContent,/active account changed/);assert.equal(f.node('restore-article').hidden,true);assert.doesNotMatch(f.node('status').textContent,/Fixture owner/);
 f.node('refresh').listeners.click();await settle();assert.equal(f.node('work').hidden,false);assert.equal(f.node('body').value,'');assert.equal(f.node('restore-article').hidden,true);
 f.node('restore-article').listeners.click();await settle();assert.equal(f.node('body').value,'','even a programmatic restore cannot expose another account text');
 f.backend.account={id:'owner-a',name:'Fixture owner'};f.node('refresh').listeners.click();await settle();f.node('refresh').listeners.click();await settle();
 assert.equal(f.node('body').value,'','same-owner confirmation alone does not restore content');assert.equal(f.node('restore-article').hidden,false);
 f.node('restore-article').listeners.click();await settle();assert.equal(f.node('body').value,'A factual article.');assert.equal(f.node('photo-credit').value,'Synthetic attribution');assert.equal(f.node('photo').files.length,0);assert.equal(f.node('photo').required,true);assert.equal(f.requests.some(r=>r.options.method==='POST'),false);
});

test('real 401 preserves text only in the original-account tab buffer, and explicit logout discards that buffer',async()=>{
 const f=surface({initiallyRemembered:true});await settle();fill(f);f.revoke();f.node('refresh').listeners.click();await settle();
 assert.equal(f.node('work').hidden,true);assert.equal(f.node('body').value,'');assert.equal(f.node('error').textContent,'Sign in again.');
 f.backend.revoked=false;f.node('refresh').listeners.click();await settle();assert.equal(f.node('restore-article').hidden,false);assert.equal(f.node('body').value,'');
 f.node('forget').listeners.click();await settle();assert.equal(f.node('held-notice').hidden,true);
 f.backend.revoked=false;f.node('refresh').listeners.click();await settle();assert.equal(f.node('restore-article').hidden,true);assert.equal(f.node('body').value,'');
});

test('real feature-disabled 404 retires an open editor and preserves its text for its owner without automatic enable',async()=>{
 const f=surface({initiallyRemembered:true});await settle();fill(f);f.backend.disabled=true;f.node('refresh').listeners.click();await settle();
 assert.equal(f.node('work').hidden,true);assert.equal(f.node('body').value,'');assert.equal(f.node('error').textContent,'Remembered Newsroom is not enabled.');assert.equal(f.node('held-notice').hidden,false);assert.equal(f.requests.some(r=>r.options.method==='POST'),false);
});

test('actionable real validation/provider error envelopes retain unsaved text for the still-confirmed account',async()=>{
 for(const [status,code] of [[400,'VALIDATION_FAILED'],[503,'MEDIA_STORAGE_UNAVAILABLE']]){
  const f=surface({initiallyRemembered:true});await settle();fill(f);f.backend.nextFailure={path:'/api/newsroom-session/drafts',status,code,message:'Correct the article source and retry.'};await submit(f);
  assert.equal(f.node('error').textContent,'Correct the article source and retry.');assert.equal(f.node('work').hidden,false);assert.equal(f.node('body').value,'A factual article.');
 }
});

test('identity change during restore confirmation cannot reveal held text to a different account',async()=>{
 const f=surface({initiallyRemembered:true});await settle();fill(f);f.revoke();f.node('refresh').listeners.click();await settle();
 f.backend.revoked=false;f.node('refresh').listeners.click();await settle();assert.equal(f.node('restore-article').hidden,false);
 f.backend.account={id:'owner-b',name:'Other editor'};f.node('restore-article').listeners.click();await settle();
 assert.equal(f.node('work').hidden,true);assert.equal(f.node('body').value,'');assert.equal(f.node('restore-article').hidden,true);assert.match(f.node('error').textContent,/active account changed/);
 f.node('refresh').listeners.click();await settle();assert.equal(f.node('body').value,'');assert.equal(f.node('restore-article').hidden,true);
});

test('real identity failure on article save clears the old editor instead of showing old text under a new cookie',async()=>{
 const f=surface({initiallyRemembered:true});await settle();fill(f);f.backend.nextFailure={path:'/api/newsroom-session/drafts',status:409,code:'IDENTITY_CHANGED',message:'Your active account changed before saving.'};await submit(f);
 assert.equal(f.node('error').textContent,'Your active account changed before saving.');assert.equal(f.node('work').hidden,true);assert.equal(f.node('body').value,'');assert.equal(f.node('photo').files.length,0);assert.equal(f.backend.drafts.size,0);assert.equal(f.node('held-notice').hidden,false);
});

test('explicit Forget always clears local text, File and held buffers even when revocation fails, and preserves the intended account header',async()=>{
 for(const [buttonId,endpoint] of [['forget','logout'],['forget-all','logout-all']])for(const failure of [
  {status:409,code:'IDENTITY_CHANGED',message:'The active account changed.'},
  {status:503,code:'MEDIA_STORAGE_UNAVAILABLE',message:'Revocation temporarily unavailable.'},
  {transport:true,message:'Connection lost before revocation confirmation.'}
 ]){
  const f=surface({initiallyRemembered:true});await settle();fill(f);f.revoke();f.node('refresh').listeners.click();await settle();
  f.backend.revoked=false;f.node('refresh').listeners.click();await settle();assert.equal(f.node('restore-article').hidden,false);
  fill(f);f.node('password').value='must-clear';f.backend.nextFailure={path:'/api/newsroom-session/'+endpoint,...failure};f.node(buttonId).listeners.click();
  assert.equal(f.node('body').value,'','local clearing does not wait for the network');assert.equal(f.node('password').value,'');assert.equal(f.node('photo').files.length,0);
  await settle();assert.equal(f.node('work').hidden,true);assert.equal(f.node('held-notice').hidden,true);assert.equal(f.node('error').textContent,failure.message);assert.match(f.node('status').textContent,/revocation was not confirmed/);assert.equal(f.backend.revoked,false);
  const post=posts(f,'/api/newsroom-session/'+endpoint)[0];assert.equal(post.options.headers['X-Pit-Expected-Account'],'owner-a');
  f.node('refresh').listeners.click();await settle();assert.equal(f.node('restore-article').hidden,true);assert.equal(f.node('body').value,'');
 }
});

const privateFields=['headline','summary','body','sources','photo-name','photo-url','photo-credit'];
function injectHistory(f,value='Account A browser-restored writing'){for(const id of privateFields)f.node(id).value=value;f.node('photo').files=[file()];f.node('password').value='history-password';}
function blankEditor(f){for(const id of privateFields)assert.equal(f.node(id).value,'',id+' must be cleared');assert.equal(f.node('photo').files.length,0);assert.equal(f.node('password').value,'');}
function deferResponse(f,path,stage='json'){let release;const promise=new Promise(resolve=>{release=resolve;});f.backend.deferredResponse={path,stage,promise};return release;}

test('fresh history entry discards unowned form restoration after every pageshow before confirming the current server identity',async()=>{
 for(const persisted of [false,true]){
  const backend=fixture();backend.account={id:'owner-b',name:'Peer B'};const f=surface({backend,autoPageShow:false});
  assert.equal(f.requests.length,0,'startup must wait for history restoration');injectHistory(f);
  f.dispatch('pageshow',{persisted});injectHistory(f);assert.equal(f.node('work').hidden,true);assert.equal(f.requests.length,0);
  f.node('article').listeners.submit({preventDefault(){}});assert.equal(f.requests.length,0,'gated restored form cannot submit');
  f.runTasks();await settle();blankEditor(f);assert.equal(f.node('work').hidden,false);assert.match(f.node('status').textContent,/Peer B/);assert.equal(f.node('restore-article').hidden,true);assert.equal(f.node('held-notice').hidden,true);assert.equal(f.requests.some(r=>r.options.method==='POST'),false);
 }
});

test('history return keeps captured A text private from B and restores it only on explicit same-owner confirmation',async()=>{
 const f=surface({initiallyRemembered:true});await settle();fill(f);f.node('password').value='must-clear';
 f.dispatch('pagehide',{persisted:true});blankEditor(f);assert.equal(f.node('work').hidden,true);assert.equal(f.node('drafts').children.length,0);
 f.backend.account={id:'owner-b',name:'Peer B'};f.dispatch('pageshow',{persisted:true});injectHistory(f,'Foreign native restored text');f.runTasks();await settle();blankEditor(f);assert.match(f.node('status').textContent,/Peer B/);assert.equal(f.node('restore-article').hidden,true);
 f.node('restore-article').listeners.click();await settle();blankEditor(f);
 f.backend.account={id:'owner-a',name:'Fixture owner'};f.node('refresh').listeners.click();await settle();f.node('refresh').listeners.click();await settle();blankEditor(f);assert.equal(f.node('restore-article').hidden,false);
 f.node('restore-article').listeners.click();await settle();assert.equal(f.node('body').value,'A factual article.');assert.equal(f.node('photo-credit').value,'Synthetic attribution');assert.equal(f.node('photo').required,true);assert.equal(f.node('photo').files.length,0);
});

test('same-owner history resume never restores automatically and signed-out or disabled history never reveals captured writing',async()=>{
 for(const outcome of ['same','revoked','disabled']){
  const f=surface({initiallyRemembered:true});await settle();fill(f);f.dispatch('pagehide',{persisted:true});if(outcome==='revoked')f.revoke();if(outcome==='disabled')f.backend.disabled=true;
  f.dispatch('pageshow',{persisted:outcome==='same'});injectHistory(f);f.runTasks();await settle();blankEditor(f);
  if(outcome==='same'){assert.equal(f.node('restore-article').hidden,false);f.node('restore-article').listeners.click();await settle();assert.equal(f.node('body').value,'A factual article.');}
  else{assert.equal(f.node('work').hidden,true);assert.equal(f.node('restore-article').hidden,true);assert.equal(f.requests.some(r=>r.options.method==='POST'),false);}
 }
});

test('stale edit-copy fetch and JSON responses cannot refill B after pagehide and history resume',async()=>{
 for(const stage of ['fetch','json']){
  const f=surface({initiallyRemembered:true});await settle();fill(f);await submit(f);const draft=[...f.backend.drafts.values()][0],card=f.node('drafts').children[0];button(card,'Preview saved article').listeners.click();await settle();
  const release=deferResponse(f,'/api/newsroom-session/drafts/'+draft.id,stage);button(card,'Edit a copy').listeners.click();await settle();
  f.dispatch('pagehide',{persisted:true});f.backend.account={id:'owner-b',name:'Peer B'};f.dispatch('pageshow',{persisted:true});injectHistory(f);f.runTasks();await settle();blankEditor(f);assert.equal(f.node('drafts').children.length,0);
  release();await settle();blankEditor(f);assert.equal(f.node('error').textContent,'');assert.match(f.node('status').textContent,/Peer B/);assert.equal(f.node('work').hidden,false);assert.equal(f.node('restore-article').hidden,true);
 }
});

test('old auth-error JSON and finally cannot retire B or unlock its new pending history confirmation',async()=>{
 const f=surface({initiallyRemembered:true});await settle();fill(f);f.backend.nextFailure={path:'/api/newsroom-session/status',status:401,code:'AUTH_REQUIRED',message:'Old A expired.'};
 const releaseOld=deferResponse(f,'/api/newsroom-session/status');f.node('refresh').listeners.click();await settle();f.dispatch('pagehide',{persisted:true});
 f.backend.account={id:'owner-b',name:'Peer B'};const releaseNew=deferResponse(f,'/api/newsroom-session/drafts','fetch');f.dispatch('pageshow',{persisted:false});f.runTasks();await settle();assert.equal(f.node('refresh').disabled,true);
 releaseOld();await settle();assert.equal(f.node('refresh').disabled,true,'stale finally must not release new busy state');assert.equal(f.node('error').textContent,'');assert.match(f.node('status').textContent,/Peer B/);blankEditor(f);
 releaseNew();await settle();assert.equal(f.node('refresh').disabled,false);assert.equal(f.node('work').hidden,false);assert.equal(f.node('error').textContent,'');
});

test('photo PUT completion from a departed page cannot finalize or save into the resumed page',async()=>{
 const f=surface({initiallyRemembered:true});await settle();fill(f);const release=deferResponse(f,'https://upload.example.test/ma_browser_photo_1','fetch');
 f.node('article').listeners.submit({preventDefault(){}});await settle();assert.equal(f.requests.some(r=>r.path.startsWith('https://upload.example.test/')),true);
 f.dispatch('pagehide',{persisted:true});f.backend.account={id:'owner-b',name:'Peer B'};f.dispatch('pageshow',{persisted:true});f.runTasks();await settle();release();await settle();blankEditor(f);
 assert.equal(f.requests.some(r=>r.path.endsWith('/finalize')),false);assert.equal(posts(f,'/api/newsroom-session/drafts').length,0);assert.equal(f.node('error').textContent,'');assert.match(f.node('status').textContent,/Peer B/);
});

test('departed startup cannot offer its full-account fallback while the resumed page awaits B identity',async()=>{
 const f=surface({initiallyRemembered:true,autoPageShow:false}),releaseOld=deferResponse(f,'/api/newsroom-session/status');f.dispatch('pageshow',{persisted:false});f.runTasks();await settle();
 f.dispatch('pagehide',{persisted:true});f.backend.account={id:'owner-b',name:'Peer B'};const releaseNew=deferResponse(f,'/api/newsroom-session/status');f.dispatch('pageshow',{persisted:true});f.runTasks();await settle();
 releaseOld();await settle();assert.equal(f.requests.filter(r=>r.path==='/api/me').length,0);assert.equal(f.node('enable').hidden,true);assert.equal(f.node('work').hidden,true);assert.equal(f.node('refresh').disabled,true);
 releaseNew();await settle();assert.match(f.node('status').textContent,/Peer B/);assert.equal(f.node('work').hidden,false);assert.equal(f.node('error').textContent,'');
});

test('departed failed Forget cannot overwrite the new confirmed identity or its error state',async()=>{
 for(const [id,endpoint] of [['forget','logout'],['forget-all','logout-all']]){
  const f=surface({initiallyRemembered:true});await settle();fill(f);f.backend.nextFailure={path:'/api/newsroom-session/'+endpoint,status:503,code:'MEDIA_STORAGE_UNAVAILABLE',message:'Old logout unavailable.'};
  const release=deferResponse(f,'/api/newsroom-session/'+endpoint);f.node(id).listeners.click();await settle();f.dispatch('pagehide',{persisted:true});f.backend.account={id:'owner-b',name:'Peer B'};
  f.dispatch('pageshow',{persisted:true});f.runTasks();await settle();release();await settle();assert.match(f.node('status').textContent,/Peer B/);assert.equal(f.node('work').hidden,false);assert.equal(f.node('error').textContent,'');blankEditor(f);
 }
});
