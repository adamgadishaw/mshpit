#!/usr/bin/env node
// Actual exported app, synthetic members and events, loopback transport only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { localServer } from './verify-discover-venues-browser.mjs';
import { archiveShowKey, decodeArchiveShowKey } from '../server/features/artistArchive/artistArchiveKeys.js';
import { fixtureApiResponse, navigationUser, navigationArtist } from './verify-navigation-browser.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PIT_PLAYWRIGHT_MODULE || 'playwright');
const output=resolve('.tmp/past-event-rsvp-browser');mkdirSync(output,{recursive:true});
const id='show_'+'a'.repeat(64), now=Date.parse('2026-11-12T20:00:00Z');
async function scenario(browser,origin,width,mode) {
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block',timezoneId:width===375?'Pacific/Kiritimati':'Pacific/Honolulu'});
  const page=await context.newPage();page.setDefaultTimeout(12000);
  const state={writes:[],errors:[],requests:[],attendance:mode==='saved'?{showId:id,state:'going',visibility:'private'}:null};
  await context.addInitScript(user=>{localStorage.setItem('pit.session',JSON.stringify(user));localStorage.setItem('pit.users',JSON.stringify([user]));localStorage.setItem('pit_theme','stage');},navigationUser);
  await page.clock.install({time:now});
  const past=['top-rated','ended','saved'].includes(mode);
  const date=past?'2020-01-01':mode==='multi-day'?'2026-11-10':'2026-11-12';
  const entity={id:'rsvp-fixture',kind:'event',path:'/event/rsvp-fixture',publicEventSnapshot:true,name:'Fixture Artist',artist:'Fixture Artist',artistKey:'fixture-artist',venue:'Fixture Venue',city:'Toronto',date,eventTimezone:'America/Toronto',eventStatus:'active',source:'ticketmaster',startDateTime:date+'T18:00:00-05:00',...(mode==='multi-day'?{eventEndDate:'2026-11-15'}:{})};
  const show={...entity,id,canonicalKey:'ticketmaster:rsvp-fixture',lifecycle:past||mode==='multi-day'?'completed':'upcoming',startsAt:mode==='expiry'?now-3600000:Date.parse(entity.startDateTime),timezone:entity.eventTimezone,endsAt:mode==='expiry'?now+30000:null,provider:{name:'ticketmaster',eventId:'rsvp-fixture',backed:true}};
  const archiveKey=archiveShowKey({artistIdentity:'fixture-artist',venueIdentity:'Fixture Venue',date});
  const archiveShow={key:archiveKey,artist:entity.artist,artistKey:entity.artistKey,venue:entity.venue,city:entity.city,date,avgRating:4.7,ratingCount:17,reviewCount:1};
  page.on('pageerror',error=>state.errors.push(error.message));
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method();
    const json=body=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
    try {
      if(url.origin!==origin)return await route.abort();
      if(!path.startsWith('/api/'))return await route.continue();
      state.requests.push(path);
      if(path==='/api/client-errors')return await json({ok:true});
      if(path==='/api/me')return await json({user:navigationUser});
      if(path==='/api/going'&&method==='POST'){
        const body=request.postDataJSON();state.writes.push(body);state.attendance=body.state?{showId:id,state:body.state,visibility:body.visibility||'private'}:null;
        return await json({showId:id,attendance:state.attendance,going:body.state==='going'});
      }
      assert.equal(method,'GET',`Unexpected mutation ${method} ${path}`);
      if(path==='/api/page-head'){
        const requestedPath=url.searchParams.get('path');
        assert.ok(requestedPath?.startsWith('/')&&!requestedPath.startsWith('//'));
        return await json({path:requestedPath,head:'<title>RSVP fixture</title>'});
      }
      if(path==='/api/discover/overview')return await json({...fixtureApiResponse(path,{member:true}),topRatedShows:[{key:'fixture-rated',artist:'Fixture Artist',artistKey:'fixture-artist',venue:'Fixture Venue',city:'Toronto',date,avgRating:4.7,ratingCount:17,reviewCount:1}]});
      if(path==='/api/resolve'&&url.searchParams.get('path')===entity.path)return await json({entity});
      if(path.startsWith('/api/shows/'))return await json({show:mode==='top-rated'?null:{...show,viewerAttendance:state.attendance}});
      if(path.startsWith('/api/going/')&&path.endsWith('/attendees'))return await json({showId:id,attendees:[],total:0,scope:'everyone',viewerAttendance:state.attendance});
      if(path==='/api/artists/archive')return await json({archive:{artist:navigationArtist,shows:[archiveShow],topShows:[archiveShow],tours:[],upcoming:[],totals:{},truncated:false}});
      if(path==='/api/artists/archive/reviews'){
        if(mode==='top-rated')assert.equal(decodeArchiveShowKey(url.searchParams.get('showKey'))?.date,date);
        return await json({reviews:[],total:0,nextCursor:null});
      }
      if(path.startsWith('/api/event-accounts/'))return await json({entity:null});
      return await json(fixtureApiResponse(path,{member:true,method,resolvedPath:url.searchParams.get('path')||entity.path}));
    }catch(error){if(state.closing||/closed|disposed|handled|aborted/i.test(error.message))return;state.errors.push(error.message);await route.abort().catch(()=>{});}
  });
  try {
    await page.goto(origin+(mode==='top-rated'?'/discover':entity.path),{waitUntil:'networkidle'});
    if(mode==='top-rated'){
      await page.getByRole('button',{name:'Top-rated shows',exact:true}).click();
      await page.getByRole('button',{name:/^Number 1, Fixture Artist/}).click();
    }
    await page.getByRole('button',{name:'Event details',exact:true}).waitFor();
    const going=page.getByRole('radio',{name:'Going',exact:true}), interested=page.getByRole('radio',{name:'Interested',exact:true});
    if(past){
      assert.equal(await going.count(),0);assert.equal(await interested.count(),0);
      assert.equal(await page.getByRole('button',{name:'Add this show to Going',exact:true}).count(),0);
      if(mode==='saved'){
        await page.getByRole('button',{name:'Remove Attended from this show',exact:true}).click();
        await page.waitForFunction(()=>!document.querySelector('[aria-label="Remove Attended from this show"]'));
        assert.deepEqual(state.writes.map(x=>x.state),[null]);
      }else assert.equal(state.writes.length,0);
    }else{
      await going.waitFor();if(mode!=='multi-day')await interested.waitFor();
      if(mode==='expiry'){
        await page.clock.fastForward(30001);
        await page.getByRole('radio',{name:'Attended',exact:true}).waitFor();
        assert.equal(await going.count(),0);assert.equal(await interested.count(),0);assert.equal(state.writes.length,0);
      }else{
        const target=mode==='multi-day'?'Going':'Interested';
        await page.getByRole('radio',{name:target,exact:true}).click();await page.getByRole('button',{name:`Remove ${target} from this show`,exact:true}).waitFor();
        assert.deepEqual(state.writes.map(x=>x.state),[target.toLowerCase()]);
      }
    }
    await page.screenshot({path:resolve(output,`${mode}-${width}.png`),fullPage:true});
    assert.deepEqual(state.errors,[]);
    return {mode,width,writes:state.writes.map(x=>x.state),passed:true};
  }catch(error){await page.screenshot({path:resolve(output,`FAILED-${mode}-${width}.png`),fullPage:true});writeFileSync(resolve(output,`FAILED-${mode}-${width}.json`),JSON.stringify({...state,text:await page.locator('body').innerText()},null,2));throw error;}
  finally{state.closing=true;await context.close();}
}
const {server,origin}=await localServer();
const browser=await chromium.launch({headless:true,...(process.env.PIT_BROWSER_EXECUTABLE?{executablePath:process.env.PIT_BROWSER_EXECUTABLE}:{})});
const results=[];
try{for(const width of [375,1280])for(const mode of ['top-rated','ended','saved','future','multi-day','expiry']){results.push(await scenario(browser,origin,width,mode));console.log('PASS',width,mode);}writeFileSync(resolve(output,'results.json'),JSON.stringify(results,null,2));}
finally{await browser.close();await new Promise(done=>server.close(done));}
