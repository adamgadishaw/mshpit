import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import * as domain from '../domain/videoPoster.mjs';
import * as guards from './videoPosterOperationGuard.mjs';
const require=createRequire(import.meta.url);
const source=readFileSync(new URL('./videoPoster.web.js',import.meta.url),'utf8');
const code=require('@babel/core').transformSync(source,{babelrc:false,configFile:false,plugins:[require('@babel/plugin-transform-modules-commonjs')]}).code;
const asset={uri:'blob:synthetic-local-clip',type:'video',fileName:'fixture.webm'};
const tick=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
function fixture(){
  const loads=[],decodes=[],releases=[],module={exports:{}};
  const implementation={generateVideoPosterAsset:async(...args)=>{decodes.push(args);return {uri:'blob:owned-cover'};},releaseVideoPosterAsset:value=>{releases.push(value);return true;}};
  const modules={'../domain/videoPoster.mjs':domain,'./videoPosterOperationGuard.mjs':guards,'./lazyWithRetry':{loadChunk:(factory,options)=>{
    assert.match(String(factory),/videoPosterWebImplementation\.mjs/);assert.equal(options.reload,null);
    return new Promise((resolve,reject)=>loads.push({resolve:()=>resolve(implementation),reject}));
  }}};
  new Function('require','module','exports','document','URL',code)(name=>{assert.ok(modules[name],name);return modules[name];},module,module.exports,{},{});
  return {...module.exports,loads,decodes,releases};
}
test('poster facade does not load decoder code until a valid operation; cancellation before load has no work',async()=>{
  const f=fixture();assert.equal(f.releaseVideoPosterAsset({uri:'blob:unknown'}),false);assert.equal(f.loads.length,0);
  await assert.rejects(f.generateVideoPosterAsset({}),{code:domain.VIDEO_POSTER_ERROR_CODES.sourceInvalid});
  const controller=new AbortController();controller.abort();
  await assert.rejects(f.generateVideoPosterAsset(asset,{signal:controller.signal}),{code:domain.VIDEO_POSTER_ERROR_CODES.aborted});
  assert.equal(f.loads.length,0);assert.equal(f.decodes.length,0);
});
test('cancelled chunk load never starts decode when the module arrives late',async()=>{
  const f=fixture(),controller=new AbortController();
  const work=f.generateVideoPosterAsset(asset,{signal:controller.signal});const rejection=assert.rejects(work,{code:domain.VIDEO_POSTER_ERROR_CODES.aborted});
  controller.abort();await rejection;f.loads[0].resolve();await tick();assert.equal(f.decodes.length,0);
});
test('original poster deadline includes a stalled decoder chunk and prevents late media work',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  const f=fixture(),work=f.generateVideoPosterAsset(asset,{timeoutMs:3000});
  const rejection=assert.rejects(work,{code:domain.VIDEO_POSTER_ERROR_CODES.timeout});
  t.mock.timers.tick(3001);await rejection;f.loads[0].resolve();await tick();assert.equal(f.decodes.length,0);
});
test('successful loading retains asset/options snapshot, exact remaining deadline, and owned release',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  const f=fixture(),controller=new AbortController(),input={...asset},options={signal:controller.signal,timeoutMs:10000};
  const work=f.generateVideoPosterAsset(input,options);input.uri='blob:successor';options.signal=new AbortController().signal;
  t.mock.timers.tick(1500);f.loads[0].resolve();const output=await work;
  assert.equal(f.decodes[0][0].uri,asset.uri);assert.equal(f.decodes[0][2].normalized.signal,controller.signal);
  assert.equal(f.decodes[0][2].normalized.explicitTime,false,'loading must not turn automatic cover selection into an explicit-frame request');
  assert.equal(f.decodes[0][2].guard.remainingMs(),8500);
  assert.equal(f.releaseVideoPosterAsset(output),true);assert.deepEqual(f.releases,[output]);
  await f.generateVideoPosterAsset(asset);assert.equal(f.loads.length,1,'only code is cached');assert.equal(f.decodes.length,2);
});
test('failed code load remains an ordinary retryable poster failure and a later request can retry',async()=>{
  const f=fixture(),work=f.generateVideoPosterAsset(asset);const rejection=assert.rejects(work,{code:domain.VIDEO_POSTER_ERROR_CODES.encodeFailed});
  f.loads[0].reject(new Error('synthetic offline'));await rejection;assert.equal(f.decodes.length,0);
  const retry=f.generateVideoPosterAsset(asset);f.loads[1].resolve();await retry;assert.equal(f.decodes.length,1);
});
