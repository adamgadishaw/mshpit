import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {transformSync} from '@babel/core';
const require=createRequire(import.meta.url),code=transformSync(readFileSync(new URL('./NativeSwipeRail.native.jsx',import.meta.url),'utf8'),{filename:'NativeSwipeRail.native.jsx',babelrc:false,configFile:false,plugins:[[require('@babel/plugin-transform-react-jsx'),{runtime:'automatic'}],require('@babel/plugin-transform-modules-commonjs')]}).code;
function fixture({reader=false,reduced=false}={}){
 const handlers={},options={},styles=[],calls=[],manager={failed:0,activated:0,fail(){this.failed++;},activate(){this.activated++;}};
 const builder=new Proxy({}, {get:(_target,name)=>arg=>{(String(name).startsWith('on')?handlers:options)[name]=arg;return builder;}});
 const jsx=(type,props)=>({type,props});
 const mock=name=>name==='react'?{useMemo:f=>f(),useRef:v=>({current:v}),useState:v=>[v,()=>{}]}:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='react-native'?{View:'View',Text:'Text',StyleSheet:{create:s=>s},useWindowDimensions:()=>({width:412})}:name==='react-native-gesture-handler'?{Gesture:{Pan:()=>builder},GestureDetector:'GestureDetector'}:name==='react-native-reanimated'?{__esModule:true,default:{View:'AnimatedView',Text:'AnimatedText'},ReduceMotion:{System:'system'},useSharedValue:initial=>{let v=initial;return{get:()=>v,set:next=>v=next};},useAnimatedStyle:f=>{styles.push(f);return f();},useAnimatedReaction:()=>{},withSpring:v=>v}:name==='react-native-worklets'?{scheduleOnRN:(fn,arg)=>fn(arg)}:name==='../theme'?{colors:{}}:name.includes('useReducedMotion')?()=>reduced:name.includes('useScreenReaderEnabled')?()=>reader:require(name);
 const module={exports:{}};new Function('require','module','exports',code)(mock,module,module.exports);module.exports.default({onCommit:dir=>calls.push(dir),children:'buttons'});
 return {handlers,options,styles,calls,manager,down(x=150,y=300){handlers.onTouchesDown({allTouches:[{absoluteX:x,absoluteY:y}],numberOfTouches:1},manager);},move(x,y){handlers.onTouchesMove({allTouches:[{absoluteX:x,absoluteY:y}],numberOfTouches:1},manager);}};
}
test('release uses original touch-down, not translation reset at manual activation',()=>{
 const f=fixture();f.down();f.move(350,300);assert.equal(f.manager.activated,1);
 f.handlers.onEnd({absoluteX:190,absoluteY:300,translationX:-160,translationY:0},true);assert.deepEqual(f.calls,[]);
});
test('a deliberate original displacement commits once despite a late activation origin',()=>{
 const f=fixture();f.down();f.move(280,300);f.handlers.onEnd({absoluteX:280,absoluteY:300,translationX:5,translationY:0},true);assert.deepEqual(f.calls,['positive']);
});
test('vertical, interrupted and system-edge gestures cannot commit social actions',()=>{
 const f=fixture();f.down();f.move(170,380);assert.equal(f.manager.failed,1);f.handlers.onEnd({absoluteX:300,absoluteY:300},false);assert.deepEqual(f.calls,[]);
 const edge=fixture();edge.down(10);assert.equal(edge.manager.failed,1);edge.handlers.onEnd({absoluteX:200,absoluteY:300},false);assert.deepEqual(edge.calls,[]);
});
test('screen reader disables custom gesture and reduced motion removes translation',()=>{
 assert.equal(fixture({reader:true}).options.enabled,false);const f=fixture({reduced:true});f.down();f.handlers.onUpdate({absoluteX:280,absoluteY:300,translationX:130});assert.equal(f.styles[0]().transform[0].translateX,0);
});
