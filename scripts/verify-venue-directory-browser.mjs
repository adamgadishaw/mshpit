import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
import { fixtureApiResponse } from './verify-navigation-browser.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE);
const providerVenueId = 'KovZ917AJ4F';
const path = '/venue/ticketmaster-kovz917aj4f';
const venue = { name: 'History Toronto', source: 'ticketmaster', providerVenueId, place: 'Toronto, Ontario, Canada' };
const dates = [1,2].map(i => ({ id: `directory-${i}`, source: 'ticketmaster', providerVenueId, venue: venue.name, artist: `Directory Band ${i}`, place: venue.place, venueCity: 'Toronto', venueCountry: 'Canada', date: `${new Date().getUTCFullYear() + 1}-12-0${i}`, releaseAt: 0 }));
const server = createServer((req,res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = resolve('dist', '.' + url.pathname);
  if (!existsSync(file) || !extname(file)) file = resolve('dist/index.html');
  res.setHeader('Content-Type', ({'.js':'text/javascript','.html':'text/html','.css':'text/css','.ttf':'font/ttf'})[extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise(done => server.listen(0,'127.0.0.1',done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({headless:true, executablePath:process.env.PIT_BROWSER_EXECUTABLE});
  for (const width of [390,1280]) {
    const context = await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
    const errors=[]; const snapshots=[];
    let release; const gate = new Promise(done => release=done);
    await context.route('**/*',async route => {
      const url = new URL(route.request().url());
      if(url.origin !== origin) return route.abort();
      if(!url.pathname.startsWith('/api/')) return route.continue();
      try {
        let body;
        if(url.pathname === '/api/tourdates') { await gate; body={tourDates:dates}; }
        else if(url.pathname === '/api/venue-snapshot') {
          assert.equal(url.searchParams.get('path'),path); snapshots.push(path);
          body={path,after:null,hasMore:false,nextCursor:null,venue,events:dates.map(row=>({...row,name:'Snapshot-only concert '+row.id,artist:'Snapshot-only performer '+row.id,eventKind:'concert'}))};
        } else if(url.pathname.startsWith('/api/catalog-text/venue/')) body={text:null};
        else if(/^\/api\/venues\/.*\/photos$/.test(url.pathname)) body={photos:[],fanPhotos:[],state:'ready'};
        else body=fixtureApiResponse(url.pathname,{method:route.request().method(),resolvedPath:url.searchParams.get('path')});
        await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
      } catch(error) { errors.push(error.message); await route.abort(); }
    });
    const page=await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/venues');
    await page.getByRole('button',{name:/^Toronto, \d+ venues/}).waitFor();
    release();
    const city=page.getByRole('button',{name:/^Toronto, \d+ venues, 2 upcoming shows/});
    await city.click();
    await page.getByRole('button',{name:'History Toronto, Toronto, 2 upcoming shows',exact:true}).click();
    await page.waitForURL(origin+path);
    await page.getByRole('tab', {name:'Shows venue page section', exact:true}).click();
    await page.getByText('Snapshot-only performer directory-1',{exact:true}).waitFor();
    assert.equal(await page.getByText('No announced shows yet',{exact:true}).count(),0);
    assert.equal(await page.getByText('Venue details could not be loaded. Please try again.',{exact:true}).count(),0);
    await page.getByText('UPCOMING', {exact:true}).first().waitFor();
    assert.ok(snapshots.length);
    await page.screenshot({path:`../directory-${width}.png`});
    await page.goto(origin+'/venues');
    await page.getByPlaceholder('Search venues or cities').fill('History');
    await page.getByRole('button',{name:'History Toronto, Toronto, 2 upcoming shows',exact:true}).click();
    await page.waitForURL(origin+path);
    await page.getByRole('tab', {name:'Shows venue page section', exact:true}).click();
    await page.getByText('Snapshot-only performer directory-1',{exact:true}).waitFor();
    assert.equal(await page.getByText('No announced shows yet',{exact:true}).count(),0);
    assert.equal(await page.getByText('Venue details could not be loaded. Please try again.',{exact:true}).count(),0);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({width,passed:true,path,snapshots:snapshots.length,lateHydration:true,searchAndCity:true}));
    await context.close();
  }
} finally { await browser?.close(); await new Promise(done=>server.close(done)); }
