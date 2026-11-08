import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as controller from './venueReviewIOSController.mjs';
import { createAccountTaskScope } from '../domain/accountTaskScope.mjs';
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('./VenueReviewScreen.jsx', import.meta.url), 'utf8');
const compiled = require('@babel/core').transformSync(source, { babelrc:false, configFile:false, plugins:[
  [require('@babel/plugin-transform-react-jsx'), { runtime:'automatic' }], require('@babel/plugin-transform-modules-commonjs'),
]}).code;
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const node = (tree, type) => nodes(tree).find(n => n.type === type);
const defer = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b;}); return {promise,resolve,reject}; };
function fixture(os='ios') {
  let cursor=0, refCursor=0, effectCursor=0, closed=0, venueName='The Room', ignoreClose=false, failClose=false;
  const states=[], refs=[], effects=[], alerts=[], saves=[], picks=[], uploads=[];
  const session={id:'a'}, guardRef={current:null};
  const tasks=createAccountTaskScope(); tasks.setAccount('a'); tasks.mount();
  const post=defer(), picker=defer(), upload=defer(), uploadStarted=defer();
  const jsx=(type,props,key)=>({type,props,key});
  const deps={
    react:{useState(initial){const i=cursor++; if (!(i in states)) states[i]=initial; return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];}, useRef(initial){return refs[refCursor++] ||= {current:initial};}, useEffect(fn){const i=effectCursor++; if (!(i in effects)) effects[i]=fn();}},
    'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{...Object.fromEntries(['View','Text','ScrollView','TextInput','Pressable','Image'].map(n=>[n,n])),Platform:{OS:os},Alert:{alert:(...a)=>alerts.push(a)},StyleSheet:{create:s=>s,absoluteFill:{}}},
    'expo-image-picker':{launchImageLibraryAsync:options=>{picks.push(options); return picker.promise;}},
    '../theme':{colors:{},radius:{}},
    '../store':{useStore:()=>({session,addVenueReview:(venue,payload)=>{saves.push({venue,payload});return post.promise;}})},
    '../hooks/useAccountTaskScope':{useAccountTaskScope:id=>{tasks.setAccount(id); return tasks;}},
    '../lib/mediaUpload':{isDurableMediaUrl:v=>v.startsWith('https://'),reportMediaPickerError:()=>{},uploadMediaAsset:(asset,purpose,options)=>{uploads.push({asset,purpose,options});uploadStarted.resolve();return upload.promise;}},
    '../domain/mediaPickerOptions.mjs':{postMediaPickerOptions:options=>options},
    '../domain/mediaUploadPolicy.mjs':{MEDIA_POST_MAX_ATTACHMENTS:8},
    './venueReviewIOSController.mjs':controller,
    ...Object.fromEntries(['ScreenHeader','Icon','TapStars','Button'].map(n=>[`../components/${n}`,n])),
  };
  const module={exports:{}};
  new vm.Script(compiled).runInNewContext({module,exports:module.exports,require:name=>{assert.ok(Object.hasOwn(deps,name),name);return deps[name];}});
  const back=()=>failClose ? (()=>{throw new Error('navigation failed');})() : ignoreClose ? undefined : guardRef.current?guardRef.current({proceed:()=>closed++}):closed++;
  const render=()=>{cursor=refCursor=effectCursor=0;return module.exports.default({venueName,onClose:back,closeGuardRef:guardRef});};
  return {render,back,states,post,picker,upload,uploadStarted,saves,picks,uploads,alerts,session,tasks,guardRef,get closed(){return closed;},failClose(value){failClose=value;},ignoreClose(value){ignoreClose=value;},venue(value){venueName=value;},dispose(){effects.forEach(f=>f?.());tasks.dispose();}};
}
const rate=(f)=>{node(f.render(),'TapStars').props.onChange(4);};
const headerPost=tree=>node(tree,'ScreenHeader').props.right.props.onPress;
const add=tree=>nodes(tree).find(n=>n.type==='Pressable'&&nodes(n).some(c=>c.type==='Icon'&&c.props.name==='camera')).props.onPress;
const consent=tree=>nodes(tree).find(n=>n.props.accessibilityRole==='checkbox');

