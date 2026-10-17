import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {transformSync} from '@babel/core';
const require=createRequire(import.meta.url);
const code=transformSync(readFileSync(new URL('./PostSwipeActions.native.jsx',import.meta.url),'utf8'),{filename:'PostSwipeActions.native.jsx',babelrc:false,configFile:false,plugins:[[require('@babel/plugin-transform-react-jsx'),{runtime:'automatic'}],require('@babel/plugin-transform-modules-commonjs')]}).code;
const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
function fixture(update={}) {
 const slots=[],calls=[];let cursor=0,liked=false;
 const react={useRef(v){return slots[cursor++]||=( {current:v});},useState(v){const i=cursor++;if(!(i in slots))slots[i]=v;return[slots[i],next=>slots[i]=next];},useEffect(fn){const i=cursor++;if(!(i in slots))slots[i]={cleanup:fn()};}};
 const jsx=(type,props)=>({type,props});const mock=name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='react-native'?{View:'View',Text:'Text',Pressable:'Pressable',StyleSheet:{create:s=>s}}:name==='../theme'?{colors:{}}:'NativeSwipeRail';
 const module={exports:{}};new Function('require','module','exports',code)(mock,module,module.exports);
 let props={enabled:true,accountId:'fixture',post:{id:'local-perf-post-1',likes:0,reposted:false},children:'buttons',likeInfo:()=>({liked}),toggleLike:async()=>{calls.push(['like']);liked=true;return{ok:true};},setPostRepost:async(id,desired)=>{calls.push(['repost',desired]);return{ok:true,reposted:desired};},...update},tree;
 const render=(next={})=>{props={...props,...next};cursor=0;tree=module.exports.default(props);return tree;};render();
 return {calls,render,commit:direction=>nodes(tree).find(n=>n.type==='NativeSwipeRail').props.onCommit(direction),text:()=>nodes(tree).filter(n=>n.type==='Text').map(n=>n.props.children).join(' '),unmount:()=>slots.forEach(s=>s?.cleanup?.())};
}
test('right swipes like idempotently; repeated repost is suppressed until explicit Undo',async()=>{
 const f=fixture();await f.commit('positive');f.render();await f.commit('positive');assert.deepEqual(f.calls,[['like']]);
 await f.commit('negative');f.render();await f.commit('negative');assert.deepEqual(f.calls,[['like'],['repost',true]]);
 const undo=nodes(f.render()).find(n=>n.props?.accessibilityLabel==='Undo this repost');await undo.props.onPress();f.render();assert.deepEqual(f.calls.at(-1),['repost',false]);
});
test('pending swipes serialize and a failed write remains retryable',async()=>{
 let resolve;const f=fixture({setPostRepost:()=>{f.calls.push(['write']);return new Promise(r=>resolve=r);}});
 const first=f.commit('negative');await f.commit('negative');assert.equal(f.calls.length,1);resolve({ok:false});await first;f.render();assert.match(f.text(),/Not saved/);
 const retry=f.commit('negative');assert.equal(f.calls.length,2);resolve({ok:true});await retry;f.render();assert.match(f.text(),/Reposted/);
});
test('guest swipe only requests auth and does not replay after login',async()=>{
 let auth=0;const f=fixture({accountId:null,onRequireAuth:()=>auth++});await f.commit('positive');assert.equal(auth,1);assert.equal(f.calls.length,0);f.render({accountId:'fixture'});assert.equal(f.calls.length,0);await f.commit('positive');assert.equal(f.calls.length,1);
});
test('late completions and queued actions cannot affect a retired account or unmounted row',async()=>{
 let resolve;const f=fixture({setPostRepost:()=>new Promise(r=>resolve=r)});const pending=f.commit('negative');f.render({accountId:'other'});resolve({ok:true});await pending;f.render();assert.doesNotMatch(f.text(),/Reposted/);f.unmount();await f.commit('positive');assert.equal(f.calls.length,0);
});
