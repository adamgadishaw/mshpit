import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {transformSync} from '@babel/core';
const require=createRequire(import.meta.url),code=transformSync(readFileSync(new URL('./ConvertingClipNotice.jsx',import.meta.url),'utf8'),{filename:'ConvertingClipNotice.jsx',babelrc:false,configFile:false,plugins:[[require('@babel/plugin-transform-react-jsx'),{runtime:'automatic'}],require('@babel/plugin-transform-modules-commonjs')]}).code;
const settle=()=>new Promise(r=>setImmediate(r));
function fixture({platform='android',active=true}={}){
 const slots=[],effects=[],layouts=[],timers=new Map(),calls=[];let cursor=0,seq=0,ready=0,clips=[{id:'local-converter-source',state:'processing'}];const retries=[];
 const scheduleEffect=(fn,deps,queue)=>{const i=cursor++,old=slots[i];if(!old||deps.some((d,n)=>d!==old.deps[n])){const value={deps,fn,prior:old};slots[i]=value;queue.push(value);}};
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>slots[i]=typeof next==='function'?next(slots[i]):next];},useRef(initial){return slots[cursor++]||=({current:initial});},useEffect(fn,deps){scheduleEffect(fn,deps,effects);},useLayoutEffect(fn,deps){scheduleEffect(fn,deps,layouts);}};
 const jsx=(type,props)=>({type,props}),deps={react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Platform:{OS:platform},ActivityIndicator:'Spinner',Pressable:'Button',Text:'Text',View:'View',StyleSheet:{create:s=>s,hairlineWidth:1}},'../lib/useAppActive':()=>active,'./Icon':'Icon','../theme':{colors:{},radius:{}},'../lib/convertingClipsApi':{checkConvertingClip:(id,{signal})=>new Promise(resolve=>calls.push({id,signal,resolve})),retryConvertingClip:id=>new Promise((resolve,reject)=>retries.push({id,resolve,reject}))}};
 const module={exports:{}};new Function('require','module','exports','setInterval','clearInterval',code)(name=>deps[name]||require(name),module,module.exports,fn=>{timers.set(++seq,fn);return seq;},id=>timers.delete(id));
 const render=({flushPassive=true}={})=>{cursor=0;const tree=module.exports.default({clips,onReady:()=>ready++});while(layouts.length){const e=layouts.shift();e.prior?.cleanup?.();e.cleanup=e.fn();}if(flushPassive)while(effects.length){const e=effects.shift();e.prior?.cleanup?.();e.cleanup=e.fn();}return tree;};render();return{calls,timers,retries,render,setClips:(value,options)=>{clips=value;return render(options);},get ready(){return ready;},tick:()=>[...timers.values()].forEach(fn=>fn()),setActive:value=>{active=value;render();},unmount:()=>slots.forEach(s=>s?.cleanup?.())};
}
test('native checks immediately and serializes a slow check with the interval',async()=>{const f=fixture();assert.equal(f.calls.length,1);f.tick();assert.equal(f.calls.length,1);f.calls[0].resolve('ready');await settle();assert.equal(f.ready,1);f.unmount();assert.equal(f.timers.size,0);});
test('a retired native notice aborts and ignores late ready results',async()=>{const f=fixture();f.unmount();assert.equal(f.calls[0].signal.aborted,true);f.calls[0].resolve('ready');await settle();assert.equal(f.ready,0);});
test('background native notices stay idle and catch up immediately on foreground',async()=>{const f=fixture({active:false});assert.equal(f.calls.length,0);assert.equal(f.timers.size,0);f.setActive(true);assert.equal(f.calls.length,1);f.setActive(false);assert.equal(f.calls[0].signal.aborted,true);f.calls[0].resolve('ready');await settle();assert.equal(f.ready,0);f.unmount();});
test('web keeps its existing interval-first timing',async()=>{const f=fixture({platform:'web',active:false});assert.equal(f.calls.length,0);f.tick();assert.equal(f.calls.length,1);f.calls[0].resolve('ready');await settle();assert.equal(f.ready,1);f.unmount();});

const findRetry=tree=>tree?.props?.children?.find(node=>node?.type==='Button');
test('a retry retired by replacement clips cannot alter the new notice or refresh its feed',async()=>{
 const f=fixture();f.calls[0].resolve('processing');await settle();
 f.setClips([{id:'retired-clip',state:'failed'}]);
 // The server-prop effect takes one render to publish the new notice state.
 const retry=findRetry(f.render());assert.ok(retry);const pending=retry.props.onPress();
 assert.equal(f.retries.length,1);assert.equal(f.retries[0].id,'retired-clip');
 f.setClips([{id:'replacement-clip',state:'failed'}],{flushPassive:false});
 f.retries[0].resolve('ready');await pending;await settle();
 assert.equal(f.ready,0,'retired retry must not refresh replacement even before passive effects flush');
 const current=f.render();assert.ok(findRetry(current),'replacement failed clip remains retryable');
 const next=findRetry(current).props.onPress();assert.equal(f.retries.at(-1).id,'replacement-clip');f.retries.at(-1).reject(new Error('synthetic offline'));await next;
 f.unmount();
});

test('unmount ignores a late completed retry',async()=>{
 const f=fixture();f.calls[0].resolve('processing');await settle();f.setClips([{id:'retired-clip',state:'failed'}]);
 const pending=findRetry(f.render()).props.onPress();f.unmount();f.retries[0].resolve('ready');await pending;
 assert.equal(f.ready,0);
});
test('same-turn repeat retry is serialized and a refusal remains retryable',async()=>{
 const f=fixture();f.calls[0].resolve('processing');await settle();f.setClips([{id:'failed-clip',state:'failed'}]);
 const retry=findRetry(f.render());const pending=retry.props.onPress();await retry.props.onPress();assert.equal(f.retries.length,1);
 f.retries[0].reject(new Error('synthetic unavailable'));await pending;
 const next=findRetry(f.render()).props.onPress();assert.equal(f.retries.length,2);f.retries[1].resolve('ready');await next;
 assert.equal(f.ready,1);assert.equal(f.render(),null);f.unmount();
});
