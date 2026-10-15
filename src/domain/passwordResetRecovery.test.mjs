import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from '@babel/parser';
const source=readFileSync(new URL('../store.js',import.meta.url),'utf8');
const ast=parse(source,{sourceType:'module',plugins:['jsx']});
const store=ast.program.body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.id?.name==='StoreProvider').declaration;
const callback=store.body.body.flatMap(n=>n.type==='VariableDeclaration'?n.declarations:[]).find(n=>n.id.name==='resetPassword').init;
const makeReset=performAuthentication=>new Function('performAuthentication','api','logout','absorbServerUser',`return (${source.slice(callback.start,callback.end)});`)(performAuthentication,()=>{},()=>{},()=>{});

test('reset transport and server failures preserve an honest uncertain outcome with a deliberate login path',async()=>{
  for(const status of [0,500,503]){
    const error=Object.assign(new Error('synthetic failure'),{status});
    const result=await makeReset(async()=>{throw error;})('synthetic-token','Synthetic-password1');
    assert.equal(result.ok,false);assert.equal(result.outcome,'uncertain');
    assert.match(result.error,/password may already have changed/);assert.match(result.error,/logging in with the new password/);
  }
});

test('invalid links and rate limits preserve explicit rejection and successful reset still succeeds',async()=>{
  for(const status of [400,401,403,429]){
    const error=Object.assign(new Error('synthetic rejection'),{status});
    assert.deepEqual(await makeReset(async()=>{throw error;})('synthetic-token','Synthetic-password1'),{ok:false,outcome:'rejected',error:'synthetic rejection'});
  }
  assert.deepEqual(await makeReset(async(_request,accept)=>accept({user:{id:'synthetic-account'}}))('synthetic-token','Synthetic-password1'),{ok:true});
});

test('actual Store reset accept retires native link before account adoption and never on rejection',async()=>{
 const order=[];
 const reset=new Function('performAuthentication','api','logout','absorbServerUser',`return (${source.slice(callback.start,callback.end)});`)(async(_request,accept)=>accept({user:{id:'B'}}),()=>{},()=>{},()=>order.push('adopt-B'));
 assert.deepEqual(await reset('synthetic-token','Synthetic-password1',{onAccepted:()=>order.push('retire-capability')}),{ok:true});
 assert.deepEqual(order,['retire-capability','adopt-B']);
 let retired=false;await makeReset(async()=>{throw Object.assign(Error('rejected'),{status:400});})('synthetic-token','Synthetic-password1',{onAccepted:()=>retired=true});assert.equal(retired,false);
});
