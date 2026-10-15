import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "@babel/core";
import { createNativeThemeRuntime, NATIVE_THEME_KEY } from "./nativeThemeRuntime.mjs";
const require = createRequire(import.meta.url);
const compiled = transformSync(readFileSync(new URL("../theme.js", import.meta.url), "utf8"), {
  babelrc:false, configFile:false, plugins:[require("@babel/plugin-transform-modules-commonjs")],
}).code;
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(initial = null, options = {}) {
  const data = new Map(initial ? [[NATIVE_THEME_KEY, JSON.stringify(initial)]] : []);
  const state = { reloads:0, errors:0, writes:0 };
  const storage = {
    getItemSync(key) { if(options.readFails) throw Error("read"); return data.get(key) ?? null; },
    setItemSync(key,value) { state.writes++; if(options.writeFails) throw Error("write"); if(!options.ignoreWrite)data.set(key,value); },
    removeItemSync(key) { data.delete(key); },
  };
  function launch() {
    const runtime = createNativeThemeRuntime(storage, () => { state.reloads++; if(options.reloadFails) return Promise.reject(Error("reload")); }, () => state.errors++);
    const module = {exports:{}};
    new Function("require","module","exports",compiled)(name => name === "react-native"
      ? {Platform:{OS:"android",select:values=>values.android ?? values.default}}
      : name === "./lib/themeRuntime" ? {...runtime,nativeThemeRuntime:true} : require(name),module,module.exports);
    return module.exports;
  }
  return {data,state,launch,storage};
}
test("native default is Stage and first account choice is persisted without server requests", async()=>{
  const f=setup(),t=f.launch();assert.equal(t.themeKey,"stage");t.syncNativeAccountTheme(null);await tick();assert.equal(f.state.reloads,0);
  t.syncNativeAccountTheme({id:"a",theme:"daylight"});await tick();assert.equal(f.state.reloads,1);
  assert.deepEqual(JSON.parse(f.data.get(NATIVE_THEME_KEY)),{theme:"daylight",ownerId:"a"});
  const relaunched=f.launch();assert.equal(relaunched.themeKey,"daylight");assert.equal(relaunched.colors.bg,"#FBF7F0");
  relaunched.syncNativeAccountTheme({id:"a",theme:"daylight"});await tick();assert.equal(f.state.reloads,1,"no account-sync reload loop");
});
test("another account and sign-out do not inherit the previous owner's local override",async()=>{
  const f=setup({theme:"neon",ownerId:"a"});let t=f.launch();t.syncNativeAccountTheme({id:"b",theme:"daylight"});await tick();t=f.launch();assert.equal(t.themeKey,"daylight");
  t.clearStoredTheme();t.syncNativeAccountTheme(null);await tick();assert.equal(f.launch().themeKey,"stage");assert.deepEqual(JSON.parse(f.data.get(NATIVE_THEME_KEY)),{theme:"stage",ownerId:"guest"});
});
test("same-account local override wins and guest choice cannot override a signed-in account",async()=>{
  const f=setup({theme:"forest",ownerId:"a"}),t=f.launch();t.syncNativeAccountTheme({id:"a",theme:"daylight"});await tick();assert.equal(f.launch().themeKey,"forest");assert.equal(f.state.reloads,0);
  const g=setup({theme:"forest",ownerId:"guest"}),guest=g.launch();guest.syncNativeAccountTheme({id:"a",theme:"daylight"});await tick();assert.equal(g.launch().themeKey,"daylight");
});
test("explicit local choice survives relaunch with its owner and clearing removes the whole pair",async()=>{
  const f=setup(),t=f.launch();t.setTheme("forest","a");await tick();assert.equal(f.launch().themeKey,"forest");assert.deepEqual(f.launch().storedThemeSelection(),{theme:"forest",ownerId:"a"});
  t.clearStoredTheme();assert.equal(f.data.has(NATIVE_THEME_KEY),false);
});
test("corrupt, unknown and inherited-property theme keys safely fall back to Stage",()=>{
  for(const theme of ["unknown","__proto__","constructor"]){const f=setup({theme,ownerId:"a"});assert.equal(f.launch().themeKey,"stage");}
  const f=setup();f.data.set(NATIVE_THEME_KEY,"broken-json");assert.equal(f.launch().themeKey,"stage");
});
test("unavailable reads and failed or unverified writes never trigger a reload loop",async()=>{
  for(const options of [{readFails:true},{writeFails:true},{ignoreWrite:true}]){const f=setup(null,options),t=f.launch();assert.equal(t.themeKey,"stage");t.syncNativeAccountTheme({id:"a",theme:"daylight"});await tick();assert.equal(f.state.reloads,0);}
});
test("duplicate reconciliation schedules one reload and rejected reload is contained",async()=>{
  const f=setup(null,{reloadFails:true}),t=f.launch();t.syncNativeAccountTheme({id:"a",theme:"daylight"});t.syncNativeAccountTheme({id:"a",theme:"daylight"});await tick();assert.equal(f.state.reloads,1);assert.equal(f.state.errors,1);assert.equal(f.launch().themeKey,"daylight");
});
test("native adapters use installed SQLite and Expo reload, while browser adapter keeps verified-pair policy",()=>{
  const native=readFileSync(new URL("./themeRuntime.native.js",import.meta.url),"utf8"),web=readFileSync(new URL("./themeRuntime.js",import.meta.url),"utf8"),store=readFileSync(new URL("../store.js",import.meta.url),"utf8");
  assert.match(native,/expo-sqlite\/kv-store/);assert.match(native,/reloadAppAsync/);assert.match(web,/writeThemePair\(window\.localStorage/);assert.match(web,/window\.location\.reload/);
  const sync=store.slice(store.indexOf("const syncAccountTheme ="),store.indexOf("// Keep dormant playlist"));assert.ok(sync.indexOf("if (syncNativeAccountTheme(account)) return;")<sync.indexOf('api("/api/me"'),"native reconciliation cannot issue account PATCH");
});
