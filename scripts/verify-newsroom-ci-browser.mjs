// Linux hosted-CI only. Actual candidate server + trusted loopback HTTPS + Playwright.
// Trust one ephemeral self-signed leaf in a newly created runner NSS DB. No bypass.
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {fork,execFileSync} from 'node:child_process';
import {createServer as httpsServer,Agent,request as tlsRequest} from 'node:https';
import {request as httpRequest} from 'node:http';
import {createServer as netServer} from 'node:net';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {fixtureStartupEnvironment} from './fixtures/newsroom-fixture-startup-policy.mjs';
import {image,animatedImage,publicRoute} from './fixtures/newsroom-supported-https-shared.mjs';
assert.equal(process.platform,'linux','Use the reviewed disposable Linux CI runner, not the owner computer');
assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
assert.equal(process.env.PIT_ALLOW_EPHEMERAL_TEST_TRUST,'1','Explicit CI test-trust permission required');
const root=resolve(import.meta.dirname,'..');
const nss=join(homedir(),'.local/share/pki/nssdb'),legacyNss=join(homedir(),'.pki/nssdb');
assert.equal(existsSync(nss),false,'Refuse any preexisting runner certificate database');assert.equal(existsSync(legacyNss),false);
const directory=mkdtempSync(join(tmpdir(),'pit-newsroom-https-browser-'));
const profile=join(directory,'profile'),photoPath=join(directory,'synthetic.png'),key=join(directory,'leaf.key'),cert=join(directory,'leaf.crt');
const gifPath=join(directory,'synthetic.gif'),gifHeadline='Muse announce a fictional animated release';
const result={startedAt:new Date().toISOString(),checks:[],syntheticOnly:true,production:false,trust:'single ephemeral leaf; disposable runner NSS DB',policy:'Owner-approved 30-day absolute and 7-day inactivity; refreshed on each confirmation without moving original maximum'};
let child,context,server,fixture,bound,origin,nssCreated=false,clockHours=0,sequence=0,serverOutput='',failedLogout=false,shortenScopeCookies=false,proxyFailures=0,externalBrowserRequests=0,cleanupPromise;
const runtimeSecrets=Array.from({length:3},()=>randomBytes(32).toString('base64url'));
const pending=new Map(),checks=result.checks;
const timeout=setTimeout(()=>{console.error('Bounded Newsroom CI deadline exceeded');void cleanup().finally(()=>process.exit(1));},8*60_000);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(work,label){const end=Date.now()+20000;while(!await work()){assert.ok(Date.now()<end,label);await delay(30);}}
async function port(){const s=netServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
function ipc(operation,extra={}){return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Fixture IPC timeout: '+operation));},15000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});child.send({id,operation,...extra});});}
async function launch(){context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,chromiumSandbox:true,timeout:20000,ignoreDefaultArgs:['--disable-back-forward-cache','--disable-client-side-phishing-detection','--disable-ipc-flooding-protection','--unsafely-disable-devtools-self-xss-warnings','--enable-unsafe-swiftshader']});await restrict(context);return context.newPage();}
async function restrict(ctx){ctx.setDefaultTimeout(15000);await ctx.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();externalBrowserRequests++;return route.abort();});}
async function ready(p){await wait(()=>p.evaluate(()=>!!document.querySelector('#refresh')&&!document.querySelector('#refresh').disabled&&document.readyState==='complete'),'Newsroom UI did not settle');}
async function nav(p){await p.goto(origin+'/newsroom-remembered.html');await ready(p);}
async function click(p,id){await p.locator('#'+id).click();await ready(p);}
async function hidden(p){return p.locator('#work').evaluate(el=>el.hidden);}
async function api(p,path,body){return p.evaluate(async({path,body})=>{const r=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,data:await r.json()};},{path,body});}
async function login(p,user){clockHours+=2;await ipc('advance',{hours:clockHours});const r=await api(p,'/api/login',{email:user.email,password:fixture.password});assert.equal(r.status,200);}
async function enable(p){await nav(p);await p.locator('#password').fill(fixture.password);await p.getByRole('button',{name:'Enable Newsroom-only remembering',exact:true}).click();await ready(p);assert.equal(await hidden(p),false);assert.equal(await p.locator('#password').inputValue(),'');}
async function check(name,fn){result.activeCheck=name;await fn();checks.push(name);delete result.activeCheck;console.log(JSON.stringify({check:name,pass:true}));}
async function visibleAnimation(imageElement) {
  await wait(()=>imageElement.evaluate(el=>el.complete&&el.naturalWidth===1&&el.naturalHeight===1),'GIF derivative did not render');
  const frames=new Set();
  for(let i=0;i<10;i++){
    frames.add(createHash('sha256').update(await imageElement.screenshot({animations:'allow'})).digest('hex'));
    await delay(130);
  }
  assert.ok(frames.size>=2,'Rendered GIF derivative must visibly change frames, not just declare multiple pages');
  return frames.size;
}
function leaf(prefix){execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',prefix+'.key','-out',prefix+'.crt','-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost','-addext','basicConstraints=critical,CA:FALSE','-addext','keyUsage=critical,digitalSignature,keyEncipherment','-addext','extendedKeyUsage=serverAuth'],{stdio:'ignore'});}
function cleanup(){return cleanupPromise??=(async()=>{
  clearTimeout(timeout);let clean=true;
  try{await context?.close();context=null;}catch{clean=false;}
  if(child&&child.exitCode===null){try{result.teardown=await ipc('teardown');}catch{}const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}
  if(server?.listening){server.closeAllConnections();await new Promise(r=>server.close(r));}
  if(nssCreated){assert.equal(nss,join(homedir(),'.local/share/pki/nssdb'));rmSync(nss,{recursive:true,force:true});}
  assert.equal(dirname(realpathSync(directory)),realpathSync(tmpdir()));assert.ok(basename(directory).startsWith('pit-newsroom-https-browser-'));rmSync(directory,{recursive:true,force:true});
  result.cleanup={browserClosed:clean,backendExited:!child||child.exitCode!==null,listenerClosed:!server?.listening,fixtureRemoved:!existsSync(directory),temporaryTrustRemoved:!existsSync(nss)};
})();}
try{
  assert.ok(existsSync('/opt/google/chrome/chrome'),'Use runner-installed Chrome with its existing sandbox policy');
  result.browser=execFileSync('/opt/google/chrome/chrome',['--version'],{encoding:'utf8'}).trim();
  writeFileSync(photoPath,image().bytes);writeFileSync(gifPath,animatedImage());leaf(join(directory,'leaf'));
  mkdirSync(nss,{recursive:true});nssCreated=true;
  execFileSync('certutil',['-N','-d','sql:'+nss,'--empty-password'],{stdio:'ignore'});
  execFileSync('certutil',['-A','-d','sql:'+nss,'-t','P,,','-n','disposable-newsroom-leaf','-i',cert],{stdio:'ignore'});
  const backendPort=await port();
  server=httpsServer({key:readFileSync(key),cert:readFileSync(cert)},async(req,res)=>{
    try{
      const url=new URL(req.url,origin),publication=req.method==='POST'&&/^\/api\/newsroom-session\/drafts\/[A-Za-z0-9-]{8,64}\/publish$/u.test(url.pathname);
      const gifDocument=req.method==='GET'&&url.pathname==='/fixture-gif-article';
      if(!publicRoute(req.method,url.pathname)&&!publication&&!gifDocument){res.writeHead(403);res.end();return;}
      if(gifDocument){const html=await ipc('gif-document',{headline:gifHeadline+' copy 2'});res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(html);return;}
      if(url.pathname==='/api/newsroom-session/logout'&&failedLogout){failedLogout=false;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Synthetic logout failure',code:'MEDIA_STORAGE_UNAVAILABLE'}));return;}
      if(/^\/newsroom-remembered\.(html|js|css)$/u.test(url.pathname)){res.writeHead(200,{'Content-Type':{html:'text/html',js:'text/javascript',css:'text/css'}[url.pathname.split('.').at(-1)],'Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(readFileSync(join(root,'public',url.pathname.slice(1))));return;}
      if(url.pathname==='/fixture'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<p>Disposable fixture</p>');return;}
      if(url.pathname.startsWith('/fixture-storage/')){assert.equal(req.method,'PUT');const chunks=[];let size=0;for await(const c of req){size+=c.length;assert.ok(size<=100*1024);chunks.push(c);}const r=await ipc('storage-put',{url:url.href,headers:req.headers,bytes:Buffer.concat(chunks).toString('base64')});res.writeHead(r.status,r.headers);res.end();return;}
      if(url.pathname.startsWith('/fixture-media/')){const r=await ipc('storage-get',{path:url.pathname});res.writeHead(r.status,{'Content-Type':r.type||'image/png'});res.end(r.bytes?Buffer.from(r.bytes,'base64'):undefined);return;}
      const proxy=httpRequest({hostname:'127.0.0.1',port:backendPort,path:req.url,method:req.method,headers:{...req.headers,host:new URL(origin).host,'x-forwarded-proto':'https'}},up=>{
        // Keep the expiry fixture short through all confirmation renewals in this check.
        const headers={...up.headers};if(shortenScopeCookies&&headers['set-cookie']){headers['set-cookie']=headers['set-cookie'].map(c=>c.startsWith('__Host-pit_newsroom=')?c.replace(/;\s*Max-Age=[^;]*/giu,'')+'; Max-Age=2':c);}
        res.writeHead(up.statusCode,headers);up.pipe(res);
      });proxy.on('error',()=>{proxyFailures++;res.writeHead(502);res.end();});req.pipe(proxy);
    }catch{proxyFailures++;res.writeHead(500);res.end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='https://127.0.0.1:'+server.address().port;
  // Preflight certificate verification uses the explicit test leaf as trust; never rejectUnauthorized:false.
  const agent=new Agent({ca:readFileSync(cert),rejectUnauthorized:true});
  await new Promise((resolve,reject)=>{const req=tlsRequest(origin+'/fixture',{agent},res=>{assert.equal(res.statusCode,200);res.resume();res.on('end',resolve);});req.on('error',reject);req.end();});agent.destroy();
  let main=await launch();await main.goto(origin+'/fixture');assert.match(await main.locator('p').innerText(),/Disposable/);checks.push('Trusted loopback TLS accepted without warning bypass');
  const osEnv={};for(const name of ['PATH','TMP','TEMP'])if(process.env[name])osEnv[name]=process.env[name];
  const env=fixtureStartupEnvironment({...osEnv,NODE_ENV:'production',PIT_ENV:'staging',PUBLIC_ORIGIN:origin,PORT:String(backendPort),PIT_DATA_DIR:directory,PIT_ALLOW_EMPTY_DB_BOOTSTRAP:'true',PIT_SUPPORTED_HTTPS_FIXTURE:'1',NEWSROOM_BROWSER_SESSIONS_ENABLED:'true',ADMIN_EMAIL:'bootstrap@example.test',ADMIN_PASSWORD:runtimeSecrets[0],NEWS_DESK_ACCOUNT_ID:'https_newsroom_publisher',PIT_MEDIA_API_ENABLED:'false',MEDIA_ENDPOINT:origin+'/fixture-storage',MEDIA_PUBLIC_BASE_URL:origin+'/fixture-media',MEDIA_BUCKET:'pit-browser-public',MEDIA_SOURCE_BUCKET:'pit-browser-private',MEDIA_REGION:'auto',MEDIA_ACCESS_KEY_ID:runtimeSecrets[1],MEDIA_SECRET_ACCESS_KEY:runtimeSecrets[2]});
  child=fork(join(root,'server/index.js'),[],{cwd:root,env,execArgv:['--max-old-space-size=256','--import',pathToFileURL(join(root,'scripts/fixtures/newsroom-ci-browser-preload.mjs')).href],stdio:['ignore','pipe','pipe','ipc']});
  child.stdout.on('data',b=>serverOutput=(serverOutput+b).slice(-8000));child.stderr.on('data',b=>serverOutput=(serverOutput+b).slice(-8000));
  child.on('message',m=>{if(m.kind==='fixture')fixture=m;if(m.kind==='listener-bound')bound=m.address;if(m.kind==='reply'){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(m.error)):p?.resolve(m.result);}});
  await wait(()=>{assert.equal(child.exitCode,null,'Fixture backend exited');return fixture&&bound;},'Fixture backend startup');assert.equal(bound,'127.0.0.1');assert.deepEqual(fixture.policy,{idleMs:7*86400000,maxMs:30*86400000});
  await nav(main);await check('Fresh browser does not recover or automatically create an identity',async()=>{assert.equal(await hidden(main),true);assert.equal((await ipc('snapshot')).scoped,0);});
  await login(main,fixture.users.owner);await nav(main);assert.equal((await ipc('snapshot')).scoped,0);await enable(main);
  await check('Explicit opt-in sets separate Secure HttpOnly host-only Lax cookie',async()=>{const c=(await context.cookies(origin)).find(c=>c.name==='__Host-pit_newsroom');assert.ok(c);assert.equal(c.secure,true);assert.equal(c.httpOnly,true);assert.equal(c.sameSite,'Lax');assert.equal(c.path,'/');assert.equal(c.domain,'127.0.0.1');const status=await api(main,'/api/newsroom-session/status');assert.ok(Math.abs(c.expires*1000-status.data.expiresAt)<1100);assert.equal(await main.evaluate(()=>document.cookie.includes('pit_newsroom')),false);result.cookieAttributes={name:c.name,secure:c.secure,httpOnly:c.httpOnly,sameSite:c.sameSite,path:c.path,domain:c.domain};});
  const headline='Radiohead announce new world tour dates';
  await check('Actual image upload, verified derivative, expired draft copy and two save rounds',async()=>{
    const fields={headline,summary:'Radiohead announced new tour dates in this disposable synthetic test.',body:'The band announced the fictional tour through its official website for this synthetic acceptance test.',sources:'Radiohead | https://radiohead.com/news/synthetic-test | Synthetic citation','photo-name':'Synthetic photographer','photo-url':'https://example.test/photo-rights','photo-credit':'Generated test image'};
    for(const[id,value]of Object.entries(fields))await main.locator('#'+id).fill(value);await main.locator('#category').selectOption('tour');await main.locator('#photo').setInputFiles(photoPath);await click(main,'save');assert.equal(await main.locator('#error').innerText(),'');
    result.image=await ipc('image-proof');let currentTitle=headline;clockHours+=25;await ipc('advance',{hours:clockHours});
    for(let i=1;i<=2;i++){await nav(main);const card=main.locator('#drafts article').filter({has:main.getByRole('heading',{name:currentTitle,exact:true})});await card.getByRole('button',{name:'Preview saved article',exact:true}).click();await ready(main);await wait(()=>card.locator('img').evaluate(el=>el.complete&&el.naturalWidth===1200),'Real derivative render');if(i===1)assert.equal(await card.getByRole('button',{name:'Publish this article',exact:true}).count(),0,'Old original cannot publish directly');await card.getByRole('button',{name:'Edit a copy',exact:true}).click();await ready(main);assert.equal(await main.locator('#photo-name').inputValue(),fields['photo-name']);assert.equal(await main.locator('#photo-url').inputValue(),fields['photo-url']);assert.equal(await main.locator('#photo-credit').inputValue(),fields['photo-credit']);assert.equal((await main.locator('#sources').inputValue()).split('\n').length,1);currentTitle=headline+' copy '+i;await main.locator('#headline').fill(currentTitle);await click(main,'save');assert.equal(await main.locator('#error').innerText(),'');}
    assert.equal((await ipc('snapshot')).drafts,3);await nav(main);const card=main.locator('#drafts article').filter({has:main.getByRole('heading',{name:currentTitle,exact:true})});await card.getByRole('button',{name:'Preview saved article',exact:true}).click();await ready(main);await card.getByRole('button',{name:'Publish this article',exact:true}).click();await ready(main);assert.equal(await main.locator('#error').innerText(),'');assert.equal((await ipc('snapshot')).published,1);
  });
  await check('GIF upload visibly animates after reopen, two copies and disposable public rendering',async()=>{
    await nav(main);
    assert.ok((await main.locator('#photo').getAttribute('accept')).split(',').includes('image/gif'));
    const fields={headline:gifHeadline,summary:'Muse announced a fictional release with an animated cover for this disposable test.',body:'This fictional music release is a synthetic test of animation preservation, with no connection to a real announcement.',sources:'Muse | https://muse.mu/news/synthetic-release | Synthetic release citation','photo-name':'Synthetic animation fixture','photo-url':'https://example.test/animation-rights','photo-credit':'Generated alternating codec vector'};
    for(const[id,value]of Object.entries(fields))await main.locator('#'+id).fill(value);
    await main.locator('#category').selectOption('release');await main.locator('#photo').setInputFiles(gifPath);await click(main,'save');assert.equal(await main.locator('#error').innerText(),'');
    result.gif=await ipc('gif-proof');const beforeCopies=await ipc('snapshot');assert.equal(beforeCopies.readyPhotos,2);
    let title=gifHeadline;
    for(let i=1;i<=2;i++){
      await nav(main);const card=main.locator('#drafts article').filter({has:main.getByRole('heading',{name:title,exact:true})});
      await card.getByRole('button',{name:'Preview saved article',exact:true}).click();await ready(main);
      assert.equal(await card.locator('img').getAttribute('src'),result.gif.url);await visibleAnimation(card.locator('img'));
      await card.getByRole('button',{name:'Edit a copy',exact:true}).click();await ready(main);
      for(const id of ['photo-name','photo-url','photo-credit'])assert.equal(await main.locator('#'+id).inputValue(),fields[id]);
      assert.equal((await main.locator('#sources').inputValue()).split('\n').length,1);assert.equal(await main.locator('#photo').inputValue(),'');
      title=gifHeadline+' copy '+i;await main.locator('#headline').fill(title);await click(main,'save');assert.equal(await main.locator('#error').innerText(),'');
    }
    const afterCopies=await ipc('snapshot');assert.equal(afterCopies.readyPhotos,beforeCopies.readyPhotos);assert.equal(afterCopies.objects,beforeCopies.objects);assert.equal(afterCopies.drafts,6);
    await nav(main);const card=main.locator('#drafts article').filter({has:main.getByRole('heading',{name:title,exact:true})});await card.getByRole('button',{name:'Preview saved article',exact:true}).click();await ready(main);
    await card.getByRole('button',{name:'Publish this article',exact:true}).click();await ready(main);assert.equal(await main.locator('#error').innerText(),'');assert.equal((await ipc('snapshot')).published,2);
    const publicPage=await context.newPage();await publicPage.goto(origin+'/fixture-gif-article');
    assert.equal(await publicPage.locator('meta[property="og:image:type"]').getAttribute('content'),'image/webp');
    const publicImage=publicPage.locator('img').filter({visible:true});
    assert.equal(await publicImage.getAttribute('src'),result.gif.url);result.gif.visiblePublicFrames=await visibleAnimation(publicImage);await publicPage.close();
    result.gif.copyRounds=2;result.gif.duplicateAssets=0;delete result.gif.url;delete result.gif.assetId;
  });
  await check('Closed browser process restarts with valid remembered access',async()=>{await context.close();context=null;main=await launch();await nav(main);assert.equal(await hidden(main),false);});
  await check('Authenticated private context disposal removes its browser identity',async()=>{let privateContext=await context.browser().newContext();await restrict(privateContext);let p=await privateContext.newPage();await nav(p);assert.equal(await hidden(p),true);await login(p,fixture.users.peer);await enable(p);assert.ok((await privateContext.cookies(origin)).some(c=>c.name==='__Host-pit_newsroom'));await privateContext.close();privateContext=await context.browser().newContext();await restrict(privateContext);p=await privateContext.newPage();await nav(p);assert.equal(await hidden(p),true);assert.equal((await privateContext.cookies(origin)).length,0);await privateContext.close();});
  await check('Site-cookie clearing cannot resurrect account or article text',async()=>{await main.locator('#body').fill('Synthetic private text');await context.clearCookies({domain:'127.0.0.1'});await click(main,'refresh');assert.equal(await hidden(main),true);assert.equal(await main.locator('#body').inputValue(),'');await nav(main);assert.equal(await hidden(main),true);assert.equal((await context.cookies(origin)).length,0);});
  await login(main,fixture.users.owner);shortenScopeCookies=true;await enable(main);
  await check('Real browser cookie expiry signs out without recovery',async()=>{const c=(await context.cookies(origin)).find(c=>c.name==='__Host-pit_newsroom');assert.ok(c&&c.expires*1000<=Date.now()+2100,'Fixture must shorten confirmation renewals too');await delay(2500);await nav(main);assert.equal(await hidden(main),true);assert.equal((await context.cookies(origin)).some(c=>c.name==='__Host-pit_newsroom'),false);result.browserExpiry='Fixture shortened this check’s cookie and confirmation renewals with Max-Age=2; actual browser expiry, not proof of elapsed production thirty-day policy';});shortenScopeCookies=false;
  await login(main,fixture.users.owner);await enable(main);
  await check('Server inactivity expiry rejects still-retained browser cookie',async()=>{clockHours+=fixture.policy.idleMs/3600000+1;await ipc('advance',{hours:clockHours});await click(main,'refresh');assert.equal(await hidden(main),true);assert.equal((await api(main,'/api/newsroom-session/status')).status,401);});
  await login(main,fixture.users.owner);await enable(main);
  await check('Active confirmations cannot extend the original thirty-day deadline',async()=>{
    const initial=(await api(main,'/api/newsroom-session/status')).data;
    for(let step=0;step<4;step++){
      clockHours+=6*24;await ipc('advance',{hours:clockHours});
      const current=await api(main,'/api/newsroom-session/status');assert.equal(current.status,200);
      assert.equal(current.data.absoluteExpiresAt,initial.absoluteExpiresAt);
      assert.ok(current.data.expiresAt<=initial.absoluteExpiresAt);
    }
    assert.ok((await context.cookies(origin)).some(c=>c.name==='__Host-pit_newsroom'));
    clockHours+=6*24+1;await ipc('advance',{hours:clockHours});
    assert.equal((await api(main,'/api/newsroom-session/status')).status,401);await nav(main);assert.equal(await hidden(main),true);
  });
  await login(main,fixture.users.owner);await enable(main);
  await check('Failed Forget clears text and reports revocation unconfirmed',async()=>{await main.locator('#body').fill('Synthetic text for failed logout');failedLogout=true;await click(main,'forget');assert.equal(await hidden(main),true);assert.equal(await main.locator('#body').inputValue(),'');assert.match(await main.locator('#status').innerText(),/not confirmed/);assert.equal((await api(main,'/api/newsroom-session/status')).status,200);});
  await nav(main);await check('Successful Forget revokes row and cookie; reload stays signed out',async()=>{await click(main,'forget');assert.equal((await api(main,'/api/newsroom-session/status')).status,401);assert.equal((await context.cookies(origin)).some(c=>c.name==='__Host-pit_newsroom'),false);await nav(main);assert.equal(await hidden(main),true);});
  await login(main,fixture.users.owner);await enable(main);
  await check('Normal website logout also removes remembered authority',async()=>{assert.equal((await api(main,'/api/logout',{})).status,200);await nav(main);assert.equal(await hidden(main),true);assert.equal((await context.cookies(origin)).some(c=>c.name==='__Host-pit_newsroom'),false);assert.equal((await api(main,'/api/newsroom-session/status')).status,401);});
  const snapshot=await ipc('snapshot');assert.equal(snapshot.outboundBlocked,0);assert.equal(snapshot.paid,0);assert.equal(snapshot.published,2);assert.equal(snapshot.timerIsolation.suppressed.length,6);assert.equal(proxyFailures,0);assert.equal(externalBrowserRequests,0);result.snapshot=snapshot;result.status='PASS';
}catch(error){result.status='FAILED';let message=String(error.message);for(const secret of [fixture?.password,...runtimeSecrets])if(secret)message=message.split(secret).join('[redacted]');message=message.replace(/https?:\/\/[^\s)]+/gu,'[test-url]').replace(/(?:cookie|authorization|password)\s*[:=]\s*[^\s,]+/giu,'[redacted]');result.error={name:error.name,message:message.slice(0,4000)};process.exitCode=1;}
finally{await cleanup();result.completedAt=new Date().toISOString();const report=join(root,'artifacts/newsroom-ci');mkdirSync(report,{recursive:true});writeFileSync(join(report,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}