test('same-frame top and bottom Post submit exactly once, lock stale editing and close once',async()=>{
  const f=fixture();rate(f);const tree=f.render();
  const first=headerPost(tree)(), second=node(tree,'Button').props.onPress();
  node(tree,'TapStars').props.onChange(1);node(tree,'TextInput').props.onChangeText('late edit');
  assert.equal(f.saves.length,1);assert.equal(f.saves[0].payload.rating,4);assert.equal(f.states[0],4);assert.equal(f.states[1],'');
  f.back();assert.equal(f.closed,0);assert.equal(f.alerts[0][0],'Review in progress');
  f.post.resolve({ok:true});await Promise.all([first,second]);assert.equal(f.closed,1);
  await headerPost(tree)();assert.equal(f.saves.length,1);
});
test('dirty same-frame header Back offers keep/discard; root close and old alert cannot close twice',()=>{
  const f=fixture();const tree=f.render();node(tree,'TextInput').props.onChangeText('Keep this');
  node(tree,'ScreenHeader').props.onBack();assert.equal(f.closed,0);f.alerts[0][2][0].onPress();
  assert.equal(node(f.render(),'TextInput').props.value,'Keep this');
  f.back();f.alerts[1][2][1].onPress();f.alerts[1][2][1].onPress();assert.equal(f.closed,1);
});
test('picker launch is single-flight, blocks close and Post before render, cancellation releases it',async()=>{
  const f=fixture();rate(f);const tree=f.render();const first=add(tree)();await add(tree)();await headerPost(tree)();
  assert.equal(f.picks.length,1);assert.equal(f.saves.length,0);f.back();assert.equal(f.closed,0);
  f.alerts[0][2][0].onPress();f.picker.resolve({canceled:true});await first;
  const save=headerPost(f.render())();assert.equal(f.saves.length,1);f.post.resolve({ok:true});await save;assert.equal(f.closed,1);
});
for(const outcome of ['rejected','false']) test(`failed ${outcome} post retains rating/text/photos/consent and does not resend`,async()=>{
  const f=fixture();rate(f);node(f.render(),'TextInput').props.onChangeText('My review');
  const pick=add(f.render())();f.picker.resolve({assets:[{uri:'file:///a.jpg'}]});await f.uploadStarted.promise;
  f.upload.resolve('https://media.example/a.jpg');await pick;
  assert.equal(consent(f.render()).props.accessibilityState.checked,false);
  consent(f.render()).props.onPress();const save=headerPost(f.render())();
  assert.equal(f.saves[0].payload.photosPublic,true);
  if(outcome==='false')f.post.resolve({ok:false});else f.post.reject(new Error('offline'));await save;
  const tree=f.render();assert.equal(f.closed,0);assert.equal(f.saves.length,1);
  assert.equal(node(tree,'TapStars').props.value,4);assert.equal(node(tree,'TextInput').props.value,'My review');assert.equal(consent(tree).props.accessibilityState.checked,true);
  assert.equal(f.states[2][0],'https://media.example/a.jpg');assert.ok(nodes(tree).some(n=>n.props.accessibilityRole==='alert'));assert.equal(node(tree,'Button').props.disabled,false);
});
for(const boundary of ['switch','logout','round-trip','venue','unmount']) test(`${boundary} fences pending picker and posting completion`,async()=>{
  for(const operation of ['picker','post']) {
    const f=fixture();rate(f);const work=operation==='picker'?add(f.render())():headerPost(f.render())();
    if(boundary==='unmount')f.dispose();else if(boundary==='venue'){f.venue('Other Room');f.render();}else{f.session.id=boundary==='logout'?null:'b';f.render();if(boundary==='round-trip'){f.session.id='a';f.render();}}
    const before=JSON.stringify(f.states);
    if(operation==='picker')f.picker.resolve({assets:[{uri:'file:///a.jpg'}]});else f.post.resolve({ok:true});
    await work;assert.equal(f.closed,0);assert.equal(f.uploads.length,0);assert.equal(JSON.stringify(f.states),before);
  }
});
for(const os of ['android','web']) test(`${os} retains original close and same-frame submission behavior`,async()=>{
  const f=fixture(os);rate(f);const tree=f.render();node(tree,'ScreenHeader').props.onBack();assert.equal(f.closed,1);assert.equal(f.guardRef.current,null);assert.equal(f.alerts.length,0);
  const a=headerPost(tree)(),b=node(tree,'Button').props.onPress();assert.equal(f.saves.length,2);f.post.resolve({ok:true});await Promise.all([a,b]);assert.equal(f.closed,3);
});
test('root mounts account, auth epoch, and venue keyed iOS ownership with the shared close guard',()=>{
  const app=readFileSync(new URL('../../App.js',import.meta.url),'utf8');
  const route=app.split('\n').find(line=>line.includes('overlay = <VenueReviewScreen'));
  assert.match(route,/closeGuardRef=\{Platform.OS === "ios" \? composerCloseGuardRef : null\}/);
  assert.match(route,/chatAuthEpoch/);assert.match(route,/session\?\.id/);assert.match(route,/nav\.venueReview/);
});

