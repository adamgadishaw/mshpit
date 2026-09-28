import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "@babel/core";
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("./NewsPostActions.jsx", import.meta.url), "utf8");
const compiled = transformSync(source, { filename: "NewsPostActions.jsx", babelrc: false, configFile: false, plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")] }).code;
const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(id) {
  const calls = { likes:[],reports:[],profiles:[],deletes:[],auth:0 }, slots=[];
  let cursor=0, session=id?{id}:null;
  const context = () => ({ session, removedIds:[], likeInfo: (_id,count,liked)=>({count,liked}), toggleLike:async(...args)=>{calls.likes.push(args);return{ok:true};}, deleteOwnPost:async(postId)=>{calls.deletes.push(postId);return{ok:true};} });
  const jsx = (type,props)=>({type,props});
  const dependencies = {
    react:{useRef:initial=>{const i=cursor++;return slots[i]||=( {current:initial} );},useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>{slots[i]=value;}];}},
    "react/jsx-runtime":{jsx,jsxs:jsx},
    "react-native":{View:"View",Text:"Text",Pressable:"Pressable",Platform:{OS:"web"},Alert:{},StyleSheet:{create:value=>value}},
    "../../theme":{colors:{}},"../Icon":"Icon","./NewsInteractionContext":{useNewsInteractions:context},
    "../SocialReactionButtons":{RepostButton:"RepostButton",RepostAttribution:"RepostAttribution"},
  };
  const module={exports:{}};
  new Function("require","module","exports",compiled)(name=>dependencies[name],module,module.exports);
  const story={postId:"news_one",author:{id:"author",name:"Desk",handle:"news_mod"},likes:4,likedByMe:true,commentCount:2};
  return {calls,setSession(value){session=value;},render(){cursor=0;return nodes(module.exports.default({story,accountId:id||null,onOpen:()=>{},onOpenProfile:userId=>calls.profiles.push(userId),onReport:post=>calls.reports.push(post),onRequireAuth:()=>calls.auth++}));},find(label){return this.render().find(node=>node.props?.accessibilityLabel===label);}};
}
test("actual news controls preserve viewer like state, author link and report target", async()=>{
  const f=fixture("viewer");
  const heart=f.find("4 likes");assert.equal(heart.props.accessibilityState.selected,true);heart.props.onPress();await settle();
  assert.deepEqual(f.calls.likes,[["news_one",4,true]]);
  f.find("Open Desk profile").props.onPress();assert.deepEqual(f.calls.profiles,["author"]);
  f.find("Report").props.onPress();assert.equal(f.calls.reports[0].id,"news_one");assert.equal(f.calls.reports[0].userId,"author");
  assert.equal(f.find("Delete"),undefined);
});
test("guest liking asks for auth; stale account renders no controls; only actual owner gets Delete",async()=>{
  const guest=fixture(null);guest.find("4 likes").props.onPress();assert.equal(guest.calls.auth,1);assert.equal(guest.calls.likes.length,0);
  guest.setSession({id:"other"});assert.deepEqual(guest.render(),[]);
  const owner=fixture("author");assert.equal(owner.find("Report"),undefined);assert.ok(owner.find("Delete"));
  const original=globalThis.confirm;globalThis.confirm=()=>true;
  try{owner.find("Delete").props.onPress();await settle();assert.deepEqual(owner.calls.deletes,["news_one"]);}finally{if(original===undefined)delete globalThis.confirm;else globalThis.confirm=original;}
});
