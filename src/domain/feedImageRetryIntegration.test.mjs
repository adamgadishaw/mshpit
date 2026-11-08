import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transformSync } from '@babel/core';
import * as feedExperience from './feedExperience.mjs';
import * as placement from './feedDiscoveryPlacement.mjs';
import * as home from './homeJourney.mjs';
const require = createRequire(import.meta.url);
const compile = path => transformSync(readFileSync(new URL(path, import.meta.url), 'utf8'), { filename: path, babelrc:false, configFile:false,
  plugins:[[require('@babel/plugin-transform-react-jsx'),{runtime:'automatic'}],require('@babel/plugin-transform-modules-commonjs')] }).code;
const feedCode = compile('../screens/FeedScreen.jsx');
const retryCodes = { ios: compile('../hooks/feedImageRetry.ios.js'), android: compile('../hooks/feedImageRetry.js'), web: compile('../hooks/feedImageRetry.js') };
const run = (code, resolver) => { const module = {exports:{}}; new Function('require','module','exports',code)(resolver,module,module.exports); return module.exports; };
const nodes = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n,...nodes(n.props?.children)];
function fixture(platform='ios') {
  const slots=[], pending=[], calls=[], persisted=new Map(); let cursor=0, tree;
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const effect=(fn,deps)=>{const i=cursor++;if(!same(slots[i]?.deps,deps))pending.push(()=>{slots[i]?.cleanup?.();slots[i]={deps,fn,cleanup:fn()};});};
  const react={
    useRef(value){const i=cursor++;return slots[i] ||= {current:value};},
    useState(value){const i=cursor++;if(!(i in slots))slots[i]=typeof value==='function'?value():value;return [slots[i],next=>slots[i]=typeof next==='function'?next(slots[i]):next];},
    useMemo(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,value:fn()};return slots[i].value;},
    useCallback(fn,deps){return react.useMemo(()=>fn,deps);},useEffect:effect,useLayoutEffect:effect,memo:fn=>fn,
    createContext:()=>({Provider:'Provider'}),createElement:(type,props,children)=>({type,props:{...props,children}}),
  };
  const retry=run(retryCodes[platform],()=>react);
  const request = signal => new Promise(resolve=>calls.push({signal,resolve}));
  const jsx=(type,props,key)=>({type,props,key});
  const feed=run(feedCode,dep=>{
    if(dep==='react')return react;
    if(dep==='react/jsx-runtime')return {jsx,jsxs:jsx};
    if(dep==='react-native')return {View:'View',Text:'Text',FlatList:'FlatList',Pressable:'Pressable',ScrollView:'ScrollView',Platform:{OS:platform,select:v=>v[platform]||v.default},StyleSheet:{create:v=>v},useWindowDimensions:()=>({width:393,fontScale:1})};
    if(dep.endsWith('/feedImageRetry'))return retry;
    if(dep.endsWith('/feedHeadStatus'))return {useFeedHeadStatus:()=>null};
    if(dep.endsWith('/theme'))return {colors:{},radius:{},shadow:{}};
    if(dep.endsWith('/persist'))return {load:(key,fallback)=>persisted.get(key)??fallback,save:(key,value)=>persisted.set(key,value)};
    if(dep.endsWith('/feedExperience.mjs'))return feedExperience;
    if(dep.endsWith('/feedDiscoveryPlacement.mjs'))return placement;
    if(dep.endsWith('/homeJourney.mjs'))return home;
    if(dep.endsWith('/nativeFeedMediaRetention.mjs'))return {nativeFeedCanWork:()=>true};
    if(dep.endsWith('/lazyWithRetry'))return {lazyWithRetry:()=> 'Lazy'};
    if(dep.endsWith('/newsReaderState.mjs'))return {newsAwareFeed:feed=>feed};
    if(dep.endsWith('/NewsInteractionContext'))return {useNewsInteractions:()=>({})};
    if(dep.endsWith('/useAppActive'))return ()=>true;
    if(dep.endsWith('/useNewsIntroduction'))return ()=>({dismiss(){}});
    if(dep.endsWith('/useNewsDeskStories'))return ()=>({stories:[],reload:()=>request()});
    if(dep.endsWith('/useFollowingFeed'))return ()=>({posts:[],reload:()=>request()});
    return dep;
  }).default;
  const props={feed:[],localFeed:[],loggedIn:true,visible:true,accountId:'a',onRefresh:({signal})=>request(signal)};
  const render=(flush=true)=>{cursor=0;tree=feed(props);if(flush)while(pending.length)pending.shift()();return tree;};
  render();
  return {props,calls,render,get tree(){return tree;},get refresh(){return tree.props.children.props.onRefresh;},
    subscribe(fn){return tree.props.value?.subscribe(fn);},
    filter(label){const list=tree.props.children.props.children;nodes(list.props.ListHeaderComponent).find(n=>n.props?.label===label).props.onPress();render();},
    unmount(){slots.forEach(slot=>slot?.cleanup?.());},
    strictReplay(){slots.forEach(slot=>slot?.cleanup?.());slots.forEach(slot=>{if(slot?.fn)slot.cleanup=slot.fn();});},
  };
}
test('actual Feed emits once only after an accepted explicit refresh; duplicate and missing action are inert',async()=>{
 const f=fixture();let pulses=0;f.subscribe(()=>pulses++);const refresh=f.refresh;
 assert.equal(f.calls.length,0);f.render();assert.equal(pulses,0);
 const first=refresh();assert.equal(pulses,1);assert.equal(await refresh(),false);assert.equal(f.calls.length,1);
 f.calls[0].resolve(true);assert.equal(await first,true);assert.equal(pulses,1);
 f.props.onRefresh=null;f.render();assert.equal(await f.refresh(),false);assert.equal(pulses,1);
});
test('actual Feed account A→B→A and filter A→B→A reject captured callbacks before effects',async()=>{
 const f=fixture();const old=f.refresh;let pulses=0;f.subscribe(()=>pulses++);
 f.props.accountId='b';f.render(false);assert.equal(await old(),false);
 f.props.accountId='a';f.render();assert.equal(await old(),false);assert.equal(pulses,0);
 const current=f.refresh;f.filter('Local');f.filter('For You');assert.equal(await current(),false);assert.equal(f.calls.length,0);
});
test('actual Feed cancellation and unmount do not replay accepted pulses or leave callable owners',async()=>{
 const f=fixture();let pulses=0;f.subscribe(()=>pulses++);const old=f.refresh;const pending=old();
 f.props.accountId='b';f.render();assert.equal(f.calls[0].signal.aborted,true);
 f.calls[0].resolve(true);assert.equal(await pending,false);assert.equal(pulses,1);assert.equal(await old(),false);
 const next=f.refresh;f.unmount();assert.equal(await next(),false);assert.equal(f.calls.length,1);
});
test('actual Feed StrictMode cleanup/setup permits one fresh gesture without emitting on setup',async()=>{
 const f=fixture();let pulses=0;f.subscribe(()=>pulses++);f.strictReplay();assert.equal(pulses,0);
 const pending=f.refresh();assert.equal(pulses,1);f.calls[0].resolve(true);await pending;
});
for(const platform of ['android','web'])test(`${platform}: default provider and refresh hook are inert and retain list data references`,async()=>{
 const f=fixture(platform),tree=f.tree,list=tree.props.children.props.children;
 assert.equal(tree.type(tree.props),tree.props.children);assert.equal(tree.props.value,null);
 f.render();assert.equal(f.tree.props.children.props.children.props.data,list.props.data);
 const pending=f.refresh();assert.equal(f.calls.length,1);assert.equal(await f.refresh(),false);f.calls[0].resolve(true);assert.equal(await pending,true);
});

test('new image subscribers never replay a past accepted refresh',async()=>{
 const f=fixture();const first=f.refresh();f.calls[0].resolve(true);await first;
 let pulses=0;const unsubscribe=f.subscribe(()=>pulses++);assert.equal(pulses,0);
 const second=f.refresh();assert.equal(pulses,1);unsubscribe();f.calls[1].resolve(true);await second;
});
