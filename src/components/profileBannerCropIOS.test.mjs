import assert from "node:assert/strict";
import { readFileSync, statSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url), React = require("react"), reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core"), noop = () => {};
function createRenderer() {
  const context = {}, container = { children: [] };
  let priority = 0;
  const append = (parent, child) => parent.children.push(child);
  const remove = (parent, child) => { const index = parent.children.indexOf(child); if (index >= 0) parent.children.splice(index, 1); };
  const insert = (parent, child, before) => parent.children.splice(parent.children.indexOf(before), 0, child);
  const renderer = reconciler({
    supportsMutation: true, hideInstance: n => { n.hidden = true; }, unhideInstance: n => { n.hidden = false; }, hideTextInstance: n => { n.hidden = true; }, unhideTextInstance: n => { n.hidden = false; }, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: node => node,
    prepareForCommit: () => null, resetAfterCommit: noop,
    createInstance: (type, props) => ({ type, props, children: [], focus() {}, scrollToEnd() {} }), createTextInstance: text => ({ text }),
    appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    removeChild: remove, removeChildFromContainer: remove, insertBefore: insert, insertInContainerBefore: insert,
    finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
    commitUpdate: (node, type, oldProps, newProps) => { node.props = newProps; }, commitTextUpdate: (node, oldText, text) => { node.text = text; },
    clearContainer: node => { node.children = []; }, resetTextContent: noop, commitMount: noop,
    scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1, supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
    getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority: value => { priority = value; }, resolveUpdatePriority: () => priority || 32,
    shouldAttemptEagerTransition: () => false, detachDeletedInstance: noop, maySuspendCommit: () => false, preloadInstance: () => true,
    startSuspendingCommit: noop, suspendInstance: noop, waitForCommitToBeReady: () => null, NotPendingTransition: null,
    HostTransitionContext: React.createContext(null), resetFormInstance: noop, bindToConsole: (method, args) => console[method].bind(console, ...args),
  });
  const fail = error => { throw error; };
  const root = renderer.createContainer(container, 1, null, false, null, "", fail, fail, fail, null);
  const flush = () => { for (let i = 0; i < 5; i++) { renderer.flushSyncWork(); if (!renderer.flushPassiveEffects()) break; } };
  return { container, renderLayout(element) { renderer.updateContainerSync(element, root, null, null); renderer.flushSyncWork(); }, flush, render(element) { renderer.updateContainerSync(element, root, null, null); flush(); },
    act(callback) { renderer.flushSyncFromReconciler(callback); flush(); } };
}

