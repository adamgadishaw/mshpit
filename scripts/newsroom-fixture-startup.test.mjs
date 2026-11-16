import assert from 'node:assert/strict';
import test from 'node:test';
import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PINNED_TIMER_SOURCES, assertPinnedTimerSource, classifyTimerRegistration } from './fixtures/newsroom-fixture-timer-isolation.mjs';
import { assertFixtureStartupPolicy, fixtureStartupEnvironment, ORDINARY_WINDOWS_ENV_KEYS } from './fixtures/newsroom-fixture-startup-policy.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const scratchRoot=join(root,'scripts','fixtures');
test('fixture policy admits only bounded native macOS encoding metadata without widening service access',()=>{
  const env=fixtureStartupEnvironment({NODE_ENV:'production',PIT_ENV:'staging',PIT_SUPPORTED_HTTPS_FIXTURE:'1'});
  for(const platform of ['linux','win32','darwin']) assert.equal(assertFixtureStartupPolicy(env,platform),true);
  const native={...env,__CF_USER_TEXT_ENCODING:'0x1F5:0x0:0x52'};
  assert.equal(assertFixtureStartupPolicy(native,'darwin'),true);
  for(const platform of ['linux','win32']) assert.throws(()=>assertFixtureStartupPolicy(native,platform),/Unexpected fixture environment key/);
  for(const value of ['', 'service-secret', '0x1:0x0', '0x1:0x0:0x0\n', '0x'+'f'.repeat(65)+':0x0:0x0', undefined]) {
    assert.throws(()=>assertFixtureStartupPolicy({...env,__CF_USER_TEXT_ENCODING:value},'darwin'),/Invalid macOS fixture encoding metadata/);
  }
  assert.throws(()=>assertFixtureStartupPolicy({...native,RESEND_API_KEY:'synthetic-secret'},'darwin'),/Unexpected fixture environment key/);
  assert.throws(()=>assertFixtureStartupPolicy({...native,RENDER:'true'},'darwin'),/non-Render/);
  assert.throws(()=>assertFixtureStartupPolicy({...native,CACHE_WARM_ENABLED:'true'},'darwin'),/explicitly disabled/);
});

test('Newsroom fixture pins match current source and reject changed or unknown modules',()=>{
  for(const module of Object.keys(PINNED_TIMER_SOURCES)){
    const bytes=readFileSync(join(root,module));
    assert.doesNotThrow(()=>assertPinnedTimerSource(module,bytes));
    assert.throws(()=>assertPinnedTimerSource(module,Buffer.concat([bytes,Buffer.from('\n// changed')])) ,/pin mismatch/);
  }
  assert.throws(()=>assertPinnedTimerSource('server/api.js',Buffer.from('')),/Unknown pinned/);
});

test('Newsroom timer isolation retains request timers and rejects changed scheduler registrations',()=>{
  for(const [module,name,timeout,interval] of [
    ['server/privacyJournal.js','startPrivacyJournalShipper',60000,300000],
    ['server/features/searchGrowth/searchGrowthService.js','startSearchGrowthScheduler',180000,3600000],
    ['server/venuePhotoEnrichment.js','startVenuePhotoScheduler',180000,900000],
  ])for(const kind of ['timeout','interval']){
    const frame={scriptName:join(root,'server/periodicJobScheduler.js'),functionName:'startPeriodicJob',lineNumber:kind==='timeout'?123:119};
    const owner={scriptName:join(root,module),functionName:name,lineNumber:1};
    const args={kind,delayMs:kind==='timeout'?timeout:interval,frames:[frame,owner],candidateRoot:root,scratchRoot};
    assert.equal(classifyTimerRegistration(args).suppressed,true);
    assert.throws(()=>classifyTimerRegistration({...args,delayMs:1}),/timer delay/);
    assert.throws(()=>classifyTimerRegistration({...args,frames:[{...frame,lineNumber:999},owner]}),/timer callsite/);
    assert.throws(()=>classifyTimerRegistration({...args,frames:[{...frame,scriptName:join(root,'server/api.js')},owner]}),/timer caller/);
    assert.equal(classifyTimerRegistration({...args,frames:[{...owner,functionName:'runOnce'}]}).suppressed,false);
    assert.equal(classifyTimerRegistration({...args,frames:[{...owner,scriptName:join(root,'other.js')}]}).suppressed,false);
  }
});

