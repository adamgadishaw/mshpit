// Loopback-only QA for the actual exported app; no application DB or writes to
// public services. Fixtures/fixed captures stay the default. A separately gated
// local opt-in can retrieve public catalogue pages on reload/manual Retry only.
// No provider credentials, upstream-provider calls, polling or deployment.
import {createServer} from "node:http";
import {readFileSync,statSync,mkdirSync,writeFileSync,renameSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {resolve,extname,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {gzipSync} from "node:zlib";
import {fixtureApiResponse} from "./verify-navigation-browser.mjs";
import {independentMapVenueRegistry} from "../src/domain/independentMapVenueRegistry.mjs";
import {mapLibrePreviewCspSources} from "../server/mapLibrePreviewCsp.js";
import {compactVenueMapEvents} from "../server/venueMapCatalogueProjection.mjs";
import {createVenueMapPreviewRefresh,venueMapLiveRefreshEnabled} from "../server/venueMapPreviewRefresh.mjs";

const root=fileURLToPath(new URL("../",import.meta.url));
const directory=resolve(root,process.env.MSHPIT_MAPLIBRE_EXPORT_DIR||".tmp/maplibre-export");
const basePort=Number(process.env.MSHPIT_MAPLIBRE_PREVIEW_BASE_PORT||43972);
if(!Number.isInteger(basePort)||basePort<1024||basePort>65531)throw new Error("Invalid local review port");
const cataloguePreview=process.env.MSHPIT_MAPLIBRE_CATALOGUE_PREVIEW==="1";
const originalStyle=JSON.parse(readFileSync(resolve(root,".tmp/maplibre-style.json"),"utf8"));
const date=`${new Date().getUTCFullYear()+1}-11-15`;
const fixtureEvents=[...independentMapVenueRegistry.filter(venue=>venue.place==="Toronto, Ontario, Canada").map((venue,index)=>({id:`map-review-${index}`,artist:"Local QA fixture - no real show",eventName:"Local QA fixture - no real show",artistKey:"local-qa-fixture",venue:venue.name,source:"map-review-fixture",providerVenueId:`review-${index}`,place:venue.place,venueCity:"Toronto",venueRegion:"Ontario",venueCountry:"Canada",venueCountryCode:"CA",lat:null,lng:null,date,providerActive:true,releaseAt:0})),
  {id:"review-unverified",artist:"Local QA fixture — no real show",venue:"A Unverified QA Room",source:"map-review-fixture",providerVenueId:"review-unknown",place:"Toronto, Ontario, Canada",venueCity:"Toronto",venueRegion:"Ontario",venueCountry:"Canada",venueCountryCode:"CA",lat:43.65,lng:-79.38,date,providerActive:true},
  {id:"review-lisbon",artist:"Local QA fixture — no real show",venue:"Unverified Lisbon QA Room",source:"map-review-fixture",providerVenueId:"review-lisbon",place:"Lisbon, Portugal",venueCity:"Lisbon",venueCountry:"Portugal",venueCountryCode:"PT",lat:38.72,lng:-9.14,date,providerActive:true}];
const snapshot=cataloguePreview?JSON.parse(readFileSync(resolve(root,".tmp/maplibre-live-tourdates.json"),"utf8")):null;
const events=cataloguePreview?snapshot.tourDates:fixtureEvents;
if(!Array.isArray(events))throw new Error("Missing public event snapshot");
const compactEvents=compactVenueMapEvents(events,{fetchedAt:snapshot?.capturedAt||new Date().toISOString(),pages:snapshot?.pages||1});
const compactJson=Buffer.from(JSON.stringify(compactEvents));
const compactGzip=gzipSync(compactJson,{level:9});
const liveRefreshEnabled=venueMapLiveRefreshEnabled(process.env);
const refreshDirectory=resolve(root,".tmp/maplibre-refresh-snapshots");
const latestPath=resolve(root,".tmp/maplibre-live-refresh-latest.json");
let refreshSnapshot=snapshot;
if(liveRefreshEnabled){
  try{
    const latest=JSON.parse(readFileSync(latestPath,"utf8"));
    if(!/^[A-Za-z0-9_.-]+\.json$/u.test(latest.snapshotFile))throw new Error("Invalid capture filename");
    const candidate=JSON.parse(readFileSync(resolve(refreshDirectory,latest.snapshotFile),"utf8"));
    if(candidate.complete!==true||candidate.sourceOrigin!=="https://www.mshpit.com"||!Array.isArray(candidate.tourDates)||!Number.isFinite(Date.parse(candidate.capturedAt)))throw new Error("Invalid capture receipt");
    refreshSnapshot=candidate;
  }catch(error){if(error.code!=="ENOENT")console.warn("Latest local refresh capture could not be read; keeping the original capture.");}
}
const liveCatalogue=liveRefreshEnabled?createVenueMapPreviewRefresh({snapshot:refreshSnapshot,saveSnapshot:(next,receipt)=>{
  mkdirSync(refreshDirectory,{recursive:true});
  const id=`${next.capturedAt.replace(/[:.]/gu,"-")}-${randomUUID()}`;
  const snapshotFile=`${id}.json`,receiptFile=`${id}.receipt.json`;
  writeFileSync(resolve(refreshDirectory,snapshotFile),JSON.stringify(next),{flag:"wx"});
  writeFileSync(resolve(refreshDirectory,receiptFile),JSON.stringify({...receipt,snapshotFile},null,2),{flag:"wx"});
  const temporary=`${latestPath}.${randomUUID()}.tmp`;
  writeFileSync(temporary,JSON.stringify({snapshotFile,receiptFile,capturedAt:next.capturedAt},null,2),{flag:"wx"});
  renameSync(temporary,latestPath);
  console.log(`Public catalogue retrieved ${next.capturedAt}: ${receipt.rows} events, ${receipt.venueCount} venue groups, ${receipt.pages} sequential pages. Receipt: .tmp/maplibre-refresh-snapshots/${receiptFile}`);
}}):null;
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript",".mjs":"text/javascript",".css":"text/css",".json":"application/json",".png":"image/png",".jpg":"image/jpeg",".svg":"image/svg+xml",".ttf":"font/ttf",".woff2":"font/woff2"};
for(const [offset,mode] of [[0,"normal"],[1,"tile-outage"],[2,"chunk-outage"],[3,"production-csp"],[4,"catalogue-outage"]]){
  const port=basePort+offset;
  const additions=mapLibrePreviewCspSources({NODE_ENV:mode==="production-csp"?"production":"development",MSHPIT_WEB_MAPLIBRE_PREVIEW:"1"});
  const csp=[`default-src 'self'`,`script-src 'self' ${additions.script.join(" ")}`,`style-src 'self' 'unsafe-inline' ${additions.style.join(" ")}`,`connect-src 'self' ${additions.connect.join(" ")}`,`img-src 'self' https://tiles.openfreemap.org data: blob:`,`font-src 'self' https://tiles.openfreemap.org data:`,`worker-src 'self' blob:`,`object-src 'none'`,`base-uri 'self'`,`frame-ancestors 'none'`].join("; ");
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,`http://127.0.0.1:${port}`);
    res.setHeader("Cache-Control","no-store");res.setHeader("Content-Security-Policy",csp);res.setHeader("X-Content-Type-Options","nosniff");
    if(!["GET","HEAD"].includes(req.method)){res.writeHead(405);res.end();return;}
    if(url.pathname.startsWith("/unavailable-tile/")){res.writeHead(503);res.end("Deliberate local tile outage");return;}
    if(url.pathname==="/mshpit-maplibre/preview-style.json"){
      const style=structuredClone(originalStyle);
      if(mode==="tile-outage")for(const [key,source] of Object.entries(style.sources))if(source.type==="vector")style.sources[key]={type:"vector",tiles:[`http://127.0.0.1:${port}/unavailable-tile/{z}/{x}/{y}.pbf`],minzoom:0,maxzoom:14,attribution:"© OpenMapTiles · © OpenStreetMap contributors"};
      res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify(style));return;
    }
    if(mode==="chunk-outage"&&/\/MapLibreVenueMap-[^/]+\.js$/.test(url.pathname)){res.writeHead(503);res.end("Deliberate local lazy chunk outage");return;}
    if(mode==="catalogue-outage"&&url.pathname==="/mshpit-maplibre/venue-catalogue.json"){res.writeHead(503);res.end("Deliberate local catalogue outage");return;}
    if(url.pathname.startsWith("/api/")){
      if(url.pathname==="/api/tourdates"&&url.searchParams.get("view")==="venue-map"){
        const useLiveRefresh=liveRefreshEnabled&&mode!=="production-csp";
        if(url.searchParams.has("refresh")&&(!useLiveRefresh||url.searchParams.get("refresh")!=="1")){
          res.writeHead(400,{"Content-Type":"application/json"});res.end(JSON.stringify({error:{code:"LOCAL_REFRESH_DISABLED",message:"Explicit refresh is available only in the opted-in local development preview."}}));return;
        }
        if(useLiveRefresh&&req.method==="GET"){
          const controller=new AbortController();
          const disconnected=()=>{if(!res.writableEnded)controller.abort();};
          res.once("close",disconnected);
          // Headers arrive before a possible 90-second source scan, allowing
          // only the loopback loader to use its bounded local body deadline.
          const gzip=/\bgzip\b/u.test(req.headers["accept-encoding"]||"");
          res.setHeader("Vary","Accept-Encoding");if(gzip)res.setHeader("Content-Encoding","gzip");
          res.writeHead(200,{"Content-Type":"application/json","X-Mshpit-Local-Refresh":"1"});res.flushHeaders();
          try{
            const result=await liveCatalogue.get({signal:controller.signal,refresh:url.searchParams.get("refresh")==="1"});
            if(!controller.signal.aborted){const body=Buffer.from(JSON.stringify(result));res.end(gzip?gzipSync(body,{level:9}):body);}
          }catch{if(!res.destroyed)res.destroy();}
          finally{res.removeListener("close",disconnected);}
          return;
        }
        const gzip=/\bgzip\b/u.test(req.headers["accept-encoding"]||"");
        res.setHeader("Vary","Accept-Encoding");if(gzip)res.setHeader("Content-Encoding","gzip");
        res.writeHead(200,{"Content-Type":"application/json"});res.end(req.method==="HEAD"?undefined:gzip?compactGzip:compactJson);return;
      }
      let data;
      if(url.pathname==="/api/tourdates"){
        if(url.searchParams.get("view")==="venue-map")data=compactEvents;
        else if(url.searchParams.get("scope")==="all-upcoming"){
          const offset=Number((url.searchParams.get("after")||"0").replace(/^review[:_]/u,""));
          const page=events.slice(offset,offset+500);
          data={tourDates:page,nextCursor:offset+500<events.length?`review_${offset+500}`:null};
        }else{
          const through=Date.now()+30*86400000;
          data={tourDates:cataloguePreview?events.filter(row=>Date.parse(row.date)<=through).slice(0,500):events};
        }
      }
      else if(url.pathname==="/api/discover/overview")data={chart:{rows:[],source:"fixture"},genres:[],countries:[{country:"Canada",count:5},{country:"Portugal",count:1}],eventCoverage:{total:6,venueTotal:6,countries:[{country:"Canada",count:5},{country:"Portugal",count:1}]}};
      else {
        try { data=fixtureApiResponse(url.pathname,{member:false,method:req.method,query:url.searchParams}); }
        catch { res.writeHead(501,{"Content-Type":"application/json"});res.end(JSON.stringify({error:{code:"LOCAL_PREVIEW_ROUTE_UNAVAILABLE",message:"This local map preview does not provide that detail service."}}));return; }
      }
      res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify(data??{}));return;
    }
    let target;
    try { target=resolve(directory,"."+decodeURIComponent(url.pathname)); } catch {res.writeHead(400);res.end();return;}
    if(target!==directory&&!target.startsWith(directory+sep)){res.writeHead(403);res.end();return;}
    try{if(!statSync(target).isFile())target=resolve(directory,"index.html");}catch{target=resolve(directory,"index.html");}
    res.writeHead(200,{"Content-Type":mime[extname(target)]||"application/octet-stream"});res.end(req.method==="HEAD"?undefined:readFileSync(target));
  });
  server.listen(port,"127.0.0.1",()=>console.log(`${mode}: http://127.0.0.1:${port}/discover`));
}
