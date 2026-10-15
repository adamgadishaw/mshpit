#!/usr/bin/env node
// Actual exported UI with loopback-only synthetic API fixtures.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureApiResponse, navigationUser } from "./verify-navigation-browser.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const postId="p_navigation_fixture", postPath="/post/"+postId;
const author={id:"public-fixture-author",name:"Original Fixture Author",handle:"originalfixture",role:"fan"};
const follower={...navigationUser,id:"social-follower",name:"Fixture Follower",handle:"fixturefollower"};
const now=Date.now();
const baseComments=[
 {id:"c_parent",postId,userId:author.id,name:author.name,role:"fan",text:"Fixture parent comment.",at:now-2000,parentId:null,canLike:true},
 {id:"c_reply",postId,userId:author.id,name:author.name,role:"fan",text:"Fixture child reply.",at:now-1000,parentId:"c_parent",canLike:true},
 {id:"c_disabled",postId,userId:author.id,name:author.name,role:"fan",text:"Fixture non-actionable comment.",at:now,parentId:null,canLike:false},
];
async function localServer(){
 const directory=resolve(root,process.env.PIT_NAVIGATION_BROWSER_DIST || "dist"), html=join(directory,"index.html");assert.ok(statSync(html).isFile());
 const mime={".js":"text/javascript",".html":"text/html",".css":"text/css",".png":"image/png",".jpg":"image/jpeg",".webp":"image/webp",".svg":"image/svg+xml",".ttf":"font/ttf",".woff2":"font/woff2"};
 const server=createServer((request,response)=>{
  const url=new URL(request.url,"http://fixture.invalid");
  if(!["GET","HEAD"].includes(request.method)||url.pathname.startsWith("/api/"))return void response.writeHead(405).end();
  let file;try{file=resolve(directory,"."+decodeURIComponent(url.pathname));}catch{return void response.writeHead(400).end();}
  if(file!==directory&&!file.startsWith(directory+sep))return void response.writeHead(400).end();
  try{if(!statSync(file).isFile())file=html;}catch{file=html;}
  response.writeHead(200,{"Content-Type":mime[extname(file)]||"application/octet-stream","Cache-Control":"no-store"});response.end(request.method==="HEAD"?undefined:readFileSync(file));
 });
 await new Promise((done,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",done);});
 return{server,origin:"http://127.0.0.1:"+server.address().port};
}
function post(state,viewer){
 const reposted=state.reposted;
 return{id:postId,userId:author.id,user:author,kind:"status",artist:"Fixture Artist",artistKey:"fixture-artist",venue:"",city:"Toronto",date:"",at:now-60000,createdAt:now-60000,
  text:"Fixture original concert memory.",review:"Fixture original concert memory.",likes:0,comments:3,photos:[],
  reposts:reposted?1:0,reposted:viewer.id===navigationUser.id&&reposted,repostedBy:reposted?[{userId:navigationUser.id,name:navigationUser.name,handle:navigationUser.handle,createdAt:now}]:[]};
}
async function contextFor(browser,origin,width,viewer,state){
 const context=await browser.newContext({viewport:{width,height:1100},isMobile:width<620,hasTouch:width<620,reducedMotion:"reduce",serviceWorkers:"block"});
 const local={errors:[],external:[],requests:[],closing:false};
 await context.addInitScript(({origin,user})=>{if(location.origin!==origin||localStorage.getItem("social-fixture"))return;localStorage.setItem("social-fixture","1");localStorage.setItem("pit_theme","stage");localStorage.setItem("pit.session",JSON.stringify(user));localStorage.setItem("pit.users",JSON.stringify([user]));},{origin,user:viewer});
 const page=await context.newPage();page.setDefaultTimeout(15000);
 page.on("pageerror",error=>local.errors.push(error.message));
 page.on("console",message=>{if(message.type()==="error"&&!/Failed to load resource.*503/.test(message.text()))local.errors.push(message.text());});
 await context.route("**/*",async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
  try{
   if(url.origin!==origin){local.external.push(url.origin);return await route.abort();}
   if(!path.startsWith("/api/"))return await route.continue();
   local.requests.push({path,method,mode:url.searchParams.get("mode")});
   let result;
   if(method==="POST"&&path==="/api/client-errors")result={ok:true};
   else if(method==="POST"&&path==="/api/feed/news-introduction")result={post:null};
   else if(method==="POST"&&path==="/api/feed/revalidate")result={invalidPostIds:[]};
   else if(method==="POST"&&path==="/api/feed/impressions")result={ok:true};
   else if(method==="POST"&&path==="/api/me/notifications/read")result={ok:true};
   else if(method==="POST"&&path==="/api/posts/"+postId+"/repost"){
    assert.equal(req.headers()["x-pit-expected-account"],viewer.id);
    assert.equal(viewer.id,navigationUser.id);const desired=req.postDataJSON().reposted;assert.equal(typeof desired,"boolean");state.reposted=desired;state.repostWrites.push(desired);
    const value=post(state,viewer);result={ok:true,id:postId,reposts:value.reposts,reposted:value.reposted,repostedBy:value.repostedBy};
   }else if(method==="POST"&&path.startsWith("/api/posts/"+postId+"/comments/")&&path.endsWith("/like")){
    assert.equal(req.headers()["x-pit-expected-account"],viewer.id);
    const id=path.split("/").at(-2);assert.ok(["c_parent","c_reply"].includes(id),"Disabled comments cannot be liked.");
    const desired=req.postDataJSON().liked;assert.equal(typeof desired,"boolean");
    if(id==="c_reply"&&state.replyAttempts++===0)return await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Fixture service unavailable",code:"SERVICE_UNAVAILABLE"})});
    state.liked[id]=desired;state.likeWrites.push({id,desired});result={ok:true,id,postId,likes:desired?1:0,liked:desired};
   }else{
    assert.equal(method,"GET","Unexpected mutation: "+method+" "+path);
    if(path==="/api/me")result={user:viewer};
    else if(path==="/api/me/following")result={following:viewer.id===follower.id?[navigationUser.id]:[]};
    else if(path==="/api/resolve"&&url.searchParams.get("path")===postPath)result={entity:{kind:"show",id:postId,path:postPath}};
    else if(path==="/api/posts/"+postId)result={post:post(state,viewer)};
    else if(path==="/api/posts/"+postId+"/comments")result={comments:baseComments.map(c=>({...c,likes:state.liked[c.id]?1:0,liked:!!state.liked[c.id]}))};
    else if(path==="/api/me/notifications")result={notifications:viewer.id===navigationUser.id?[
     {id:"n_comment_like",type:"comment_like",actorId:author.id,actorName:"Fixture Comment Fan",postId,commentId:"c_parent",ts:now,read:false},
     {id:"n_repost",type:"repost",actorId:author.id,actorName:"Fixture Repost Fan",postId,ts:now-100,read:false},
    ]:[]};
    else if(path==="/api/feed"&&url.searchParams.get("mode")==="following")result={posts:viewer.id===follower.id&&state.reposted?[post(state,viewer)]:[],nextCursor:null};
    else if(["/api/feed","/api/feed/for-you","/api/feed/recommended"].includes(path))result={posts:[],hasMore:false,nextCursor:null,hiddenPostIds:[]};
    else result=fixtureApiResponse(path,{member:true,method,resolvedPath:url.searchParams.get("path")||undefined});
   }
   await route.fulfill({contentType:"application/json",body:JSON.stringify(result)});
  }catch(error){if(local.closing&&/closed|disposed|handled|aborted|canceled|cancelled/i.test(error.message))return;local.errors.push(error.message);await route.abort().catch(()=>{/* Fixture teardown may already have closed this route. */});}
 });
 return{page,local,close:async()=>{local.closing=true;await context.close();}};
}
async function scenario(browser,origin,width){
 const state={liked:{},reposted:false,replyAttempts:0,likeWrites:[],repostWrites:[]};const main=await contextFor(browser,origin,width,navigationUser,state);
 let current=main;
 try{
  const page=main.page;
  await page.goto(origin+postPath,{waitUntil:"networkidle"});
  await page.getByText("Fixture child reply.",{exact:true}).waitFor();
  assert.equal(await page.getByRole("button",{name:"Like comment, 0",exact:true}).count(),2,"Parent and reply are actionable, held comment is not.");
  await page.getByRole("button",{name:"Like comment, 0",exact:true}).first().click();
  await page.getByRole("button",{name:"Unlike comment, 1",exact:true}).waitFor();
  await page.getByRole("button",{name:"Like comment, 0",exact:true}).click();
  await page.getByText("Not saved. Try again.",{exact:true}).waitFor();
  await page.getByRole("button",{name:"Like comment, 0",exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('[role="button"]')].filter(el=>el.getAttribute("aria-label")==="Unlike comment, 1").length===2);
  assert.deepEqual(state.likeWrites.map(x=>x.id),["c_parent","c_reply"]);assert.equal(state.replyAttempts,2);
  await page.getByRole("button",{name:"Repost, 0",exact:true}).first().click();
  await page.getByRole("button",{name:"Undo repost, 1",exact:true}).first().waitFor();
  await page.getByRole("button",{name:"Undo repost, 1",exact:true}).first().click();
  await page.getByRole("button",{name:"Repost, 0",exact:true}).first().waitFor();
  await page.getByRole("button",{name:"Repost, 0",exact:true}).first().click();
  await page.getByRole("button",{name:"Undo repost, 1",exact:true}).first().waitFor();
  assert.deepEqual(state.repostWrites,[true,false,true]);
  for(const label of ["Fixture Comment Fan liked your comment","Fixture Repost Fan reposted your post"]){
   await page.goto(origin+"/feed",{waitUntil:"networkidle"});
   await page.getByRole("button",{name:/^Activity(?:,|$)/}).first().click();
   await page.getByRole("button",{name:label,exact:true}).click();
   await page.getByText("Fixture original concert memory.",{exact:true}).last().waitFor();
   await page.getByText("Fixture child reply.",{exact:true}).waitFor();
   assert.equal(new URL(page.url()).pathname,postPath);
  }
  assert.deepEqual(main.local.errors,[]);assert.deepEqual(main.local.external,[]);
  await main.close();
  current=await contextFor(browser,origin,width,follower,state);
  await current.page.goto(origin+"/feed",{waitUntil:"networkidle"});
  await current.page.getByRole("tab",{name:"Following feed",exact:true}).click();
  await current.page.getByText("Fixture original concert memory.",{exact:true}).last().waitFor();
  await current.page.getByText(navigationUser.name+" reposted",{exact:true}).waitFor();
  await current.page.getByText(author.name,{exact:true}).first().waitFor();
  assert.ok(current.local.requests.some(call=>call.path==="/api/feed"&&call.mode==="following"));
  assert.deepEqual(current.local.errors,[]);assert.deepEqual(current.local.external,[]);
  return{width,commentLikes:state.likeWrites.length,repostToggles:state.repostWrites.length,notificationDestinations:2,followingOriginalAuthor:true};
 }catch(error){throw new Error(JSON.stringify({width,message:error.message,errors:current.local.errors,external:current.local.external,requests:current.local.requests.slice(-18)},null,2));}
 finally{await current.close();}
}
const require=createRequire(import.meta.url),{chromium}=require(process.env.PIT_PLAYWRIGHT_MODULE||"playwright");
const{server,origin}=await localServer(),browser=await chromium.launch({headless:true,...(process.env.PIT_BROWSER_EXECUTABLE?{executablePath:process.env.PIT_BROWSER_EXECUTABLE}:{})});
try{for(const width of[390,1280])console.log(JSON.stringify(await scenario(browser,origin,width)));}
finally{await browser.close();await new Promise(done=>server.close(done));}
