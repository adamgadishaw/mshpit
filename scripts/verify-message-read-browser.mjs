// Actual exported website, isolated browser profile, synthetic API fixtures only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureApiResponse, navigationUser } from './verify-navigation-browser.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.env.PIT_MESSAGE_BROWSER_OUT || join(root, '../web-companion-evidence/browser'));
mkdirSync(out, { recursive: true });
const require = createRequire(import.meta.url);
assert.ok(process.env.PIT_PLAYWRIGHT_MODULE, 'Use the existing isolated browser-test library.');
const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE);
const directory = resolve(root, process.env.PIT_NAVIGATION_BROWSER_DIST || 'dist');
const mime = { '.js':'text/javascript', '.html':'text/html', '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml', '.ttf':'font/ttf' };
const server = createServer((request,response) => {
  if (!['GET','HEAD'].includes(request.method)) return void response.writeHead(405).end();
  const url = new URL(request.url,'http://fixture.invalid');
  let file = resolve(directory,'.'+decodeURIComponent(url.pathname));
  if (file !== directory && !file.startsWith(directory+sep)) return void response.writeHead(400).end();
  try { if (!statSync(file).isFile()) file=join(directory,'index.html'); } catch { file=join(directory,'index.html'); }
  response.writeHead(200,{'Content-Type':mime[extname(file)] || 'application/octet-stream','Cache-Control':'no-store'});
  response.end(readFileSync(file));
});
await new Promise((done,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',done); });
const origin = `http://127.0.0.1:${server.address().port}`;
const peer = { id:'companion-peer',name:'Companion Fixture',handle:'companionfixture',role:'fan',initials:'CF',ageBand:'18_plus',profileAudience:'everyone' };
let browser;
const results=[];
try {
  browser = await chromium.launch({ headless:true, executablePath:process.env.PIT_BROWSER_EXECUTABLE });
  for (const width of [1280,390]) {
    const context = await browser.newContext({ viewport:{width,height:900}, isMobile:width<620, hasTouch:width<620, serviceWorkers:'block', reducedMotion:'reduce' });
    const state={ read:0, writes:[], errors:[], serial:1200, rows:[], race:true, closing:false, unsupported:false };
    const epoch = Date.now()-1800*60000;
    const message = index => ({ id:`dm-${String(index).padStart(5,'0')}`,from:peer.id,text:`Synthetic concert message ${index}`,createdAt:epoch+index*60000 });
    state.rows=Array.from({length:80},(_,i)=>message(1121+i));
    const summary = () => ({readCursor:state.read ? {id:message(state.read).id,createdAt:epoch+state.read*60000}:null,
      unread:state.serial-state.read,latestIncomingCursor:{id:message(state.serial).id,createdAt:epoch+state.serial*60000},hasReplied:false,requestState:'accepted'});
    await context.addInitScript(({origin,user})=>{ if(location.origin===origin){localStorage.setItem('pit.session',JSON.stringify(user));localStorage.setItem('pit.users',JSON.stringify([user]));localStorage.setItem('pit_theme','stage');} },{origin,user:navigationUser});
    const page=await context.newPage();page.setDefaultTimeout(15000);
    page.on('pageerror',error=>state.errors.push(error.message));
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method();
      if(url.origin!==origin)return route.abort();
      if(!path.startsWith('/api/'))return route.continue();
      try {
        let body,status=200;
        if(method==='POST' && path===`/api/dms/${peer.id}/read-through`){
          assert.equal(request.headers()['x-pit-expected-account'],navigationUser.id);
          const payload=request.postDataJSON();assert.deepEqual(Object.keys(payload),['messageId']);
          const target=state.rows.find(row=>row.id===payload.messageId);assert.ok(target,'read must target a loaded actual message');
          state.writes.push({path,messageId:payload.messageId});
          if(state.unsupported){status=404;body={error:'Fixture older server',code:'NOT_FOUND'};}
          else {if(state.race){state.serial++;state.race=false;}state.read=Math.max(state.read,Number(payload.messageId.slice(3)));body={ok:true,...summary(),notificationIds:[]};}
        } else if(method==='POST' && ['/api/client-errors','/api/feed/impressions','/api/feed/revalidate','/api/feed/news-introduction'].includes(path)) body={ok:true,invalidPostIds:[],post:null};
        else {
          assert.equal(method,'GET',`Unexpected fixture mutation: ${method} ${path}`);
          if(path==='/api/me/threads')body={threads:[{otherId:peer.id,otherUser:peer,messages:[state.rows.at(-1)],...summary()}],removedIds:[]};
          else if(path===`/api/users/${peer.id}`)body={user:peer,followers:0,following:0};
          else if(path===`/api/dms/${peer.id}`)body={messages:state.rows,removedIds:[],syncCursor:'fixture-sync',hasMore:false,relationshipContext:null,...summary()};
          else if(path==='/api/me/notifications')body={notifications:[],inboxUnread:state.serial-state.read};
          else body=fixtureApiResponse(path,{member:true,method,resolvedPath:url.searchParams.get('path') || undefined});
        }
        await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      } catch(error){if(!state.closing)state.errors.push(error.message);await route.abort() .catch(()=>{ /* Fixture teardown may close an already handled request. */ });}
    });
    try {
      await page.goto(origin+'/feed',{waitUntil:'networkidle'});
      await page.getByRole('button',{name:/^Inbox(?:,|$| )/}).first().click();
      const conversation=page.getByRole('button',{name:'Open conversation with Companion Fixture, 1200 unread',exact:true});
      await conversation.waitFor();assert.equal(state.writes.length,0);
      await page.screenshot({path:join(out,`inbox-${width}.png`),fullPage:true});
      await conversation.click();
      await page.getByRole('textbox',{name:'Message Companion Fixture',exact:true}).waitFor();
      await page.waitForFunction(()=>document.body.innerText.includes('Synthetic concert message 1200'));
      const scrollDeadline=Date.now()+15000;
      while(state.read<1200 && Date.now()<scrollDeadline) await page.waitForTimeout(25);
      assert.ok(state.writes.length>0,'actual browser geometry must earn a read target');
      assert.ok(state.writes.every(w=>w.path.endsWith('/read-through')));
      assert.equal(state.serial-state.read,1,'unfetched server arrival stays unread');
      const owner=await page.getByText('Synthetic concert message 1200',{exact:true}).evaluateHandle(node=>{for(let p=node.parentElement;p;p=p.parentElement)if(['auto','scroll'].includes(getComputedStyle(p).overflowY)&&p.scrollHeight>p.clientHeight)return p;return null;});
      assert.ok(await owner.evaluate(node=>!!node),'existing message scroll viewport is present');
      await owner.evaluate(node=>{node.scrollTop=0;node.dispatchEvent(new Event('scroll',{bubbles:true}));});
      const writesBefore=state.writes.length;
      await page.screenshot({path:join(out,`thread-${width}.png`),fullPage:true});
      await page.waitForTimeout(300);assert.equal(state.writes.length,writesBefore,'scrolling older history does not clear the arrival');
      await page.getByRole('textbox',{name:'Message Companion Fixture',exact:true}).fill('Unsent synthetic draft');
      await page.reload({waitUntil:'networkidle'});
      await page.getByRole('button',{name:/^Inbox(?:,|$| )/}).first().click();
      await page.getByRole('button',{name:'Open conversation with Companion Fixture, 1 unread',exact:true}).waitFor();
      // The companion never falls back to old mark-all semantics on an old server.
      state.unsupported=true; state.rows.push(message(state.serial));
      const attempts=state.writes.length;
      await page.getByRole('button',{name:'Open conversation with Companion Fixture, 1 unread',exact:true}).click();
      const receiptDeadline=Date.now()+15000;
      while(state.writes.length===attempts && Date.now()<receiptDeadline) await page.waitForTimeout(25);
      assert.ok(state.writes.length>attempts); assert.equal(state.serial-state.read,1);
      assert.ok(state.writes.every(w=>w.path.endsWith('/read-through')));
      assert.deepEqual(state.errors,[]);
      results.push({width,status:'passed',readEndpoint:'read-through',initialUnread:1200,afterRacedArrivalUnread:1,actualDomGeometry:true,oldServer404PreservesUnread:true,noBlanketReadFallback:true,externalRequestsBlocked:true});
    } catch(error){await page.screenshot({path:join(out,`failure-${width}.png`),fullPage:true}) .catch(()=>{ /* Fixture teardown may close an already handled request. */ });writeFileSync(join(out,`failure-${width}.json`),JSON.stringify({error:error.stack,errors:state.errors,writes:state.writes,buttons:await page.getByRole('button').allTextContents()},null,2));throw error;}
    finally{state.closing=true;await context.close();}
  }
  writeFileSync(join(out,'browser-results.json'),JSON.stringify({status:'passed',fixture:'actual exported website; synthetic API only',results},null,2)+'\n');
  console.log(JSON.stringify(results));
}finally{await browser?.close();await new Promise(done=>server.close(done));}
