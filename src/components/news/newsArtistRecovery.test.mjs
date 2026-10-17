import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {transformSync} from '@babel/core';
const require=createRequire(import.meta.url),file=new URL('./NewsViews.jsx',import.meta.url),local=createRequire(file);
const code=transformSync(readFileSync(file,'utf8'),{filename:'NewsViews.jsx',babelrc:false,configFile:false,plugins:[[require('@babel/plugin-transform-react-jsx'),{runtime:'automatic'}],require('@babel/plugin-transform-modules-commonjs')]}).code;
const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.type?.name==='NewsLoadError'?n.type(n.props):n.props?.children)];
const text=n=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(' '):n?.props?text(n.props.children):'';
const settle=()=>new Promise(setImmediate);
function fixture(){
  const slots=[],pending=[],calls=[];let index=0,dead=false,lateWrites=0,props={session:{id:'fixture-a'}};
  const same=(a,b)=>a?.length===b?.length&&a.every((v,i)=>Object.is(v,b[i]));
  const react={useRef(value){return slots[index++]||={current:value};},useState(initial){const i=index++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{if(dead)lateWrites++;slots[i]=typeof value==='function'?value(slots[i]):value;}];},useCallback(fn,deps){const i=index++;if(!same(slots[i]?.deps,deps))slots[i]={fn,deps};return slots[i].fn;},useEffect(fn,deps){const i=index++;if(!same(slots[i]?.deps,deps))pending.push(()=>{slots[i]?.cleanup?.();slots[i]={deps,cleanup:fn()};});}};
  const jsx=(type,props)=>({type,props});
  const deps={react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},'react-native':{ActivityIndicator:'Spinner',Pressable:'Pressable',ScrollView:'ScrollView',View:'View',Text:'Text',StyleSheet:{create:x=>x},Linking:{openURL:async()=>{}}},'../../theme':{colors:{},radius:{},space:n=>n},'../../lib/newsApi':{fetchNews:options=>new Promise((resolve,reject)=>calls.push({...options,resolve,reject})),fetchArtistNews:async()=>({items:[]})},'./useNewsDeskStories':()=>({stories:[],status:'ready'}),'../Button':'Button','../Icon':'Icon','../ScreenHeader':'Header','../SmartImage':'Image','./NewsStoryCard':'Story','./LiveEventPanel':'Live','./LiveCoverageCard':'LiveCard','./NewsRegionBar':'Region'};
  const module={exports:{}};new Function('require','module','exports',code)(name=>deps[name]||local(name),module,module.exports);
  let tree;const render=()=>{index=0;tree=module.exports.NewsScreen(props);for(const effect of pending.splice(0))effect();return tree;};
  render();const tab=label=>{nodes(tree).find(n=>n.type==='Pressable'&&text(n)===label).props.onPress();render();};
  return{calls,render,tab,items:()=>nodes(tree).filter(n=>n.props?.item).map(n=>n.props.item.id),button:title=>nodes(tree).find(n=>n.type==='Button'&&n.props.title===title),unmount(){dead=true;slots.forEach(s=>s?.cleanup?.());},get lateWrites(){return lateWrites;}};
}

test('Your artists retains read pages through append failure and retries the failed cursor',async()=>{
 const f=fixture();f.tab('Your artists');f.calls[0].resolve({items:[{id:'first'}],nextCursor:'page-two'});await settle();f.render();
 const append=f.button('Show more').props.onPress();f.calls[1].reject(Error('fixture offline'));await append;const failedTree=f.render();assert.deepEqual(f.items(),['first']);assert.equal(f.button('Show more'),undefined,'one explicit recovery action replaces the failed pagination action');const shown=nodes(failedTree);assert.ok(shown.findIndex(n=>n.type?.name==='NewsLoadError')>shown.findIndex(n=>n.props?.item?.id==='first'),'append error stays beside the loaded page');
 const retry=f.button('Try again').props.onPress();f.render();assert.deepEqual(f.items(),['first'],'retry must retain already loaded rows');assert.equal(f.calls[2].cursor,'page-two');
 f.calls[2].resolve({items:[{id:'second'}],nextCursor:null});await retry;f.render();assert.deepEqual(f.items(),['first','second']);f.unmount();
});
test('Your artists serializes rapid pagination and fences a late unmounted response',async()=>{
 const f=fixture();f.tab('Your artists');f.calls[0].resolve({items:[{id:'first'}],nextCursor:'page-two'});await settle();f.render();const button=f.button('Show more');const one=button.props.onPress(),two=button.props.onPress();
 assert.equal(f.calls.length,2,'only one append is dispatched');f.unmount();f.calls[1].resolve({items:[{id:'late'}]});await Promise.all([one,two]);assert.equal(f.lateWrites,0);
});
test('Your artists aborts an interrupted tab request and ignores late results',async()=>{
 const f=fixture();f.tab('Your artists');const call=f.calls[0];f.tab('Music news');assert.equal(call.signal?.aborted,true);f.unmount();call.resolve({items:[{id:'late'}]});await settle();assert.equal(f.lateWrites,0);
});
