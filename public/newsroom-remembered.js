// No web storage, credentials cache, service worker or hidden login recovery.
'use strict';
const node = id => document.getElementById(id);
let account = null, fullAccount = null, busy = false, saveKey = null, savedFingerprint = null, photoTicket = null, generation = 0, pageCycle = 0, pageReady = false;
const expiryText = value => new Date(value).toLocaleString();
const articleFields=['headline','summary','body','category','sources','photo-name','photo-url','photo-credit'];
// Article text only, isolated by the last confirmed owner and erased with this tab.
// No credentials, File objects or automatic account recovery enter this buffer.
const heldArticles=new Map();
function heldArticleNotice() {
  node('held-notice').hidden=heldArticles.size===0;
  node('held-notice').textContent=heldArticles.size?'Unsaved text is held only in this tab for its original account. Sign in and enable Newsroom in another tab, then confirm here and choose Restore unsaved text. Closing or reloading this tab discards held text. Select the photo again before saving.':'';
  node('restore-article').hidden=!account || !heldArticles.has(account.id);
}
function retire({preserveArticle=false,preserveHeld=false}={}) {
  if(preserveArticle && account && articleFields.some(id=>id!=='category' && node(id).value.trim())) {
    heldArticles.set(account.id,Object.fromEntries(articleFields.map(id=>[id,node(id).value])));
  } else if(!preserveArticle && !preserveHeld) heldArticles.clear();
  generation++; account=null;fullAccount=null;node('enable').hidden=true;node('work').hidden=true;node('work').inert=true;node('drafts').replaceChildren();node('article').reset();
  node('password').value='';saveKey=null;savedFingerprint=null;photoTicket=null;
  node('photo').required=true;node('photo-status').textContent='Choose an article photo.';node('editor-status').textContent='';
  node('status').textContent='Confirm this browser session before continuing.';heldArticleNotice();
}
function assertPage(cycle) {
  if(!pageReady || cycle!==pageCycle)throw new Error('This page changed. Confirm its session again.');
}
async function request(path,{method='GET',body,identity=account?.id,signal}={}) {
  const cycle=pageCycle;assertPage(cycle);
  const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',redirect:'error',signal:signal || AbortSignal.timeout(120000),
    headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(identity?{'X-Pit-Expected-Account':identity}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  assertPage(cycle);const result=await response.json();assertPage(cycle);
  if(!response.ok) {
    const code=typeof result?.code==='string'?result.code:undefined;
    const newsroomRequest=path.startsWith('/api/newsroom-session/') || path==='/api/me/newsroom-session';
    if(newsroomRequest && ([401,403].includes(response.status) || code==='IDENTITY_CHANGED'
      || (path==='/api/newsroom-session/status' && response.status===404))) retire({preserveArticle:true});
    const error=new Error(typeof result?.error==='string'?result.error:'The Newsroom request did not complete.');
    error.status=response.status;error.code=code;throw error;
  }
  return result;
}
async function act(work) {
  if(busy || !pageReady)return;const cycle=pageCycle;busy=true;node('error').textContent='';document.querySelectorAll('button').forEach(b=>{b.disabled=true;});
  try{await work();}catch(error){if(cycle===pageCycle && pageReady)node('error').textContent=error.message || 'Try again after confirming your session.';}
  finally{if(cycle===pageCycle){busy=false;node('password').value='';document.querySelectorAll('button').forEach(b=>{b.disabled=false;});}}
}
async function confirm() {
  const before=generation;
  const result=await request('/api/newsroom-session/status',{identity:undefined});
  if(before!==generation)throw new Error('The session changed. Confirm it again.');
  if(account && account.id!==result.account.id)retire({preserveArticle:true});
  account=result.account;node('work').inert=false;node('work').hidden=false;node('enable').hidden=true;heldArticleNotice();
  node('status').textContent=`Newsroom only � ${account.name} � current expiry ${expiryText(result.expiresAt)} � sign in again by ${expiryText(result.absoluteExpiresAt)}`;
}
function text(tag,value){const item=document.createElement(tag);item.textContent=value;return item;}
function editCopy(draft) {
  if(draft.status!=='draft')throw new Error('Only a saved draft can be reopened for a copy.');
  for(const id of ['headline','summary','body','category'])node(id).value=draft[id] || '';
  node('sources').value=(draft.sources || []).filter(source=>source.kind==='article').map(source=>[source.name,source.url,source.title || ''].join(' | ')).join('\n');
  for(const [id,key] of [['photo-name','name'],['photo-url','url'],['photo-credit','credit']])node(id).value=draft.photo?.source?.[key] || '';
  node('photo').value='';
  photoTicket=draft.photo?.assetId && draft.photo.status==='ready' ? {assetId:draft.photo.assetId} : null;
  node('photo').required=!photoTicket;
  node('photo-status').textContent=photoTicket?'Reusing this saved draft\'s photo. Choose another file to replace it.':'Choose an article photo.';
  node('editor-status').textContent='Editing a copy of "'+draft.headline+'". Saving creates another draft; the saved original stays unchanged.';
  saveKey=null;savedFingerprint=null;
}
async function refresh() {
  await confirm();
  const before=generation, result=await request('/api/newsroom-session/drafts');
  if(before!==generation)return;
  node('drafts').replaceChildren();
  for(const draft of result.drafts) {
    const card=document.createElement('article');card.append(text('h3',draft.headline),text('p',`${draft.status}${draft.expired?' � expired':''}`));
    const preview=document.createElement('button');preview.type='button';preview.textContent='Preview saved article';
    preview.addEventListener('click',()=>act(async()=>{
      await confirm();const selected=await request('/api/newsroom-session/drafts/'+encodeURIComponent(draft.id));
      const d=selected.draft;card.replaceChildren(text('h3',d.headline),text('p',d.summary),text('p',d.body));
      if(d.photo?.url){const image=document.createElement('img');image.src=d.photo.url;image.alt=d.photo.source?.credit || 'Article photo';card.append(image);}
      for(const source of d.sources || []){const link=document.createElement('a');link.href=source.url;link.textContent=source.name;link.rel='noopener noreferrer';link.target='_blank';card.append(link,document.createElement('br'));}
      if(d.status==='draft'){const reopen=document.createElement('button');reopen.type='button';reopen.textContent='Edit a copy';reopen.addEventListener('click',()=>act(async()=>{
        await confirm();const current=await request('/api/newsroom-session/drafts/'+encodeURIComponent(d.id));editCopy(current.draft);
      }));card.append(reopen);
      if(!d.expired){const publish=document.createElement('button');publish.type='button';publish.textContent='Publish this article';publish.addEventListener('click',()=>act(async()=>{
        await confirm();await request('/api/newsroom-session/drafts/'+encodeURIComponent(d.id)+'/publish',{method:'POST',body:{expectedRevision:d.revision}});await refresh();
      }));card.append(publish);}}
    }));card.append(preview);node('drafts').append(card);
  }
}
node('refresh').addEventListener('click',()=>act(refresh));
node('restore-article').addEventListener('click',()=>act(async()=>{
  await confirm();const held=heldArticles.get(account.id);if(!held)return;
  for(const id of articleFields)node(id).value=held[id];
  node('photo').value='';photoTicket=null;saveKey=null;savedFingerprint=null;node('photo').required=true;
  heldArticles.delete(account.id);heldArticleNotice();
  node('photo-status').textContent='Select the article photo again before saving.';
  node('editor-status').textContent='Unsaved text restored for this confirmed account. It has not been saved to the server.';
}));
for(const [id,path] of [['forget','logout'],['forget-all','logout-all']])node(id).addEventListener('click',()=>act(async()=>{
  const identity=account?.id,cycle=pageCycle;retire();
  node('status').textContent='Local writing cleared. Confirming server revocation.';
  try {
    await request('/api/newsroom-session/'+path,{method:'POST',body:{},identity});
    node('status').textContent='Remembered Newsroom access removed. Sign in again to enable it.';
  } catch(error) {
    assertPage(cycle);node('status').textContent='Local writing cleared. Server revocation was not confirmed; sign in and retry Forget all if needed.';
    throw error;
  }
}));
node('enable-form').addEventListener('submit',event=>{event.preventDefault();void act(async()=>{
  await request('/api/me/newsroom-session',{method:'POST',identity:fullAccount?.id,body:{currentPassword:node('password').value}});await refresh();
});});
node('photo').addEventListener('change',()=>{
  photoTicket=null;saveKey=null;savedFingerprint=null;node('photo').required=true;
  node('photo-status').textContent=node('photo').files[0]?'The selected photo will be verified when you save.':'Choose an article photo.';
});
node('article').addEventListener('submit',event=>{event.preventDefault();void act(async()=>{
  await confirm();const before=generation,cycle=pageCycle,file=node('photo').files[0];
  if(file && !['image/jpeg','image/png','image/webp','image/gif'].includes(file.type))throw new Error('Photo selection: choose a JPEG, PNG, WebP or GIF. The browser reported type '+(file.type || '(empty)')+'.');
  if(file && (!Number.isSafeInteger(file.size)||file.size<1||file.size>10*1024*1024))throw new Error('Photo selection: choose a nonempty image of at most 10 MiB. The browser reported '+file.size+' bytes.');
  if(file && photoTicket?.file!==file){photoTicket={file,clientAssetId:'photo-'+crypto.randomUUID()};saveKey=null;savedFingerprint=null;}
    if(!photoTicket)throw new Error('Photo selection: choose an article photo before saving.');
  const values={headline:node('headline').value,summary:node('summary').value,body:node('body').value,category:node('category').value,
    sources:node('sources').value.split('\n').filter(v=>v.trim()).map(line=>{const [name,url,title]=line.split('|').map(v=>v.trim());return {kind:"article",name,url,...(title?{title}:{})};}),
    photoSource:{name:node('photo-name').value,url:node('photo-url').value,credit:node('photo-credit').value}};
  const fingerprint=JSON.stringify([values,photoTicket.clientAssetId || photoTicket.assetId]);
  if(fingerprint!==savedFingerprint){saveKey='browser-'+crypto.randomUUID();savedFingerprint=fingerprint;}
  if(!photoTicket.assetId){const ticket=await request('/api/newsroom-session/media',{method:'POST',body:{clientAssetId:photoTicket.clientAssetId,contentType:file.type,fileSize:file.size,name:file.name}});
    if(ticket.upload){const target=new URL(ticket.upload.uploadUrl);if(target.protocol!=='https:' || (ticket.upload.method||'PUT')!=='PUT')throw new Error('The upload ticket was invalid.');
      const uploaded=await fetch(target.href,{method:'PUT',credentials:'omit',redirect:'error',headers:ticket.upload.requiredHeaders,body:file,signal:AbortSignal.timeout(120000)});
      assertPage(cycle);if(!uploaded.ok)throw new Error('The photo transfer did not complete. Retry the same photo.');}
    photoTicket.assetId=ticket.asset.id;
  }
  if(photoTicket.file){const finalized=await request('/api/newsroom-session/media/'+encodeURIComponent(photoTicket.assetId)+'/finalize',{method:'POST',body:{orientation:0,altText:values.headline}});
    if(finalized.asset?.status!=='ready')throw new Error('The article photo is not ready. Try again.');}
  if(before!==generation)throw new Error('The session changed before saving.');
  await request('/api/newsroom-session/drafts',{method:'POST',body:{...values,photoSource:undefined,photo:{assetId:photoTicket.assetId,source:values.photoSource},idempotencyKey:saveKey}});await refresh();
});});
async function enterPage() {
  const cycle=pageCycle;
  try{await refresh();return;}catch(error){assertPage(cycle);if(error.status===404){node('status').textContent=error.message;return;}if(!node('work').hidden)throw error;}
  const full=await request('/api/me',{identity:undefined});fullAccount=full.user;
  if(fullAccount && ['admin','editor'].includes(fullAccount.role)){node('enable').hidden=false;node('status').textContent='No remembered Newsroom session. Confirm your password to enable this browser.';}
  else node('status').textContent='Sign in with a verified admin or editor account to enable remembered Newsroom access.';
}
function pausePage(preserveArticle=false) {
  pageReady=false;pageCycle++;busy=false;
  retire({preserveArticle,preserveHeld:true});node('error').textContent='';
  document.querySelectorAll('button').forEach(button=>{button.disabled=true;});
}
window.addEventListener('pagehide',()=>pausePage(true));
window.addEventListener('pageshow',()=>{
  pausePage();const cycle=pageCycle;
  // Native history form restoration can follow pageshow, even without BFCache.
  // Never assign those unbound values to the newly authenticated account.
  setTimeout(()=>{
    if(cycle!==pageCycle)return;
    retire({preserveHeld:true});pageReady=true;void act(enterPage);
  },0);
});