test('upload ownership blocks close and Post; stale remove and consent handlers cannot change a posting review',async()=>{
  const f=fixture();rate(f);const picking=add(f.render())();
  f.picker.resolve({assets:[{uri:'file:///a.jpg'}]});await f.uploadStarted.promise;
  assert.equal(f.uploads.length,1);f.back();assert.equal(f.closed,0);assert.equal(f.saves.length,0);
  f.alerts[0][2][0].onPress();f.upload.resolve('https://media.example/a.jpg');await picking;
  const tree=f.render(), checkbox=consent(tree), remove=nodes(tree).find(n=>n.props.accessibilityLabel==='Remove venue photo 1');
  const posting=headerPost(tree)();checkbox.props.onPress();remove.props.onPress();
  assert.equal(f.states[3],false);assert.equal(f.states[2].length,1);assert.equal(f.saves[0].payload.photosPublic,false);
  assert.deepEqual([...f.saves[0].payload.photos],['https://media.example/a.jpg']);
  f.post.resolve({ok:true});await posting;assert.equal(f.closed,1);
});
for(const boundary of ['switch','logout','round-trip','venue','unmount']) test(`${boundary} aborts upload and ignores late attachment`,async()=>{
  const f=fixture();const picking=add(f.render())();f.picker.resolve({assets:[{uri:'file:///a.jpg'}]});await f.uploadStarted.promise;
  assert.equal(f.uploads.length,1);
  if(boundary==='unmount')f.dispose();else if(boundary==='venue'){f.venue('Next');f.render();}else{f.session.id=boundary==='logout'?null:'b';f.render();if(boundary==='round-trip'){f.session.id='a';f.render();}}
  assert.equal(f.uploads[0].options.signal.aborted,true);const before=JSON.stringify(f.states);
  f.upload.resolve('https://media.example/stale.jpg');await picking;assert.equal(JSON.stringify(f.states),before);
});
test('failed post releases ownership for one deliberate retry, never an automatic resend',async()=>{
  const f=fixture();rate(f);const first=headerPost(f.render())();f.post.resolve({ok:false});await first;
  assert.equal(f.saves.length,1);const tree=f.render();await Promise.all([headerPost(tree)(),node(tree,'Button').props.onPress()]);assert.equal(f.saves.length,2);
});
test('discard alert cannot close a later venue or unmounted review',()=>{
  for(const boundary of ['venue','unmount']){const f=fixture();rate(f);f.back();if(boundary==='unmount')f.dispose();else{f.venue('Next');f.render();}f.alerts[0][2][1].onPress();assert.equal(f.closed,0);}
});


test('no-op navigation after discard leaves the editor usable; a published review can leave but cannot repost',async()=>{
  const discard=fixture();rate(discard);discard.ignoreClose(true);node(discard.render(),'ScreenHeader').props.onBack();discard.alerts[0][2][1].onPress();
  node(discard.render(),'TextInput').props.onChangeText('Still editable');assert.equal(discard.states[1],'Still editable');
  discard.ignoreClose(false);discard.back();discard.alerts[1][2][1].onPress();assert.equal(discard.closed,1);
  const f=fixture();rate(f);f.ignoreClose(true);const save=headerPost(f.render())();f.post.resolve({ok:true});await save;
  assert.equal(f.states[5],false,'posting state clears even if navigation did nothing');
  await headerPost(f.render())();assert.equal(f.saves.length,1,'a confirmed review never sends again');
  f.ignoreClose(false);f.back();assert.equal(f.closed,1);assert.equal(f.alerts.length,0,'already posted review can leave without a discard warning');
});

test('throwing navigation cannot mislabel a confirmed post or permit duplicate publication',async()=>{
  const f=fixture();rate(f);f.failClose(true);const save=headerPost(f.render())();f.post.resolve({ok:true});await save;
  assert.equal(f.states[5],false);assert.match(f.states[6],/was posted/);
  await headerPost(f.render())();assert.equal(f.saves.length,1);
  f.failClose(false);f.back();assert.equal(f.closed,1);
});

