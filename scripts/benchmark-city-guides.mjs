#!/usr/bin/env node
// Builds an isolated real-schema SQLite fixture; never opens the site database.
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const directory=mkdtempSync(join(tmpdir(),"pit-city-benchmark-"));
process.env.PIT_DATA_DIR=directory;
process.env.NODE_ENV="test";
const {db}=await import("../server/db.js");
const {createCityGuideRepository}=await import("../server/features/cities/cityGuideRepository.js");
const {backupTableCounts,verifyBackupSnapshot}=await import("./backup-db-verification.mjs");
const at=Date.parse("2026-09-08T12:00:00Z"),events=50_000,posts=10_000,images=2_500;
try {
  db.prepare("INSERT INTO users(id,email,name,handle,pass_hash,created_at) VALUES ('city-benchmark','city-benchmark@example.invalid','Benchmark','city-benchmark','not-a-login',?)").run(at);
  db.prepare("INSERT INTO artists(norm,name,public_slug,created_at,updated_at) VALUES ('city-benchmark-artist','Benchmark Artist','city-benchmark-artist',?,?)").run(at,at);
  const tour=db.prepare(`INSERT INTO tour_dates(id,artist,artist_key,venue,venue_provider_id,source,date,venue_city,venue_country_code,venue_country,event_name,event_timezone,updated_at)
    VALUES (?,'Benchmark Artist','city-benchmark-artist',?,?,'ticketmaster',?,?,?,?,'Benchmark Artist live','UTC',?)`);
  const post=db.prepare(`INSERT INTO posts(id,user_id,artist,artist_key,venue,city,date,overall,review,photos_public,created_at)
    VALUES (?,'city-benchmark','Benchmark Artist','city-benchmark-artist',?,?,?,4,'A public concert review for the isolated performance fixture.',1,?)`);
  const object=db.prepare(`INSERT INTO media_objects(owner_id,object_key,storage_scope,purpose,status,created_at,updated_at)
    VALUES ('city-benchmark',?,?,'post','associated',?,?)`);
  const asset=db.prepare(`INSERT INTO media_assets(id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,original_name,mime_type,byte_size,
    metadata_status,codec_status,status,source_verified_at,render_state,render_variant_id,created_at,updated_at)
    VALUES (?,'city-benchmark',?,'fixture','post','image',?,?,'private','fixture.jpg','image/jpeg',1000,'declared','not_applicable','ready',?,'ready',?,?,?)`);
  const variant=db.prepare(`INSERT INTO media_variants(id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,status,verification_origin,created_at,updated_at)
    VALUES (?,?,'render','fixture','render',?,?,'image/jpeg',1000,800,600,'verified','private_derivative_v1',?,?)`);
  const link=db.prepare("INSERT INTO post_media(post_id,asset_id,position,created_at) VALUES (?,?,0,?)");
  db.exec("BEGIN");
  for(let i=0;i<events;i++) {
    const cityNumber=i%50,city=`Benchmark City ${String(cityNumber).padStart(2,"0")}`;
    const country=[['CA','Canada'],['PT','Portugal'],['DE','Germany']][cityNumber%3];
    const venue=`Benchmark Venue ${i%250}`,date=new Date(at+(i%365-30)*86400000).toISOString().slice(0,10);
    tour.run(`benchmark-${i}`,venue,`venue-${i%250}`,date,city,...country,at);
    if(i<posts)post.run(`benchmark-post-${i}`,venue,city,date,at+i);
    if(i<images) {
      const id=`benchmark-asset-${i}`,source=`private/benchmark-${i}.jpg`,render=`public/benchmark-${i}.jpg`,variantId=`variant-${i}`;
      object.run(source,"private",at,at);object.run(render,"public",at,at);
      asset.run(id,id,source,`https://private.mshpit.com/${source}`,at,variantId,at,at);
      variant.run(variantId,id,render,`https://media.mshpit.com/${render}`,at,at);
      link.run(`benchmark-post-${i}`,id,at);
    }
  }
  db.exec("COMMIT");
  console.log("Synthetic fixture ready; measuring city reads.");
  const repository=createCityGuideRepository(db);
  const time=(work)=>{const started=performance.now(),result=work();return {ms:Math.round((performance.now()-started)*100)/100,result};};
  const cold=time(()=>repository.listCities({limit:100,at}));
  console.log(`City directory cold read: ${cold.ms} ms`);
  const timings=[];let galleryPhotos=0;
  for(let repeat=0;repeat<3;repeat++)for(let cityNumber=0;cityNumber<20;cityNumber++) {
    const countryCode=['CA','PT','DE'][cityNumber%3];
    const timing=time(()=>repository.getGuide({countryCode,citySlug:`benchmark-city-${String(cityNumber).padStart(2,"0")}`,at}));
    timings.push(timing.ms);galleryPhotos+=timing.result.photos.length;
    if(cityNumber===0)console.log(`First city in repeat ${repeat+1}: ${timing.ms} ms`);
  }
  const warm=time(()=>repository.listCities({q:"Benchmark",limit:100,at}));
  timings.sort((a,b)=>a-b);
  const backupPath=join(directory,"city-benchmark-backup.db");
  const baseline=backupTableCounts(db);
  db.prepare("VACUUM INTO ?").run(backupPath);
  const verifiedBackup=verifyBackupSnapshot(backupPath,baseline);
  console.log(JSON.stringify({events,posts,images,cityCount:cold.result.total,directoryColdMs:cold.ms,directoryWarmMs:warm.ms,
    cityReads:timings.length,cityMedianMs:timings[Math.floor(timings.length/2)],cityP95Ms:timings[Math.floor(timings.length*.95)],
    cityMaxMs:timings.at(-1),galleryPhotos,integrity:db.prepare("PRAGMA quick_check").get(),verifiedBackup},null,2));
} finally {
  db.close();
  const resolved=resolve(directory);
  if(dirname(resolved)!==resolve(tmpdir()) || !resolved.includes("pit-city-benchmark-"))throw new Error("Unexpected fixture path; cleanup stopped.");
  for(const file of ["pit.db","pit.db-wal","pit.db-shm","city-benchmark-backup.db"])rmSync(join(resolved,file),{force:true});
  try{rmdirSync(resolved);}catch{/* A platform-created extra file can remain in this isolated temp directory. */}
}
