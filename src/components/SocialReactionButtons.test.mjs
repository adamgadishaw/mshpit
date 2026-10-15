import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {transformSync} from "@babel/core";
const require=createRequire(import.meta.url);
const compiled=transformSync(readFileSync(new URL("./SocialReactionButtons.jsx",import.meta.url),"utf8"),{
  filename:"SocialReactionButtons.jsx",babelrc:false,configFile:false,
  plugins:[[require("@babel/plugin-transform-react-jsx"),{runtime:"automatic"}],require("@babel/plugin-transform-modules-commonjs")],
}).code;
const nodes=node=>!node || typeof node!=="object"?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(kind="repost",accountId="viewer") {
  const calls=[],slots=[];let cursor=0,auth=0;
  const react={useRef:initial=>{const i=cursor++;return slots[i] ||= {current:initial};},useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>{slots[i]=typeof v==="function"?v(slots[i]):v;}];}};
  const jsx=(type,props)=>({type,props});
  const deps={react,"react/jsx-runtime":{jsx,jsxs:jsx},"react-native":{Pressable:"Pressable",Text:"Text",View:"View",StyleSheet:{create:v=>v}},"../theme":{colors:{}},"./Icon":"Icon"};
  const module={exports:{}};new Function("require","module","exports",compiled)(name=>deps[name],module,module.exports);
  let props={accountId,post:{id:"p",reposts:2,reposted:false},comment:{id:"c",likes:2,liked:false},postId:"p",onRequireAuth:()=>auth++,
    onRepost:(...args)=>new Promise((resolve,reject)=>calls.push({args,resolve,reject})),onLike:(...args)=>new Promise((resolve,reject)=>calls.push({args,resolve,reject}))};
  return {calls,get auth(){return auth;},render(update={}){props={...props,...update};cursor=0;const child=module.exports[kind==="repost"?"RepostButton":"CommentLikeButton"](props);return nodes(child.type(child.props));},button(){return this.render().find(node=>node.type==="Pressable");}};
}

for (const kind of ["repost","comment"]) test(`${kind} control has visible count, pending guard, explicit retry and stale-account isolation`,async()=>{
  const f=fixture(kind);const first=f.button();assert.match(first.props.accessibilityLabel,/, 2$/);
  void first.props.onPress();void first.props.onPress();assert.equal(f.calls.length,1);assert.equal(f.button().props.disabled,true);
  assert.deepEqual(f.calls[0].args,kind==="repost"?["p",true]:["p","c",true]);
  f.calls[0].reject(new Error("offline"));await settle();assert.ok(f.render().some(node=>node.props?.children==="Not saved. Try again."));
  void f.button().props.onPress();f.calls[1].resolve({ok:true,reposted:true,reposts:3,liked:true,likes:3});await settle();
  assert.equal(f.button().props.accessibilityState.selected,true);assert.match(f.button().props.accessibilityLabel,/, 3$/);
  void f.button().props.onPress();f.render({accountId:"new"});f.calls[2].resolve({ok:true,reposted:false,reposts:99,liked:false,likes:99});await settle();
  assert.match(f.button().props.accessibilityLabel,/, 2$/);
});

test("guest reaction asks for sign-in without retaining/replaying a mutation",()=>{
  const f=fixture("repost",null);void f.button().props.onPress();assert.equal(f.auth,1);assert.equal(f.calls.length,0);
  f.render({accountId:"viewer"});assert.equal(f.calls.length,0);
});