const flatten = style => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flatten)) : style || {};
test('iOS venue form labels, keyboard behavior, busy rating and contained touch regions are explicit',async()=>{
  const f=fixture();rate(f);let tree=f.render();
  assert.equal(node(tree,'TapStars').props.accessibilityLabel,'Venue rating');assert.equal(node(tree,'TapStars').props.disabled,false);
  assert.equal(node(tree,'TextInput').props.accessibilityLabel,'Venue review');
  assert.equal(node(tree,'ScrollView').props.automaticallyAdjustKeyboardInsets,true);assert.equal(node(tree,'ScrollView').props.keyboardDismissMode,'interactive');
  const header=node(tree,'ScreenHeader').props.right;
  assert.equal(flatten(header.props.style).minHeight,44);assert.equal(flatten(header.props.style).minWidth,44);
  assert.equal(flatten(node(header,'Text').props.style).textAlign,'center');
  const addButton=nodes(tree).find(n=>n.props.accessibilityLabel==='Add venue photos');
  assert.equal(addButton.props.accessibilityRole,'button');assert.equal(flatten(addButton.props.style).height,'auto');assert.equal(flatten(addButton.props.style).minHeight,76);
  const picking=addButton.props.onPress();tree=f.render();assert.equal(node(tree,'TapStars').props.disabled,true);
  f.picker.resolve({assets:[{uri:'file:///a.jpg'}]});await f.uploadStarted.promise;f.upload.resolve('https://media.example/a.jpg');await picking;
  tree=f.render();const remove=nodes(tree).find(n=>n.props.accessibilityLabel==='Remove venue photo 1');const bounds=flatten(remove.props.style);
  assert.equal(bounds.width,44);assert.equal(bounds.height,44);assert.ok(bounds.top+bounds.height<=76);assert.ok(bounds.right+bounds.width<=76);
  const saving=headerPost(tree)();tree=f.render();assert.equal(node(tree,'TapStars').props.disabled,true);assert.equal(node(tree,'TextInput').props.editable,false);f.post.resolve({ok:false});await saving;
  assert.equal(node(f.render(),'TapStars').props.disabled,false);
});
for(const os of ['android','web']) test(`${os} keeps original venue field props and touch styles`,()=>{
  const tree=fixture(os).render();assert.equal(node(tree,'TapStars').props.accessibilityLabel,undefined);assert.equal(node(tree,'TapStars').props.disabled,undefined);
  assert.equal(node(tree,'TextInput').props.accessibilityLabel,undefined);assert.equal(node(tree,'ScrollView').props.automaticallyAdjustKeyboardInsets,undefined);assert.equal(node(tree,'ScrollView').props.keyboardDismissMode,undefined);
  assert.equal(flatten(node(tree,'ScreenHeader').props.right.props.style).minHeight,undefined);
  const addButton=nodes(tree).find(n=>n.type==='Pressable'&&nodes(n).some(c=>c.type==='Icon'&&c.props.name==='camera'));
  assert.equal(addButton.props.accessibilityRole,undefined);assert.equal(flatten(addButton.props.style).height,76);
});
test('TapStars disabled opt-in blocks touch, keyboard and VoiceOver while default behavior remains adjustable',()=>{
  const text=readFileSync(new URL('../components/TapStars.jsx',import.meta.url),'utf8');
  const code=require('@babel/core').transformSync(text,{babelrc:false,configFile:false,plugins:[[require('@babel/plugin-transform-react-jsx'),{runtime:'automatic'}],require('@babel/plugin-transform-modules-commonjs')]}).code;
  const jsx=(type,props)=>({type,props}), module={exports:{}};
  const deps={'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',Pressable:'Pressable'},'react-native-svg':{__esModule:true,default:'Svg',Polygon:'Polygon'},'../theme':{colors:{},focusRing:{}}};
  new vm.Script(code).runInNewContext({module,exports:module.exports,require:name=>{assert.ok(Object.hasOwn(deps,name),name);return deps[name];}});
  for(const disabled of [undefined,true]){
    const changed=[];const tree=module.exports.default({value:3,onChange:v=>changed.push(v),disabled});
    tree.props.onPress({nativeEvent:{locationX:20}});tree.props.onAccessibilityAction({nativeEvent:{actionName:'increment'}});tree.props.onKeyDown({key:'End'});
    if(disabled){assert.equal(changed.length,0);assert.equal(tree.props.accessibilityState.disabled,true);assert.equal(tree.props.accessibilityActions.length,0);}
    else{assert.deepEqual(changed,[1,3.5,5]);assert.equal(tree.props.accessibilityLabel,'Rating');assert.equal(tree.props.accessibilityRole,'adjustable');assert.equal(tree.props.accessibilityState,undefined);assert.equal(tree.props.accessibilityActions.length,2);}
  }
});
for(const result of [undefined,null,{}]) test(`iOS malformed result ${JSON.stringify(result)} keeps draft unconfirmed`,async()=>{
  const f=fixture();rate(f);node(f.render(),'TextInput').props.onChangeText('Keep my review');const saving=headerPost(f.render())();f.post.resolve(result);await saving;
  assert.equal(f.closed,0);assert.equal(f.states[0],4);assert.equal(f.states[1],'Keep my review');assert.match(f.states[6],/could not be confirmed/);assert.equal(f.states[5],false);
  node(f.render(),'TextInput').props.onChangeText('Still editable');assert.equal(f.states[1],'Still editable');assert.equal(f.saves.length,1);
});
for(const os of ['android','web']) test(`${os} preserves legacy malformed-result behavior`,async()=>{
  const f=fixture(os);rate(f);const saving=headerPost(f.render())();f.post.resolve(undefined);await saving;assert.equal(f.closed,1);
});
