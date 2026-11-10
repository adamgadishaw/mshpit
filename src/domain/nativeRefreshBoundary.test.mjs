import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transformSync } from '@babel/core';
import * as pageReturn from './pageReturn.mjs';
const require=createRequire(import.meta.url),file=new URL('../components/VinylRefreshBoundary.jsx',import.meta.url);
const code=transformSync(readFileSync(file,'utf8'),{filename:'VinylRefreshBoundary.jsx',babelrc:false,configFile:false,plugins:[[require('@babel/plugin-transform-react-jsx'),{runtime:'automatic'}],require('@babel/plugin-transform-modules-commonjs')]}).code;
function fixture(onRefresh,page=null){const refs=[],cleanups=[];let cursor=0;const jsx=(type,props)=>({type,props}),module={exports:{}};
 const fakeRequire=name=>name==='react'?{Children:{only:x=>x},cloneElement:(x,p)=>({...x,props:{...x.props,...p}}),useRef:initial=>refs[cursor++] ||= {current:initial},useCallback:fn=>fn,useEffect:fn=>{const cleanup=fn();if(cleanup)cleanups.push(cleanup)}}:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='react-native'?{RefreshControl:'RefreshControl',View:'View',StyleSheet:{create:x=>x}}:name==='./PageReturnContext'?{usePageReturn:()=>page}:name==='../domain/pageReturn.mjs'?pageReturn:name.endsWith('/theme')?{colors:{amber:'amber',bgElev:'surface'}}:require(name);
 new Function('require','module','exports',code)(fakeRequire,module,module.exports);
 const onScroll=()=>{},child={type:'FlatList',props:{key:'preserved',onScroll,contentContainerStyle:{paddingTop:16}}};
 return {child,onScroll,close:()=>cleanups.splice(0).forEach(fn=>fn()),render:props=>{cursor=0;return module.exports.default({children:child,onRefresh,...props})}};}
const control=tree=>tree.props.children.props.refreshControl;
test('native refresh preserves the existing scroll owner and renders no status overlay',()=>{const f=fixture(()=>{}),tree=f.render(),c=control(tree);assert.equal(tree.props.children.type,'FlatList');assert.equal(tree.props.children.props.onScroll,f.onScroll);assert.equal(tree.props.children.props.contentContainerStyle,f.child.props.contentContainerStyle);assert.equal(c.type,'RefreshControl');assert.equal(c.props.tintColor,'amber');assert.equal(c.props.refreshing,false);assert.equal(Array.isArray(tree.props.children),false);});
test('repeated native refresh waits for the current request before allowing another',async()=>{let calls=0,resolve;const f=fixture(()=>{calls++;return new Promise(r=>resolve=r)}),c=control(f.render());c.props.onRefresh();c.props.onRefresh();assert.equal(calls,1);resolve();await new Promise(setImmediate);c.props.onRefresh();assert.equal(calls,2);resolve();});
test('disabled and controlled busy refresh do not dispatch another request',()=>{let calls=0;const f=fixture(()=>calls++);control(f.render({enabled:false})).props.onRefresh();control(f.render({refreshing:true})).props.onRefresh();assert.equal(calls,0);});
test('native refresh consumes rejection and permits a retry without changing scroll props',async()=>{let calls=0;const f=fixture(()=>{calls++;return Promise.reject(Error('synthetic read failure'))}),c=control(f.render());c.props.onRefresh();await new Promise(setImmediate);c.props.onRefresh();await new Promise(setImmediate);assert.equal(calls,2);assert.equal(f.render().props.children.props.onScroll,f.onScroll);});

test('title and active-tab gestures scroll every time while one native refresh is pending', async () => {
 const controller=pageReturn.createPageReturnController();controller.activate('feed');
 const page={register:handler=>controller.register('feed',handler)};
 let requests=0,resolve;const offsets=[];
 const f=fixture(()=>{requests++;return new Promise(r=>resolve=r)},page);
 const tree=f.render();tree.props.children.props.ref({scrollToOffset:options=>offsets.push(options)});
 controller.request('feed');controller.request('feed');controller.request('feed');
 assert.equal(requests,1);assert.equal(offsets.length,3);
 resolve();await new Promise(setImmediate);controller.request('feed');assert.equal(requests,2);
 f.close();assert.equal(controller.request('feed'),false);resolve();
});

test('an interrupted page unregisters immediately and a newly mounted route can refresh', async () => {
 const controller=pageReturn.createPageReturnController();controller.activate('a');
 let finishOld,oldCalls=0,newCalls=0;
 const old=fixture(()=>{oldCalls++;return new Promise(r=>finishOld=r)},{register:h=>controller.register('a',h)});
 old.render();controller.request('a');old.close();controller.activate('b');
 const current=fixture(()=>{newCalls++},{register:h=>controller.register('b',h)});current.render();
 assert.equal(controller.request('a'),false);controller.request('b');
 assert.equal(oldCalls,1);assert.equal(newCalls,1);finishOld();await new Promise(setImmediate);
 controller.request('b');assert.equal(newCalls,2);current.close();
});
