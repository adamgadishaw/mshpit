#!/usr/bin/env node
// Isolated real-schema benchmark. Never opens or writes the site's data directory.
import {mkdtempSync,rmSync,rmdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {createTopRatedShowService} from "../server/features/discovery/topRatedShowService.js";
const directory=mkdtempSync(join(tmpdir(),"pit-discover-shows-benchmark-"));
process.env.PIT_DATA_DIR=directory;process.env.NODE_ENV="test";
const {db}=await import("../server/db.js");
const at=Date.parse("2026-09-08T12:00:00Z");
const countries=[["CA","Canada"],["US","United States"],["PT","Portugal"],["DE","Germany"],["FR","France"],["GB","United Kingdom"],["JP","Japan"],["AU","Australia"],["NZ","New Zealand"],["NL","Netherlands"]];
try {
  const user=db.prepare("INSERT INTO users(id,email,name,handle,pass_hash,created_at) VALUES (?,?,?,?,?,?)");
  const artist=db.prepare("INSERT INTO artists(norm,name,public_slug,created_at,updated_at) VALUES (?,?,?,?,?)");
  const event=db.prepare(`INSERT INTO tour_dates(id,artist,artist_key,venue,venue_provider_id,source,date,venue_city,venue_country_code,venue_country,event_name,event_timezone,updated_at)
    VALUES (?,?,?,?,?,'ticketmaster',?,?,?,?,?,'UTC',?)`);
  const post=db.prepare(`INSERT INTO posts(id,user_id,artist,artist_key,venue,city,date,overall,review,created_at)
    VALUES (?,?,?,?,?,?,'2026-08-01',4.5,'A public review in an isolated benchmark.',?)`);
  db.exec("BEGIN");
  for(let i=0;i<500;i++)user.run("benchmark-user-"+i,"benchmark-"+i+"@example.invalid","Benchmark "+i,"benchmark-"+i,"not-a-login",at);
  for(let i=0;i<250;i++)artist.run("benchmark-act-"+i,"Benchmark Act "+i,"benchmark-act-"+i,at,at);
  for(let i=0;i<50_000;i++) {
    const show=i%100,artistNumber=i<100?show:100+i%150;
    const [code,country]=countries[show%10],city="Benchmark City "+show;
    event.run("benchmark-event-"+i,"Benchmark Act "+artistNumber,"benchmark-act-"+artistNumber,"Benchmark Venue "+show,"benchmark-venue-"+show,
      i<100?"2026-08-01":"2026-10-01",city,code,country,"Benchmark live",i<100?1:at+i);
    if(i<5000)post.run("benchmark-post-"+i,"benchmark-user-"+i%500,"Benchmark Act "+show,"benchmark-act-"+show,"Benchmark Venue "+show,city,at+i);
  }
  db.exec("COMMIT");
  let candidateReads=0,providerReads=0;
  const database={prepare(sql) {
    const statement=db.prepare(sql);
    return {all(...args) {
      if(sql.includes("FROM posts p"))candidateReads++;
      if(sql.includes("tour_dates"))providerReads++;
      return statement.all(...args);
    },get:(...args)=>statement.get(...args)};
  }};
  const service=createTopRatedShowService({database,clock:()=>at}),timings=[],rows=[];
  for(const [,country] of countries) {
    const started=performance.now(),result=service.read({country,limit:24});
    timings.push(performance.now()-started);rows.push({country,shows:result.length});
  }
  const warmStarted=performance.now();
  for(const [,country] of countries)service.read({country,limit:24});
  const warmMs=performance.now()-warmStarted;
  console.log(JSON.stringify({events:50_000,reviews:5000,countries:10,candidateReads,providerReads,
    countrySwitchTotalMs:Number(timings.reduce((sum,n)=>sum+n,0).toFixed(2)),
    firstCountryMs:Number(timings[0].toFixed(2)),laterCountriesMs:Number(timings.slice(1).reduce((sum,n)=>sum+n,0).toFixed(2)),
    warmCountrySweepMs:Number(warmMs.toFixed(2)),rows,integrity:db.prepare("PRAGMA quick_check").get()},null,2));
}finally {
  db.close();const resolved=resolve(directory);
  if(dirname(resolved)!==resolve(tmpdir())||!resolved.includes("pit-discover-shows-benchmark-"))throw new Error("Unexpected benchmark directory.");
  for(const file of ["pit.db","pit.db-wal","pit.db-shm"])rmSync(join(resolved,file),{force:true});
  try{rmdirSync(resolved);}catch{/* Preserve any unrelated platform-created file. */}
}
