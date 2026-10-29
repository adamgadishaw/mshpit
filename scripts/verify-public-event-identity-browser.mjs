// Exported app on loopback; synthetic event data and intercepted APIs only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fixtureApiResponse, eventPath, navigationArtist } from './verify-navigation-browser.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || 'playwright');
const root = resolve('dist');
const server = createServer((req,res) => {
  let file = resolve(root, '.' + new URL(req.url,'http://local').pathname);
  if (!file.startsWith(root+sep) || !existsSync(file) || statSync(file).isDirectory()) file=resolve(root,'index.html');
  res.setHeader('content-type', ({'.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.ttf':'font/ttf'})[extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
 browser=await chromium.launch({headless:true,executablePath:process.env.PIT_BROWSER_EXECUTABLE});
 for (const pending of [true,false]) {
  const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  const errors=[]; const blocked=[]; const routeErrors=[];
  const event={id:eventPath.split('/').at(-1),kind:'event',path:eventPath,publicEventSnapshot:true,performanceEvent:true,artist:navigationArtist.name,artistKey:pending?null:navigationArtist.key,artistPublicSlug:pending?null:navigationArtist.publicSlug,artistIdentityPending:pending,eventName:'Fixture Artist - Suite Reservation',name:'Fixture Artist - Suite Reservation',eventKind:'concert',venue:'Fixture Venue',date:'2036-06-14',source:'ticketmaster'};
  const archivePath='/concert/show.fixture-canonical';
  const archive={id:'show.fixture-canonical',archiveShowKey:'show.fixture-canonical',kind:'concert',performanceEvent:true,path:archivePath,artist:event.artist,artistKey:navigationArtist.key,artistPublicSlug:navigationArtist.publicSlug,venue:event.venue,date:'2024-06-14',overall:5};
  let changedBilling = false;
  let releaseChangedResolve;
  const changedGate = new Promise(done => { releaseChangedResolve = done; });
  let changedResolveStarted = false;
  const compact = { id:event.id,artist:event.artist,venue:event.venue,date:event.date,performanceEvent:true,artistIdentityPending:true,artistPublicSlug:'stale-name' };
  await context.route('**/*', async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin) { blocked.push(url.origin); return route.abort(); }
    if(!url.pathname.startsWith('/api/')) return route.continue();
    let body;
    if(url.pathname==='/api/resolve' && url.searchParams.get('path')===eventPath) {
      if(changedBilling) { changedResolveStarted=true; await changedGate; }
      body={entity:changedBilling ? {...event,artist:'Changed Billing',artistIdentityPending:true,artistPublicSlug:null,eventName:'Changed Billing - Suite Reservations',name:'Changed Billing - Suite Reservations'} : event};
    }
    else if(url.pathname==='/api/resolve' && url.searchParams.get('path')===archivePath) body={entity:archive};
    else if(url.pathname==='/api/page-head' && url.searchParams.get('path')===archivePath) body={path:archivePath,head:'<title>Fixture concert archive</title><meta name="robots" content="noindex,follow">'};
    else if(url.pathname==='/api/artists/archive/reviews') body={reviews:[],hasMore:false,nextCursor:null};
    else if (/^\/api\/artists\/[^/]+\/live-summary$/.test(url.pathname)) body={artist:navigationArtist,reputation:{avgRating:null,ratingCount:0,reviewCount:0,showCount:0},schedule:{items:[changedBilling ? {...compact,artist:'Changed Billing',artistIdentityPending:true} : pending ? event : compact],total:1,hasMore:false,nextCursor:null,legacy:false,coverage:{status:'fresh'}}};
    else if(url.pathname==='/api/tourdates') body={tourDates:[event]};
    else if(url.pathname==='/api/discover/overview') body={artists:[],venues:[],events:[event],genres:[],countries:[]};
    else if(url.pathname==='/api/discovery/sidebar') body={upcomingEvents:[event],suggestedUsers:[],topArtists:[],trendingVenues:[],popularLounges:[],landingMedia:[],catalogTotals:{artists:1,venues:1}};
    else {
      try { body=fixtureApiResponse(url.pathname,{resolvedPath:url.searchParams.get('path')||'',method:route.request().method(),artistIdentityPending:pending}); }
      catch (error) { routeErrors.push(`${url.pathname}: ${error.message}`); body={}; }
    }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  const page=await context.newPage(); page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+eventPath);
  await page.getByRole('heading',{name:event.eventName,exact:true}).waitFor();
  const artistLink=page.locator(`[aria-label="Public page navigation"] a[href="/artist/${navigationArtist.publicSlug}"]`);
  if(pending) assert.equal(await artistLink.count(),0); else assert.ok(await artistLink.count()>0);
  for(let i=0;i<2;i++) {
    await page.getByRole('link',{name:'Events',exact:true}).first().click();
    await page.waitForURL(origin+'/events');
    await page.locator(`a[href="${eventPath}"]`).first().waitFor();
    assert.match(await page.locator(`a[href="${eventPath}"]`).first().innerText(),/Suite Reservation/);
    await page.locator(`a[href="${eventPath}"]`).first().click();
    await page.getByRole('heading',{name:event.eventName,exact:true}).waitFor();
    await page.goBack(); await page.waitForURL(origin+'/events');
    await page.goForward(); await page.getByRole('heading',{name:event.eventName,exact:true}).waitFor();
  }
  if (!pending) {
    await artistLink.first().click();
    await page.waitForURL(origin+'/artist/'+navigationArtist.publicSlug);
    await page.getByTestId('artist-show-'+event.id).waitFor();
    await page.getByTestId('artist-show-'+event.id).locator('a[href="'+eventPath+'"]').click();
    await page.getByRole('heading',{name:event.eventName,exact:true}).waitFor();
    await artistLink.first().waitFor();
    assert.equal(await page.locator('a[href="/artist/stale-name"]').count(),0);
    // Same event/account, newer pending billing: old ready trail must not paint.
    changedBilling=true;
    await artistLink.first().click();
    await page.waitForURL(origin+'/artist/'+navigationArtist.publicSlug);
    await page.getByTestId('artist-show-'+event.id).getByText('Changed Billing',{exact:true}).waitFor();
    await page.evaluate(() => {
      window.staleVisitArtistLinks=[];
      window.visitObserver=new MutationObserver(() => {
        if(location.pathname.startsWith('/event/') && document.body.innerText.includes('Changed Billing')
          && document.querySelector('[aria-label="Public page navigation"] a[href="/artist/fixture-artist"]')) window.staleVisitArtistLinks.push('stale artist link');
      });
      window.visitObserver.observe(document.body,{childList:true,subtree:true,characterData:true});
    });
    await page.getByTestId('artist-show-'+event.id).locator('a[href="'+eventPath+'"]').click();
    await page.getByRole('heading',{name:'Changed Billing',exact:true}).waitFor();
    assert.equal(changedResolveStarted,true);
    assert.equal(await artistLink.count(),0,'old visit cannot confirm a newer pending bill while its read waits');
    releaseChangedResolve();
    await page.getByRole('heading',{name:'Changed Billing - Suite Reservations',exact:true}).waitFor();
    assert.equal(await artistLink.count(),0);
    assert.deepEqual(await page.evaluate(()=>window.staleVisitArtistLinks),[]);
    await page.evaluate(()=>window.visitObserver.disconnect());
    await page.goto(origin+archivePath);
    await artistLink.first().waitFor();
    await artistLink.first().click();
    await page.waitForURL(origin+'/artist/'+navigationArtist.publicSlug);
  }
  assert.deepEqual(errors,[]); assert.deepEqual(routeErrors,[]);
  console.log(JSON.stringify({pending,title:event.eventName,repeatedDirectoryNavigation:2,backForward:true,compactScheduleNavigation:!pending,canonicalArchiveNavigation:!pending,changedBillingAwayReturn:!pending,uncaughtErrors:errors,blockedExternalOrigins:[...new Set(blocked)]}));
  await context.close();
 }
} finally { await browser?.close(); await new Promise(done=>server.close(done)); }
