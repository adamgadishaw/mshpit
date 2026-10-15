#!/usr/bin/env node
// Real exported Discover, synthetic public fixtures, no production requests or writes.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fixtureApiResponse } from './verify-navigation-browser.mjs';
const root=resolve(import.meta.dirname,'..'), directory=resolve(root,'dist');
const phase=process.argv[2]||'after', output=resolve(root,'.tmp/card-followup',phase);
mkdirSync(output,{recursive:true});
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PIT_PLAYWRIGHT_MODULE||'playwright');
const day=n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
const title='The Extraordinary Orchestra of Very Long Artist Names';
const shows=Array.from({length:8},(_,i)=>({id:`tm_card_followup_${i}`,artist:i?`Fixture Act ${i}`:title,eventKind:'concert',venue:'The Grand Ballroom and Centre for Live Performing Arts',city:'Toronto',place:'Toronto, Ontario, Canada',venueCountry:'Canada',venueCountryCode:'CA',date:day(i+1),source:'ticketmaster',providerActive:true,releaseAt:0}));
const edition={id:'fixture-fest:2027',festivalSlug:'fixture-fest',festivalName:'Fixture Fest',name:'Extraordinarily Long Festival Name for a Weekend of Music and Arts',startDate:'2027-07-29',endDate:'2027-08-01',days:['2027-07-29','2027-07-30','2027-07-31','2027-08-01'],venue:'Fixture Park',city:'Toronto',countryCode:'CA',imageUrl:'https://festival-artwork.invalid/broken.png',lineupCount:0,headliners:[],going:0};
const mime={'.js':'text/javascript','.html':'text/html','.png':'image/png','.svg':'image/svg+xml'};
const server=createServer((request,response)=>{let file=resolve(directory,'.'+new URL(request.url,'http://local').pathname);if(!file.startsWith(directory+sep))file=resolve(directory,'index.html');try{if(!statSync(file).isFile())file=resolve(directory,'index.html')}catch{file=resolve(directory,'index.html')}response.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream'});response.end(readFileSync(file));});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.PIT_BROWSER_EXECUTABLE?{executablePath:process.env.PIT_BROWSER_EXECUTABLE}:{})});const results=[];
try{
 for(const width of [320,390,1440])for(const theme of ['stage','daylight']){
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce',serviceWorkers:'block'}), errors=[];
  let releaseImage;const imageReady=new Promise(done=>{releaseImage=done;});
  await context.addInitScript(theme=>localStorage.setItem('pit_theme',theme),theme);
  await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());
   if(url.hostname==='festival-artwork.invalid'){await imageReady;return route.fulfill({status:404,body:'Missing synthetic artwork'});}
   if(url.origin!==origin)return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();
   try{assert.equal(request.method(),'GET','Fixture browsing must not write data.');let body;
    if(url.pathname==='/api/tourdates')body={tourDates:shows,nextCursor:null,range:{days:30,through:day(30)}};
    else if(url.pathname==='/api/festivals')body={upcoming:[edition,{...edition,id:'second-festival:2027',festivalSlug:'second-festival',name:'Short Festival',startDate:'2027-08-20',endDate:'2027-08-21',imageUrl:null}],festivals:[]};
    else if(url.pathname==='/api/festivals/fixture-fest')body={festival:{slug:'fixture-fest',name:'Fixture Fest',city:'Toronto',country:'CA'},upcoming:[{...edition,lineup:[]}],past:[],expected:null,reviews:[],reviewStats:{reviews:0,average:null}};
    else body=fixtureApiResponse(url.pathname,{method:request.method(),resolvedPath:url.searchParams.get('path')||undefined});
    await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
   }catch(error){errors.push(error.message);await route.abort();}
  });
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/discover');await page.getByRole('radio',{name:'Show events as list',exact:true}).click();
  const weeks=page.getByRole('tablist',{name:'Weeks',exact:true}).getByRole('tab');await weeks.first().waitFor();
  const weekHeight=(await weeks.first().boundingBox()).height;
  const row=page.getByRole('link',{name:new RegExp('^Open '+title+' at')}).first();await row.waitFor();
  const titleHeight=(await row.getByText(title,{exact:true}).boundingBox()).height;
  await row.screenshot({path:resolve(output,`${width}-${theme}-event-row.png`)});
  if(phase==='after'){assert.ok(weekHeight>=44);if(width<620)assert.ok(titleHeight>=39,'Long mobile event titles get two lines.');}
  await page.getByRole('tab',{name:'Festivals',exact:true}).click();
  const card=page.getByRole('link',{name:new RegExp('^'+edition.name+',')}).first();await card.waitFor();
  // A pending or failed image must keep the existing branded backdrop visible.
  const loadingFallback=await card.locator('svg').count();
  releaseImage();
  if(phase==='after')await card.locator('img').waitFor({state:'hidden'});
  else await page.waitForTimeout(250);
  const href=await card.getAttribute('href'), fallback=await card.locator('svg').count();
  await card.screenshot({path:resolve(output,`${width}-${theme}-festival-card.png`)});
  if(phase==='after'){assert.equal(href,'/festival/fixture-fest');assert.ok(loadingFallback>0,'Loading artwork has a backdrop.');assert.ok((await page.getByRole('button',{name:'All dates, 2 festivals',exact:true}).boundingBox()).height>=44,'Month filters are touch-sized.');assert.ok(fallback>0,'Failed artwork uses the existing branded backdrop.');assert.equal(await card.locator('img').count(),0,'The failed image is removed instead of covering the fallback.');const nextTab=context.waitForEvent('page');await card.click({modifiers:['Control']});const preview=await nextTab;await preview.waitForURL('**/festival/fixture-fest');await preview.getByRole('heading',{name:edition.name,exact:true}).first().waitFor();await preview.close();assert.equal(new URL(page.url()).pathname,'/discover');await card.focus();await page.keyboard.press('Enter');await page.waitForURL('**/festival/fixture-fest');await page.getByRole('heading',{name:edition.name,exact:true}).first().waitFor();await page.goBack();await page.getByRole('tab',{name:'Festivals',exact:true}).waitFor();}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  results.push({width,theme,weekHeight,titleHeight,href,loadingFallback,fallback,errors});await context.close();
 }
 writeFileSync(resolve(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));assert.ok(results.every(x=>!x.errors.length));
}finally{await browser.close();await new Promise(done=>server.close(done));}
