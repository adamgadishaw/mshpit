import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transformSync } from '@babel/core';
const require=createRequire(import.meta.url),file=new URL('../components/VinylRefreshBoundary.jsx',import.meta.url);
const code=transformSync(readFileSync(file,'utf8'),{filename:'VinylRefreshBoundary.jsx',babelrc:false,configFile:false,plugins:[[require('@babel/plugin-transform-react-jsx'),{runtime:'automatic'}],require('@babel/plugin-transform-modules-commonjs')]}).code;
function fixture(onRefresh){const ref={current:false},jsx=(type,props)=>({type,props}),module={exports:{}};
 const fakeRequire=name=>name==='react'?{Children:{only:x=>x},cloneElement:(x,p)=>({...x,props:{...x.props,...p}}),useRef:()=>ref}:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='react-native'?{RefreshControl:'RefreshControl',View:'View',StyleSheet:{create:x=>x}}:name.endsWith('/theme')?{colors:{amber:'amber',bgElev:'surface'}}:require(name);
 new Function('require','module','exports',code)(fakeRequire,module,module.exports);
 const onScroll=()=>{},child={type:'FlatList',props:{key:'preserved',onScroll,contentContainerStyle:{paddingTop:16}}};
 return {child,onScroll,render:props=>module.exports.default({children:child,onRefresh,...props})};}
const control=tree=>tree.props.children.props.refreshControl;
test('native refresh preserves the existing scroll owner and renders no status overlay',()=>{const f=fixture(()=>{}),tree=f.render(),c=control(tree);assert.equal(tree.props.children.type,'FlatList');assert.equal(tree.props.children.props.onScroll,f.onScroll);assert.equal(tree.props.children.props.contentContainerStyle,f.child.props.contentContainerStyle);assert.equal(c.type,'RefreshControl');assert.equal(c.props.tintColor,'amber');assert.equal(c.props.refreshing,false);assert.equal(Array.isArray(tree.props.children),false);});
test('repeated native refresh waits for the current request before allowing another',async()=>{let calls=0,resolve;const f=fixture(()=>{calls++;return new Promise(r=>resolve=r)}),c=control(f.render());c.props.onRefresh();c.props.onRefresh();assert.equal(calls,1);resolve();await new Promise(setImmediate);c.props.onRefresh();assert.equal(calls,2);resolve();});
test('disabled and controlled busy refresh do not dispatch another request',()=>{let calls=0;const f=fixture(()=>calls++);control(f.render({enabled:false})).props.onRefresh();control(f.render({refreshing:true})).props.onRefresh();assert.equal(calls,0);});
test('native refresh consumes rejection and permits a retry without changing scroll props',async()=>{let calls=0;const f=fixture(()=>{calls++;return Promise.reject(Error('synthetic read failure'))}),c=control(f.render());c.props.onRefresh();await new Promise(setImmediate);c.props.onRefresh();await new Promise(setImmediate);assert.equal(calls,2);assert.equal(f.render().props.children.props.onScroll,f.onScroll);});