test('actual Newsroom preload starts the server on loopback with only six scoped timers suppressed', {timeout:30000}, async()=>{
  const directory=mkdtempSync(join(tmpdir(),'pit-newsroom-https-browser-startup-'));
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const origin='https://127.0.0.1:'+port;
  const osEnv=Object.fromEntries(Object.entries(process.env).filter(([name])=>ORDINARY_WINDOWS_ENV_KEYS.includes(name.toUpperCase())));
  const env=fixtureStartupEnvironment({...osEnv,NODE_ENV:'production',PIT_ENV:'staging',PUBLIC_ORIGIN:origin,PORT:String(port),PIT_DATA_DIR:directory,
    PIT_ALLOW_EMPTY_DB_BOOTSTRAP:'true',PIT_SUPPORTED_HTTPS_FIXTURE:'1',NEWSROOM_BROWSER_SESSIONS_ENABLED:'true',
    ADMIN_EMAIL:'bootstrap@example.test',ADMIN_PASSWORD:randomBytes(32).toString('base64url'),NEWS_DESK_ACCOUNT_ID:'https_newsroom_publisher',
    PIT_MEDIA_API_ENABLED:'false',MEDIA_ENDPOINT:origin+'/fixture-storage',MEDIA_PUBLIC_BASE_URL:origin+'/fixture-media',
    MEDIA_BUCKET:'pit-browser-public',MEDIA_SOURCE_BUCKET:'pit-browser-private',MEDIA_REGION:'auto',
    MEDIA_ACCESS_KEY_ID:randomBytes(32).toString('base64url'),MEDIA_SECRET_ACCESS_KEY:randomBytes(32).toString('base64url')});
  const child=fork(join(root,'server/index.js'),[],{cwd:root,env,execArgv:['--max-old-space-size=256','--import',pathToFileURL(join(scratchRoot,'newsroom-ci-browser-preload.mjs')).href],stdio:['ignore','ignore','ignore','ipc']});
  const exited=once(child,'exit');let fixture=false,bound=null,snapshot=null,replyError=null;
  child.on('message',message=>{
    if(message.kind==='fixture')fixture=true; // Never log the ephemeral fixture password.
    if(message.kind==='listener-bound')bound=message.address;
    if(message.kind==='reply'&&message.id===1){replyError=message.error||null;snapshot=message.result;}
  });
  const waitFor=async condition=>{
    const deadline=Date.now()+15000;
    while(!condition()){
      assert.equal(child.exitCode,null,'Newsroom fixture backend must start with current source pins');
      assert.ok(Date.now()<deadline,'Newsroom fixture startup deadline');
      await new Promise(done=>setTimeout(done,25));
    }
  };
  try{
    await waitFor(()=>fixture&&bound);assert.equal(bound,'127.0.0.1');
    const response=await fetch('http://127.0.0.1:'+port+'/api/health',{signal:AbortSignal.timeout(5000)});
    assert.equal(response.status,200);
    child.send({id:1,operation:'snapshot'});await waitFor(()=>snapshot||replyError);assert.equal(replyError,null);
    assert.equal(snapshot.outboundBlocked,0);assert.equal(snapshot.paid,0);assert.equal(snapshot.published,0);
    assert.equal(snapshot.timerIsolation.suppressed.length,6);
    assert.deepEqual([...new Set(snapshot.timerIsolation.suppressed.map(row=>row.scheduler.name))].sort(),['startPrivacyJournalShipper','startSearchGrowthScheduler','startVenuePhotoScheduler']);
    assert.ok(snapshot.timerIsolation.admittedCount>0,'Unrelated startup and request timers remain native');
  }finally{
    if(child.exitCode===null)child.kill('SIGTERM');await exited;
    assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(basename(directory).startsWith('pit-newsroom-https-browser-startup-'));
    rmSync(directory,{recursive:true,force:true});
  }
});
