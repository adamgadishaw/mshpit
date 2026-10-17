import test from 'node:test';
import assert from 'node:assert/strict';
import { connectNativeAccountLinks, nativeAccountLinkIntent } from './nativeAccountLink.mjs';
const token='synthetic_token_12345678901234567890',other='replacement_token_12345678901234567';
const link=(kind='verify',value=token)=>`https://www.mshpit.com/#${kind}=${value}`;
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function fixture(){const initial=deferred(),events=[],state={removed:0,invalidations:0,unavailable:0};let listener;const inbox=connectNativeAccountLinks({linking:{getInitialURL:()=>initial.promise,addEventListener:(type,fn)=>{assert.equal(type,'url');listener=fn;return{remove:()=>state.removed++};}},onIntent:value=>events.push(value),onInvalidate:()=>state.invalidations++,onUnavailable:()=>state.unavailable++});return{inbox,initial,events,state,warm:url=>listener({url})};}
test('exact canonical HTTPS fragment and legacy query capabilities are admitted',()=>{
 assert.deepEqual(nativeAccountLinkIntent(link()),{kind:'verify',token});
 assert.deepEqual(nativeAccountLinkIntent(`https://www.mshpit.com/?reset=${token}`),{kind:'reset',token});
 assert.deepEqual(nativeAccountLinkIntent('https://preview.example/#verify='+token,'https://preview.example'),{kind:'verify',token});
});
for(const value of [
 `http://www.mshpit.com/#verify=${token}`,`mshpit://auth/#verify=${token}`,`mshpit-dev://auth/#reset=${token}`,
 `https://mshpit.com/#verify=${token}`,`https://www.mshpit.com.evil.test/#verify=${token}`,`https://www.mshpit.com@evil.test/#verify=${token}`,
 `https://member@www.mshpit.com/#verify=${token}`,`https://www.mshpit.com:444/#verify=${token}`,`https://www.mshpit.com:443/#verify=${token}`,
 `https://www.mshpit.com/news#verify=${token}`,`https://www.mshpit.com/./#verify=${token}`,`https://www.mshpit.com/a/../#verify=${token}`,
 `https://www.mshpit.com/\\evil/#verify=${token}`,` https://www.mshpit.com/#verify=${token}`,`https://www.mshpit.com/\n#verify=${token}`,
 'not-a-url',null,'https://www.mshpit.com/#section',`https://www.mshpit.com/#unsubscribe=${token}`,
])test('untrusted or unrelated entry is ignored: '+String(value).split('#')[0],()=>assert.equal(nativeAccountLinkIntent(value),null));
for(const suffix of ['#verify=','#verify=short',`#verify=${token}&verify=${token}`,`#verify=${token}&reset=${other}`,`?verify=${token}#verify=${token}`,`#verify=${token}&ownerApproval=${other}`,`#reset=${token}&unsubscribe=${other}`])test('malformed/conflicting capability becomes recoverable invalid flow: '+suffix.slice(0,10),()=>assert.deepEqual(nativeAccountLinkIntent('https://www.mshpit.com/'+suffix),{kind:'invalid'}));
test('cold entry waits for first settled identity without dropping bootstrap guest to account transition',async()=>{
 const f=fixture();f.inbox.setIdentity(false,null);f.initial.resolve(link());await tick();assert.equal(f.events.length,0);
 f.inbox.setIdentity(true,'A');assert.equal(f.events.length,1);assert.equal(f.events[0].accountId,'A');assert.equal(f.events[0].kind,'verify');f.inbox.dispose();
});
test('warm event before authReady is retained and late initialURL cannot override it',async()=>{
 const f=fixture();f.inbox.setIdentity(false,null);f.warm(link('reset',other));f.initial.resolve(link());await tick();f.inbox.setIdentity(true,null);
 assert.equal(f.events.length,1);assert.equal(f.events[0].token,other);f.inbox.dispose();
});
test('new warm capability synchronously invalidates the old flow; exact duplicate event does not remount or submit',async()=>{
 const f=fixture();f.inbox.setIdentity(true,'A');f.initial.resolve(link());await tick();const before=f.state.invalidations;
 f.warm(link());assert.equal(f.events.length,1);assert.equal(f.state.invalidations,before);
 f.warm(link('reset',other));assert.equal(f.events.length,2);assert.equal(f.state.invalidations,before+1);assert.ok(f.events[1].revision>f.events[0].revision);
 f.warm('https://www.mshpit.com/#verify=short');assert.equal(f.events.at(-1).kind,'invalid');assert.equal(f.events.at(-1).token,undefined);f.inbox.dispose();
});
test('close, logout and account switch discard old capability and duplicate delivery cannot reopen it',async()=>{
 for(const next of [null,'B']){const f=fixture();f.inbox.setIdentity(true,'A');f.initial.resolve(link());await tick();const count=f.events.length;
 f.inbox.setIdentity(true,next);assert.ok(f.state.invalidations>=2);f.warm(link());assert.equal(f.events.length,count);
 f.warm(link('reset',other));assert.equal(f.events.at(-1).accountId,next);f.inbox.close();f.warm(link('reset',other));assert.equal(f.events.length,count+1);f.inbox.dispose();}
});
test('background/browser return with no new URL does not replay, and revalidation preserves same-account flow',async()=>{
 const f=fixture();f.inbox.setIdentity(true,'A');f.initial.resolve(link());await tick();f.inbox.setIdentity(false,'A');f.inbox.setIdentity(true,'A');
 assert.equal(f.events.length,1);f.inbox.close();f.inbox.setIdentity(false,'A');f.inbox.setIdentity(true,'A');assert.equal(f.events.length,1);f.inbox.dispose();
});
test('dispose cancels pending initial delivery and removes platform listener; read failure is token-free',async()=>{
 const f=fixture();f.inbox.setIdentity(true,'A');f.inbox.dispose();f.initial.resolve(link());await tick();f.warm(link('reset'));assert.deepEqual(f.events,[]);assert.equal(f.state.removed,1);
 const g=fixture();g.initial.reject(Error('synthetic URL read failure'));await tick();assert.equal(g.state.unavailable,1);assert.deepEqual(g.events,[]);g.inbox.dispose();
});
