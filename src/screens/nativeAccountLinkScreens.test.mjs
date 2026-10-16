import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transformSync } from '@babel/core';
import * as validation from '../domain/validation.mjs';
import * as accountLinks from '../domain/nativeAccountLink.mjs';
import * as origins from '../domain/apiOrigin.mjs';
const require=createRequire(import.meta.url),tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const nodes=node=>Array.isArray(node)?node.flatMap(nodes):node&&typeof node==='object'?[node,...nodes(node.props?.children)]:[];
const words=tree=>nodes(tree).filter(n=>n.type==='Text').map(n=>nodesText(n.props.children)).join(' ');
function nodesText(value){return Array.isArray(value)?value.map(nodesText).join(''):typeof value==='string'?value:typeof value==='object'&&value?nodesText(value.props?.children):'';}
function fixture(file,store,props={},extra={}){
 const source=readFileSync(new URL(file,import.meta.url),'utf8');
 const compiled=transformSync(source,{filename:file,configFile:false,babelrc:false,plugins:[[require('@babel/plugin-transform-react-jsx'),{runtime:'automatic'}],require('@babel/plugin-transform-modules-commonjs')]}).code;
 const states=[],refs=[],effects=[],queue=[];let si=0,ri=0,ei=0;
 const effect=(create,deps=[])=>{const i=ei++,old=effects[i];if(old&&deps.length===old.deps.length&&deps.every((v,n)=>Object.is(v,old.deps[n])))return;queue.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:create()};});};
 const componentNames=['View','Text','Pressable','ScrollView','ActivityIndicator'];
 const module={exports:{}};
 const seams=name=>{
  if(extra[name])return extra[name];
  if(name==='react')return{useState(initial){const i=si++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useRef(initial){return refs[ri++]||=( {current:initial});},useEffect:effect,useLayoutEffect:effect};
  if(name==='react-native')return{...Object.fromEntries(componentNames.map(n=>[n,n])),StyleSheet:{create:v=>v,absoluteFill:{}},Linking:{},BackHandler:{addEventListener:()=>({remove(){}})}};
  if(name==='../store')return{useStore:()=>store};
  if(name==='../theme')return{colors:{},space:n=>n*4,radius:{}};
  if(name==='../domain/validation.mjs')return validation;
  if(name==='../domain/nativeAccountLink.mjs')return accountLinks;
  if(name==='../domain/apiOrigin.mjs')return origins;
  if(name==='../components/credential-form')return{__esModule:true,default:'CredentialForm',CredentialInput:'CredentialInput',CredentialLabel:'CredentialLabel',CredentialSubmit:'CredentialSubmit'};
  if(name.startsWith('../components/')||name.startsWith('./'))return{__esModule:true,default:name};
  return require(name);
 };
 new Function('require','module','exports',compiled)(seams,module,module.exports);
 const render=()=>{si=0;ri=0;ei=0;const tree=module.exports.default(props);while(queue.length)queue.shift()();return nodes(tree);};
 return{render,unmount:()=>effects.forEach(e=>e?.cleanup?.()),props};
}
test('actual verify screen never submits on mount and represents wrong-account completion without switching',async()=>{
 let requests=0;const store={session:{id:'A',emailVerified:true},confirmEmailVerification:async()=>{requests++;return{verified:true,sessionUpdated:false};}};
 const f=fixture('./VerifyEmailScreen.jsx',store,{token:'synthetic-token'});let tree=f.render();assert.equal(requests,0);
 await tree.find(n=>n.type==='Pressable'&&words(n).includes('Confirm my email')).props.onPress();tree=f.render();
 assert.equal(requests,1);assert.match(words(tree),/another account.*current account has not changed/);assert.equal(store.session.id,'A');f.unmount();
});
test('expired/replaced verification shows latest-email recovery, and network failure permits explicit retry only',async()=>{
 for(const result of ['invalid','failed']){let requests=0;const f=fixture('./VerifyEmailScreen.jsx',{session:{id:'A',emailVerified:false},confirmEmailVerification:async()=>{requests++;if(result==='failed')throw Error('synthetic');return{verified:false};}},{token:'synthetic-token'});
 let tree=f.render();await tree.find(n=>n.type==='Pressable'&&words(n).includes('Confirm my email')).props.onPress();tree=f.render();
 assert.equal(requests,1);assert.match(words(tree),result==='invalid'?/expired, or replaced by a resend/:/safe to try this link again/);f.render();assert.equal(requests,1);f.unmount();}
});
test('verify replacement/revalidation aborts held request synchronously and late success cannot overwrite recovery',async()=>{
 const held=deferred(),abort={current:null};let signal,consumed=0;
 const f=fixture('./VerifyEmailScreen.jsx',{confirmEmailVerification:(_t,o)=>{signal=o.signal;return held.promise;}},{token:'synthetic-token',navigationAbortRef:abort,onConsumed:()=>consumed++});
 const pending=f.render().find(n=>n.type==='Pressable'&&words(n).includes('Confirm my email')).props.onPress();abort.current();assert.equal(signal.aborted,true);held.resolve({verified:true,sessionUpdated:true});await pending;
 assert.equal(consumed,0);assert.match(words(f.render()),/safe to try this link again/);f.unmount();
});
function resetFixture(resetPassword,session=null){const abort={current:null},f=fixture('./ResetPasswordScreen.jsx',{resetPassword,session},{token:'synthetic-token',navigationAbortRef:abort});
 const submit=()=>{let tree=f.render();for(const name of ['new-password','confirm-password'])tree.find(n=>n.type==='CredentialInput'&&n.props.name===name).props.onChangeText('Synthetic-password1');tree=f.render();return tree.find(n=>n.type==='CredentialForm').props.onSubmit();};return{...f,abort,submit};}
