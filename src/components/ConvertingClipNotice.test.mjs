import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {transformSync} from '@babel/core';
const require=createRequire(import.meta.url),code=transformSync(readFileSync(new URL('./ConvertingClipNotice.jsx',import.meta.url),'utf8'),{filename:'ConvertingClipNotice.jsx',babelrc:false,configFile:false,plugins:[[require('@babel/plugin-transform-react-jsx'),{runtime:'automatic'}],require('@babel/plugin-transform-modules-commonjs')]}).code;
const settle=()=>new Promise(r=>setImmediate(r));
function fixture({platform='android',active=true}={}){
 const slots=[],effects=[],timers=new Map(),calls=[];let cursor=0,seq=0,ready=0;
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>slots[i]=typeof next==='function'?next(slots[i]):next];},useRef(initial){return slots[cursor++]||=({current:initial});},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((d,n)=>d!==old.deps[n])){old?.cleanup?.();const value={deps,fn};slots[i]=value;effects.push(value);}}};
 const jsx=(type,props)=>({type,props}),deps={react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Platform:{OS:platform},ActivityIndicator:'Spinner',Pressable:'Button',Text:'Text',View:'View',StyleSheet:{create:s=>s,hairlineWidth:1}},'../lib/useAppActive':()=>active,'./Icon':'Icon','../theme':{colors:{},radius:{}},'../lib/convertingClipsApi':{checkConvertingClip:(id,{signal})=>new Promise(resolve=>calls.push({id,signal,resolve})),retryConvertingClip:async()=> 'processing'}};
 const module={exports:{}};new Function('require','module','exports','setInterval','clearInterval',code)(name=>deps[name]||require(name),module,module.exports,fn=>{timers.set(++seq,fn);return seq;},id=>timers.delete(id));
 const render=()=>{cursor=0;const tree=module.exports.default({clips:[{id:'local-converter-source',state:'processing'}],onReady:()=>ready++});while(effects.length){const e=effects.shift();e.cleanup=e.fn();}return tree;};render();return{calls,timers,get ready(){return ready;},tick:()=>[...timers.values()].forEach(fn=>fn()),setActive:value=>{active=value;render();},unmount:()=>slots.forEach(s=>s?.cleanup?.())};
}
test('native checks immediately and serializes a slow check with the interval',async()=>{const f=fixture();assert.equal(f.calls.length,1);f.tick();assert.equal(f.calls.length,1);f.calls[0].resolve('ready');await settle();assert.equal(f.ready,1);f.unmount();assert.equal(f.timers.size,0);});
test('a retired native notice aborts and ignores late ready results',async()=>{const f=fixture();f.unmount();assert.equal(f.calls[0].signal.aborted,true);f.calls[0].resolve('ready');await settle();assert.equal(f.ready,0);});
test('background native notices stay idle and catch up immediately on foreground',async()=>{const f=fixture({active:false});assert.equal(f.calls.length,0);assert.equal(f.timers.size,0);f.setActive(true);assert.equal(f.calls.length,1);f.setActive(false);assert.equal(f.calls[0].signal.aborted,true);f.calls[0].resolve('ready');await settle();assert.equal(f.ready,0);f.unmount();});
test('web keeps its existing interval-first timing',async()=>{const f=fixture({platform:'web',active:false});assert.equal(f.calls.length,0);f.tick();assert.equal(f.calls.length,1);f.calls[0].resolve('ready');await settle();assert.equal(f.ready,1);f.unmount();});