const codes = new Map();
function execute(path, imports) {
  const file = new URL(path, import.meta.url);
  if (!codes.has(path)) codes.set(path, transformSync(readFileSync(file, "utf8"), { filename: file.pathname, babelrc: false, configFile: false,
    plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")] }).code);
  const module = { exports: {} };
  new Function("require", "module", "exports", codes.get(path))(name => imports(name, createRequire(file)), module, module.exports);
  return module.exports;
}

import * as imagePolicy from "../domain/profileImagePolicy.mjs";
import * as cropPolicy from "../domain/profileCrop.mjs";
const walk = node => [node, ...(node.children || []).flatMap(walk)];
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const settle = async renderer => { for (let i=0;i<12;i++) await Promise.resolve(); await new Promise(setImmediate); renderer?.act(noop); };

test("iOS normalization encodes once after crop, keeps native source pixels, and releases only its output", async () => {
  const calls=[], deleted=[];
  const decoded={width:3000,height:4000,release:()=>calls.push("decoded-release")};
  const output={uri:"file:///cropped.jpg",width:1800,height:600};
  const rendered={saveAsync: async options => { calls.push(["save", options]);return output; },release:()=>calls.push("rendered-release")};
  const manipulator={manipulate: input => {calls.push(["source", input]);return {crop:r=>calls.push(["crop",r]),resize:r=>calls.push(["resize",r]),renderAsync:async()=>typeof input==="string"?decoded:rendered,release:()=>calls.push("context-release")};}};
  const {normalizeProfileImageAsset}=execute("../lib/profileImageNormalizer.ios.js",(name,local)=>{
    if(name==="expo-file-system")return {File:class {constructor(uri){this.uri=uri;this.size=400000;this.exists=true;}delete(){deleted.push(this.uri);}}};
    if(name==="expo-image-manipulator")return {ImageManipulator:manipulator,SaveFormat:{JPEG:"jpeg"}};
    if(name.includes("profileImagePolicy"))return imagePolicy;
    if(name.includes("profileCrop"))return cropPolicy;
    return local(name);
  });
  const selection={x:0,y:0.5,width:1,height:0.25};
  const result=await normalizeProfileImageAsset({uri:"file:///source.heic",profileCrop:selection},"banner");
  assert.deepEqual(calls.filter(c=>Array.isArray(c)&&c[0]==="save"),[["save",{compress:0.96,format:"jpeg"}]]);
  assert.deepEqual(calls.find(c=>c[0]==="crop"),["crop",{originX:0,originY:2000,width:3000,height:1000}]);
  assert.equal(calls.filter(c=>c==="decoded-release").length,1);assert.equal(deleted.length,0);
  assert.equal(result.width,1800);assert.equal(result.height,600);assert.equal(result.release(),true);assert.equal(result.release(),false);
  assert.deepEqual(deleted,["file:///cropped.jpg"]);
  calls.length=0;await normalizeProfileImageAsset({uri:"file:///source.heic",profileImageRef:decoded,profileCrop:selection},"banner");
  assert.equal(calls.filter(c=>c==="decoded-release").length,0,"preview owns its native image");
  assert.equal(calls.filter(c=>Array.isArray(c)&&c[0]==="source").length,1);
});

for(const stage of ["decode","render","save"])test(`iOS normalization releases resources on cancellation during ${stage}`,async()=>{
  const abort=new AbortController(),deleted=[],released=[];
  const decoded={width:3000,height:2000,release:()=>released.push("decoded")};
  const rendered={saveAsync:async()=>{if(stage==="save")abort.abort();return {uri:"file:///out.jpg"};},release:()=>released.push("rendered")};
  const {normalizeProfileImageAsset}=execute("../lib/profileImageNormalizer.ios.js",(name,local)=>{
    if(name==="expo-file-system")return {File:class {constructor(uri){this.uri=uri;this.exists=true;}delete(){deleted.push(this.uri);}}};
    if(name==="expo-image-manipulator")return {SaveFormat:{JPEG:"jpeg"},ImageManipulator:{manipulate:input=>({crop:noop,resize:noop,release:()=>released.push("context"),renderAsync:async()=>{if(stage===(typeof input==="string"?"decode":"render"))abort.abort();return typeof input==="string"?decoded:rendered;}})}};
    if(name.includes("profileImagePolicy"))return imagePolicy;if(name.includes("profileCrop"))return cropPolicy;return local(name);
  });
  await assert.rejects(normalizeProfileImageAsset({uri:"file:///source.jpg"},"banner",{signal:abort.signal}),{name:"AbortError"});
  assert.ok(released.includes("decoded"));assert.deepEqual(deleted,stage==="save"?["file:///out.jpg"]:[]);
});

function hookFixture(){
 const renderer=createRenderer();let current, hidden=false;const never=new Promise(()=>{});
 const Hook=execute("../hooks/useProfileImageUpload.ios.js",(name,local)=>name==="react"||name==="react/jsx-runtime"?require(name):name.includes("ProfileImageCropDialog")?"CropDialog":local(name)).useProfileImageUpload;
 function Host(){current=Hook();return current.imageCropDialog;}
 function Gate(){if(hidden)throw never;return null;}
 const render=()=>renderer.render(React.createElement(React.Suspense,{fallback:React.createElement("Fallback")},React.createElement(Host),React.createElement(Gate)));render();
 return {renderer,hide(){hidden=true;render();},show(){hidden=false;render();},get current(){return current;},dialog:()=>walk(renderer.container).find(n=>n.type==="CropDialog"),close:()=>renderer.render(null)};
}
test("crop hook passes avatars through and cancels superseded, aborted and unmounted banner requests",async()=>{
 const f=hookFixture(),upload=async()=>"https://media.test/new.jpg",asset={uri:"file:///source.jpg"};
 assert.equal(await f.current.uploadProfileImage(asset,"avatar",{upload}),"https://media.test/new.jpg");
 let first,second;f.renderer.act(()=>{first=f.current.uploadProfileImage(asset,"banner",{upload});});const old=f.dialog().props.request;
 f.renderer.act(()=>{second=f.current.uploadProfileImage(asset,"banner",{upload});});assert.equal(await first,null);assert.equal(old.signal.aborted,true);
 f.renderer.act(()=>old.finish("stale"));assert.notEqual(f.dialog().props.request,old);
 f.renderer.act(()=>f.dialog().props.request.finish("https://media.test/banner.jpg"));assert.equal(await second,"https://media.test/banner.jpg");
 const controller=new AbortController();let third;f.renderer.act(()=>{third=f.current.uploadProfileImage(asset,"banner",{upload,signal:controller.signal});});f.renderer.act(()=>controller.abort());assert.equal(await third,null);assert.equal(f.dialog(),undefined);
 let last;f.renderer.act(()=>{last=f.current.uploadProfileImage(asset,"banner",{upload});});f.close();assert.equal(await last,null);
 assert.equal(await f.current.uploadProfileImage(asset,"banner",{upload}),null);
});

function dialogFixture(){
 const renderer=createRenderer(),uploads=[],finishes=[],releases=[];let reduced=false;const decode=deferred(),abort=new AbortController();
 let disposed=false;
 const image={get width(){if(disposed)throw new Error("Disposed image width");return 3000;},get height(){if(disposed)throw new Error("Disposed image height");return 4000;},release:()=>{disposed=true;releases.push("image");}};
 const request={asset:{uri:"file:///portrait.heic",fileSize:1000},signal:abort.signal,finish:value=>{finishes.push(value);abort.abort();},upload:(...args)=>{const next={...deferred(),args};uploads.push(next);return next.promise;}};
 const native={...Object.fromEntries(["ActivityIndicator","Modal","Pressable","ScrollView","Text","View"].map(n=>[n,n])),StyleSheet:{create:v=>v},PanResponder:{create:config=>({panHandlers:config})}};
 const Component=execute("./ProfileImageCropDialog.ios.jsx",(name,local)=>{
  if(name==="react"||name==="react/jsx-runtime")return require(name);if(name==="react-native")return native;
  if(name==="expo-image")return {Image:"Image"};if(name==="react-native-safe-area-context")return {SafeAreaView:"SafeAreaView"};
  if(name==="expo-image-manipulator")return {ImageManipulator:{manipulate:()=>({renderAsync:()=>decode.promise,release:()=>releases.push("context")})}};
  if(name==="../hooks/useReducedMotion")return ()=>reduced;
  if(name==="../theme")return {colors:{},radius:{}};return local(name);
 });
 renderer.render(React.createElement(Component.default,{request}));
 const all=()=>walk(renderer.container),button=label=>all().find(n=>n.type==="Pressable"&&n.props.accessibilityLabel===label),frame=()=>all().find(n=>n.props?.testID==="profile-banner-crop-frame");
 return {renderer,uploads,finishes,releases,decode,image,abort,all,button,frame,reduce(value){reduced=value;renderer.render(React.createElement(Component.default,{request}));},close:()=>renderer.render(null),async ready(){decode.resolve(image);await settle(renderer);renderer.act(()=>frame().props.onLayout({nativeEvent:{layout:{width:360}}}));}};
}
test("real crop dialog applies an exact portrait 3:1 crop, blocks duplicate uploads and preserves adjustments on retry",async()=>{
 const f=dialogFixture();await f.ready();
 f.renderer.act(()=>f.button("Move down").props.onPress());
 const apply=f.button("Use this banner").props.onPress;f.renderer.act(()=>{void apply();void apply();});assert.equal(f.uploads.length,1);
 const selected=f.uploads[0].args[0];assert.equal(selected.profileImageRef,f.image);assert.equal(selected.profileCrop.y,0.4);assert.equal(selected.profileCrop.width,1);assert.equal(selected.profileCrop.height,0.25);
 f.uploads[0].reject(new Error("offline"));await settle(f.renderer);assert.equal(f.button("Use this banner").props.disabled,false);
 f.renderer.act(()=>void f.button("Use this banner").props.onPress());assert.deepEqual(f.uploads[1].args[0].profileCrop,selected.profileCrop);
 f.uploads[1].resolve("https://media.test/cropped.jpg");await settle(f.renderer);assert.deepEqual(f.finishes,["https://media.test/cropped.jpg"]);f.close();assert.deepEqual(f.releases.sort(),["context","image"]);
});
for (const failure of [
  { error: { source: "api", status: 403, message: "Confirm your email before uploading." }, expected: /Confirm your email/ },
  { error: { source: "media", userMessage: "Open the original in Photos and download it before choosing it again.", message: "file:///private-photo.jpg" }, expected: /Open the original in Photos/ },
  { error: new Error("file:///private-photo.jpg?token=secret"), expected: /Check your connection/ },
]) test(`crop upload failure preserves safe actionable guidance: ${failure.expected}`, async () => {
  const f = dialogFixture(); await f.ready();
  f.renderer.act(() => void f.button("Use this banner").props.onPress());
  f.uploads[0].reject(failure.error); await settle(f.renderer);
  const alert = f.all().find(node => node.props?.accessibilityRole === "alert");
  const text = walk(alert).map(node => node.text || "").join("");
  assert.match(text, failure.expected); assert.match(text, /crop is still here/);
  assert.doesNotMatch(text, /file:|private-photo|token=secret/);
  assert.equal(f.button("Use this banner").props.disabled, false); assert.deepEqual(f.finishes, []);
  f.close();
});
test("crop cancel aborts upload, ignores its late completion, and decoding after dismissal releases native pixels",async()=>{
 const f=dialogFixture();await f.ready();f.renderer.act(()=>void f.button("Use this banner").props.onPress());
 f.renderer.act(()=>f.button("Cancel banner adjustment").props.onPress());assert.equal(f.uploads[0].args[1].signal.aborted,true);assert.ok(f.releases.includes("image"),"cancellation releases the full-resolution preview before unmount");
 f.uploads[0].resolve("stale");await settle(f.renderer);assert.deepEqual(f.finishes,[null]);f.close();
 const late=dialogFixture();await Promise.resolve();late.close();late.decode.resolve(late.image);await settle(late.renderer);assert.deepEqual(late.releases.sort(),["context","image"]);
});
test("crop gesture and accessible controls clamp zoom and empty edges, reset restores center",async()=>{
 const f=dialogFixture();await f.ready();f.renderer.act(()=>f.button("Zoom in").props.onPress());
 f.renderer.act(()=>f.frame().props.onPanResponderGrant({nativeEvent:{touches:[{pageX:0,pageY:0}]}}));
 f.renderer.act(()=>f.frame().props.onPanResponderMove({nativeEvent:{touches:[{pageX:99999,pageY:-99999}]}}));
 f.renderer.act(()=>f.button("Reset crop").props.onPress());f.renderer.act(()=>void f.button("Use this banner").props.onPress());
 assert.deepEqual(f.uploads[0].args[0].profileCrop,{x:0,y:0.375,width:1,height:0.25});f.close();
});
test("Metro selects crop and encoder only on iOS, keeping Android and web paths",()=>{
 const {resolve}=require("metro-resolver");const context={originModulePath:fileURLToPath(new URL("../../App.js",import.meta.url)),assetExts:new Set(),sourceExts:["js","jsx","json","ts","tsx"],preferNativePlatform:true,mainFields:["react-native","browser","main"],getPackageForModule:()=>null,fileSystemLookup(path){try{const s=statSync(path);return {exists:true,type:s.isDirectory()?"d":"f",realPath:realpathSync(path)};}catch{return {exists:false};}}};
 for(const [platform,suffix]of [["ios","ios"],["android","native"],["web","web"]])assert.ok(resolve(context,"./src/lib/profileImageNormalizer",platform).filePath.endsWith(`profileImageNormalizer.${suffix}.js`));
 for(const [platform,suffix]of [["ios",".ios"],["android",""],["web",".web"]])assert.ok(resolve(context,"./src/hooks/useProfileImageUpload",platform).filePath.endsWith(`useProfileImageUpload${suffix}.js`));
});

test("retained editor hides cancel the crop and revealing cannot resurrect the obsolete modal",async()=>{
 const f=hookFixture();let pending;f.renderer.act(()=>{pending=f.current.uploadProfileImage({uri:"file:///original.jpg"},"banner",{upload:async()=>"unused"});});
 const retired=f.dialog().props.request;f.hide();assert.equal(await pending,null);assert.equal(retired.signal.aborted,true);f.show();assert.equal(f.dialog(),undefined);
 let replacement;f.renderer.act(()=>{replacement=f.current.uploadProfileImage({uri:"file:///next.jpg"},"banner",{upload:async()=>"unused"});});assert.ok(f.dialog());f.close();assert.equal(await replacement,null);
});

test("crop modal exposes all controls to VoiceOver, supports escape, and follows Reduce Motion",async()=>{
 const f=dialogFixture();await f.ready();
 const modal=()=>f.all().find(n=>n.type==="Modal");
 assert.equal(modal().props.animationType,"slide");f.reduce(true);assert.equal(modal().props.animationType,"none");f.reduce(false);assert.equal(modal().props.animationType,"slide");
 const isolated=f.all().filter(n=>n.props?.accessibilityViewIsModal);assert.equal(isolated.length,1);assert.equal(isolated[0].type,"SafeAreaView");
 assert.ok(walk(isolated[0]).includes(f.button("Use this banner")));assert.ok(walk(isolated[0]).includes(f.button("Zoom in")));
 f.renderer.act(()=>isolated[0].props.onAccessibilityEscape());assert.deepEqual(f.finishes,[null]);f.close();
});

test("an aborted retained crop can rerender after native image disposal without reading its getters",async()=>{
 const f=dialogFixture();await f.ready();
 const oldMove=f.frame().props.onPanResponderMove,oldApply=f.button("Use this banner").props.onPress;
 // Simulate a retained child still rendering while parent modal removal waits.
 f.abort.abort();assert.throws(()=>f.image.width,/Disposed image/);
 assert.doesNotThrow(()=>f.reduce(true));assert.doesNotThrow(()=>f.reduce(false));
 f.renderer.act(()=>f.frame().props.onLayout({nativeEvent:{layout:{width:420}}}));
 f.renderer.act(()=>{oldMove({nativeEvent:{touches:[{pageX:20,pageY:30}]}});void oldApply();});
 assert.equal(f.all().some(n=>n.type==="Image"),false);assert.equal(f.button("Use this banner").props.disabled,true);assert.equal(f.uploads.length,0);
 f.close();assert.equal(f.releases.filter(value=>value==="image").length,1);
});