test('actual reset warns signed-in account, never auto submits and renders rejected/uncertain recovery',async()=>{
 for(const outcome of ['rejected','uncertain']){let requests=0;const f=resetFixture(async()=>{requests++;return{ok:false,outcome,error:outcome==='uncertain'?'Your password may already have changed.':'Link expired or replaced.'};},{id:'A',handle:'fixture-a'});
 assert.equal(requests,0);assert.match(words(f.render()),/Resetting will switch to the account/);await f.submit();const text=words(f.render());assert.equal(requests,1);assert.match(text,/Request a new reset link/);assert.match(text,outcome==='uncertain'?/Log in with the new password/:/Go to log in/);f.unmount();}
});
test('reset cancellation clears both password fields and fences late completion',async()=>{
 const held=deferred();let signal;const f=resetFixture((_t,_p,o)=>{signal=o.signal;return held.promise;});let done=0;f.props.onDone=()=>done++;
 const pending=f.submit();f.abort.current();assert.equal(signal.aborted,true);held.resolve({ok:true});await pending;const tree=f.render();
 assert.equal(done,0);for(const name of ['new-password','confirm-password'])assert.equal(tree.find(n=>n.type==='CredentialInput'&&n.props.name===name).props.value,'');assert.match(words(tree),/reset was interrupted/);f.unmount();
});
test('actual native gateway mounts cold link once, preserves same-account revalidation and makes identity change token-free',async()=>{
 const initial=deferred();let listener,enters=0,abortCalls=0;
 const store={authReady:false,session:null};
 const rn={View:'View',Text:'Text',Pressable:'Pressable',ActivityIndicator:'ActivityIndicator',StyleSheet:{create:v=>v,absoluteFill:{}},Linking:{getInitialURL:()=>initial.promise,addEventListener:(_t,fn)=>{listener=fn;return{remove(){}};}},BackHandler:{addEventListener:()=>({remove(){}})}};
 const f=fixture('./NativeAccountLinks.native.jsx',store,{onEnter:()=>enters++},{'react-native':rn});f.render();initial.resolve('https://www.mshpit.com/#reset=synthetic_token_123456789012345');await tick();
 store.authReady=true;store.session={id:'A'};f.render();let tree=f.render();const form=tree.find(n=>n.type==='./ResetPasswordScreen');assert.ok(form);form.props.navigationAbortRef.current=()=>abortCalls++;
 assert.equal(enters,1);listener({url:'https://www.mshpit.com/#reset=synthetic_token_123456789012345'});f.render();assert.equal(enters,1);
 store.authReady=false;tree=f.render();assert.ok(tree.find(n=>n.type==='./ResetPasswordScreen'));assert.ok(tree.find(n=>n.props?.accessibilityLabel==='Checking your account'));assert.ok(abortCalls>0);
 store.authReady=true;f.render();assert.equal(enters,1);
 // This is also the signed-in reset -> safety logout sequence on uncertain response.
 store.session=null;f.render();tree=f.render();assert.match(words(tree),/If you submitted a new password, it may already have been saved/);assert.ok(!tree.find(n=>n.type==='./ResetPasswordScreen'));assert.ok(!tree.some(n=>n.props?.token));
 const login=tree.find(n=>n.type==='Pressable'&&words(n)==='Go to log in');login.props.onPress();tree=f.render();assert.equal(tree.find(n=>n.type==='./AuthScreen').props.initialMode,'login');f.unmount();
});

