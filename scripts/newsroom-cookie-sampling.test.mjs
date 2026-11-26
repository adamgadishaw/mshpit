import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Execute the actual acceptance callback without launching a browser or trusting
// a certificate on the developer machine. The status response renews the jar.
const source=readFileSync(new URL('./verify-newsroom-ci-browser.mjs',import.meta.url),'utf8');
const marker="await check('Explicit opt-in sets separate Secure HttpOnly host-only Lax cookie',";
const start=source.indexOf(marker);
assert.ok(start>=0);
const end=source.indexOf("\n  const headline=",start);
assert.ok(end>start);
const callback=source.slice(start+marker.length,end).trim().replace(/\);$/u,'');

async function acceptance({stale=false,attributes={},statusCode=200,visible=false}={}) {
  const expiresAt=Date.UTC(2026,10,16,2,54,51,950)+7*86400000;
  let cookie={name:'__Host-pit_newsroom',expires:Math.floor(expiresAt/1000),secure:true,httpOnly:true,sameSite:'Lax',path:'/',domain:'127.0.0.1',...attributes};
  const events=[];
  const result={};
  const run=runInNewContext(callback,{
    assert,result,origin:'https://127.0.0.1',
    main:{evaluate:async()=>visible},
    context:{cookies:async()=>{events.push('cookie');return [{...cookie}];}},
    api:async(_page,path)=>{
      assert.equal(path,'/api/newsroom-session/status');
      events.push('status');
      // 200 ms renewal plus the old cookie's 950 ms truncation exceeds 1100 ms.
      if(!stale)cookie={...cookie,expires:Math.floor((expiresAt+200)/1000)};
      return {status:statusCode,data:{expiresAt:expiresAt+200}};
    },
  });
  await run();
  return {events,result};
}

test('acceptance samples the renewed cookie after status across a second boundary',async()=>{
  const {events,result}=await acceptance();
  assert.deepEqual(events,['status','cookie']);
  assert.equal(result.cookieAttributes.httpOnly,true);
});

test('acceptance still rejects a stale cookie outside the unchanged expiry tolerance',async()=>{
  await assert.rejects(acceptance({stale:true}),/cookieExpiresAt.*statusExpiresAt/u);
});

test('acceptance still requires a successful status response',async()=>{
  await assert.rejects(acceptance({statusCode:401}),{name:'AssertionError'});
});

test('acceptance preserves every cookie security attribute and script invisibility',async()=>{
  for(const attributes of [{name:'pit_newsroom'},{secure:false},{httpOnly:false},{sameSite:'None'},{path:'/newsroom'},{domain:'.example.test'}]) {
    await assert.rejects(acceptance({attributes}),{name:'AssertionError'});
  }
  await assert.rejects(acceptance({visible:true}),{name:'AssertionError'});
});