test('authoritative reset retires gateway before B is published; recovery login cannot re-show old reset',async()=>{
 const initial=deferred();let listener;const store={authReady:true,session:{id:'A'}};
 const rn={View:'View',Text:'Text',Pressable:'Pressable',ActivityIndicator:'ActivityIndicator',StyleSheet:{create:v=>v,absoluteFill:{}},Linking:{getInitialURL:()=>initial.promise,addEventListener:(_t,fn)=>{listener=fn;return{remove(){}};}},BackHandler:{addEventListener:()=>({remove(){}})}};
 const f=fixture('./NativeAccountLinks.native.jsx',store,{}, {'react-native':rn});f.render();initial.resolve('https://www.mshpit.com/#reset=synthetic_accept_123456789012345');await tick();
 let tree=f.render(),form=tree.find(n=>n.type==='./ResetPasswordScreen'),aborted=0;form.props.navigationAbortRef.current=()=>aborted++;
 // The actual Store callback invokes onAccepted before absorbServerUser publishes B.
 form.props.onAccepted();store.session={id:'B'};f.render();tree=f.render();assert.equal(aborted,0);assert.ok(!tree.find(n=>n.type==='./ResetPasswordScreen'));assert.doesNotMatch(words(tree),/may already have been saved/);
 listener({url:'https://www.mshpit.com/#reset=synthetic_recover_123456789012345'});tree=f.render();form=tree.find(n=>n.type==='./ResetPasswordScreen');form.props.onLogin();tree=f.render();assert.ok(tree.find(n=>n.type==='./AuthScreen'));
 store.session={id:'C'};f.render();tree=f.render();assert.doesNotMatch(words(tree),/may already have been saved/);assert.ok(!tree.some(n=>n.props?.token));f.unmount();
});


function gatewayActivityFixture() {
 const initial=deferred(),store={authReady:true,session:null};let listener,active=false;
 const activeRef={current:false},publish=value=>{active=value;activeRef.current=value;};
 const rn={View:'View',Text:'Text',Pressable:'Pressable',ActivityIndicator:'ActivityIndicator',StyleSheet:{create:v=>v,absoluteFill:{}},Linking:{getInitialURL:()=>initial.promise,addEventListener:(_t,fn)=>{listener=fn;return{remove(){}};}},BackHandler:{addEventListener:()=>({remove(){}})}};
 const f=fixture('./NativeAccountLinks.native.jsx',store,{onEnter:()=>publish(true),onActiveChange:publish},{'react-native':rn});
 f.render();
 return{...f,store,activeRef,get active(){return active;},deliver:url=>listener({url})};
}

for(const [kind,fragment] of [['verify','verify=synthetic_token_123456789012345'],['invalid','verify=short']]) {
 test('retiring '+kind+' before its first visible render clears synchronous account-link activity',()=>{
  const f=gatewayActivityFixture();
  f.deliver('https://www.mshpit.com/#'+fragment);assert.equal(f.active,true);assert.equal(f.activeRef.current,true);
  // A login/session result and link delivery can be batched before React paints.
  f.store.session={id:'new-account'};f.render();
  assert.equal(f.active,false,'identity invalidation must clear activity even when visibility stays false');
  assert.equal(f.activeRef.current,false);assert.equal(f.render().length,0);
  f.unmount();
 });
}

test('reset interruption and revalidation retain activity until explicit close or disposal',()=>{
 const f=gatewayActivityFixture();
 f.deliver('https://www.mshpit.com/#reset=synthetic_token_123456789012345');
 f.store.session={id:'new-account'};f.render();let tree=f.render();
 assert.equal(f.active,true);assert.equal(f.activeRef.current,true);
 assert.match(words(tree),/If you submitted a new password, it may already have been saved/);
 f.store.authReady=false;f.render();assert.equal(f.active,true);assert.equal(f.activeRef.current,true);
 f.store.authReady=true;tree=f.render();
 tree.find(n=>n.type==='Pressable'&&words(n)==='Close').props.onPress();
 assert.equal(f.active,false);assert.equal(f.activeRef.current,false);assert.equal(f.render().length,0);
 f.deliver('https://www.mshpit.com/#verify=synthetic_dispose_123456789012345');assert.equal(f.active,true);
 f.unmount();assert.equal(f.active,false);assert.equal(f.activeRef.current,false);
});
