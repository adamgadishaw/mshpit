import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { transformSync } from '@babel/core';
import { iosFeedFilterChoices, iosMenuSections } from '../domain/iosMenuSections.mjs';
import { iosBackSwipeCommits } from '../domain/iosNavigationPolicy.mjs';
const require = createRequire(import.meta.url);
const nodes = tree => !tree ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children)];
function load(name, { reduced = false, reader = false, fontScale = 1, queued = false } = {}) {
  const source = readFileSync(new URL(name, import.meta.url), 'utf8');
  const focus = [], gestures = [], jsx = (type, props) => ({type, props});
  const shared = [];
  const states = []; let stateIndex = 0, dirty = false;
  const refs = [], memos = [], effects = [], pending = [], queue = [];
  let refIndex = 0, memoIndex = 0, effectIndex = 0, sharedIndex = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const modules = {
    react: {
      useContext: () => false,
      useState: initial => { const i = stateIndex++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value; dirty = true; }]; },
      useMemo: (f, deps) => { const i = memoIndex++; if (!same(memos[i]?.deps, deps)) memos[i] = { deps, value: f() }; return memos[i].value; },
      useRef: v => refs[refIndex++] ||= {current:v},
      useLayoutEffect: (create, deps) => { const i = effectIndex++; if (!same(effects[i]?.deps, deps)) pending.push(() => { effects[i]?.cleanup?.(); effects[i] = {deps, create, cleanup:create()}; }); },
    }, 'react/jsx-runtime': {jsx,jsxs:jsx},
    'react-native': {AppState:{currentState:'active',addEventListener:()=>({remove:()=>{}})},AccessibilityInfo:{setAccessibilityFocus:n=>focus.push(n)},findNodeHandle:node=>node?.tag,
      Modal:'Modal',Pressable:'Pressable',ScrollView:'ScrollView',Text:'Text',View:'View',
      StyleSheet:{create:x=>x,absoluteFill:{position:'absolute'},hairlineWidth:1},useWindowDimensions:()=>({width:393,fontScale})},
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:59,bottom:34})},
    '../hooks/useIOSDetailBackBlock': { IOSDetailBackContext: { Provider: 'DetailBackProvider' } },
    '../theme':{colors:new Proxy({},{get:()=> '#888'}),font:'System'},
    '../domain/iosMenuSections.mjs':{iosFeedFilterChoices,iosMenuSections}, '../domain/iosNavigationPolicy.mjs':{iosBackSwipeCommits},
    './NativeScrollChrome.ios': { NativeScrollChromeContext: {} },
    '../domain/unreadBadge.mjs': require('../domain/unreadBadge.mjs'),
    './nativeFeedBackContext.mjs':{NativeFeedBackContext:{}},
    './Avatar':'Avatar','./BrandMark':'BrandMark','./Icon':'Icon','./NativeTabRail':'TabRail',
    '../hooks/useReducedMotion':()=>reduced, '../hooks/useScreenReaderEnabled':{__esModule:true,default:()=>reader,getConfirmedScreenReaderEnabled:()=>reader,subscribeConfirmedScreenReaderEnabled:()=>()=>{}},
    'react-native-worklets':{scheduleOnRN:(f,...args)=>queued ? queue.push(()=>f(...args)) : f(...args)},
    'react-native-reanimated':{__esModule:true,default:{View:'AnimatedView'},ReduceMotion:{System:'system'},
      useSharedValue:value=>{const i=sharedIndex++;return shared[i] ||= {get:()=>value,set:x=>{value=x;}};},useAnimatedStyle:f=>f(),useAnimatedProps:f=>f(),useAnimatedReaction:(prepare,react)=>react(prepare()),cancelAnimation:()=>{},withTiming:x=>x,withSpring:x=>x},
    'react-native-gesture-handler':{GestureDetector:'Detector',Gesture:{Pan:()=>{const g={};for(const method of ['enabled','maxPointers','activeOffsetX','failOffsetY','onTouchesDown','onUpdate','onEnd','onFinalize'])g[method]=value=>{g[`${method}Value`]=value;return g;};gestures.push(g);return g;}}},
  };
  const code=transformSync(source,{filename:name,babelrc:false,configFile:false,plugins:[[require('@babel/plugin-transform-react-jsx'),{runtime:'automatic'}],require('@babel/plugin-transform-modules-commonjs')]}).code;
  const module={exports:{}};
  new Function('require','module','exports',code)(key=>{assert.ok(key in modules,key);return modules[key];},module,module.exports);
  return {
    render: props => { let tree; do { dirty=false; stateIndex=0;refIndex=0;memoIndex=0;effectIndex=0;sharedIndex=0;tree=module.exports.default(props);while(pending.length)pending.shift()(); } while(dirty); return tree; },
    setReader: value => { reader=value; },
    unmount: () => effects.forEach(effect=>effect.cleanup?.()),
    replayLayoutEffects: () => { effects.forEach(effect=>effect.cleanup?.());effects.forEach(effect=>{effect.cleanup=effect.create();}); },
    flush: () => { while(queue.length)queue.shift()(); }, queue,focus,gestures,shared,
  };
}
const actions = Object.fromEntries(['near','venues','fanClubs','topRated','news','crew','activity','inbox','suggestion','manageProfile','settings','admin','newsroom','tourDates','requestArtist','calendar','clips','howItWorks'].map(key=>[key,()=>{}]));

test('iOS drawer preserves role-filtered routes and dismisses before navigation',()=>{
 const called=[],f=load('./IosMenuDrawer.ios.jsx');
 const tree=f.render({visible:true,onClose:()=>called.push('close'),openerRef:{current:{tag:9}},session:{id:'fan',role:'fan',name:'Example',handle:'fixture'},unread:3,activity:2,actions:{...actions,inbox:()=>called.push('inbox')}});
 const buttons=nodes(tree).filter(n=>n.type==='Pressable');
 assert.ok(buttons.some(n=>n.props.accessibilityLabel==='Create or claim artist page'));
 for(const title of ['Moderation','Newsroom','Events & tour dates'])assert.ok(!buttons.some(n=>n.props.accessibilityLabel===title));
 buttons.find(n=>n.props.accessibilityLabel==='Inbox, 3 unread').props.onPress();
 assert.deepEqual(called,['close','inbox']);assert.equal(tree.type,'Modal');assert.equal(tree.props.presentationStyle,'overFullScreen');
 tree.props.onDismiss();assert.deepEqual(f.focus,[]);
 assert.equal(nodes(tree).find(n=>n.props.accessibilityViewIsModal).props.onAccessibilityEscape,tree.props.onRequestClose);
});

test('drawer uses reduced motion and does not expose account actions to guests',()=>{
 const f=load('./IosMenuDrawer.ios.jsx',{reduced:true}),tree=f.render({visible:true,onClose:()=>{},actions,session:null});
 assert.equal(tree.props.animationType,'none');
 const labels=nodes(tree).map(n=>n.props.accessibilityLabel);
 assert.ok(labels.includes('Sign in to Mshpit'));assert.ok(!labels.includes('Settings'));assert.ok(!labels.includes('Your calendar'));
});

test('iOS primary controls preserve tap destinations and 44-point targets',()=>{
 const choices=[],f=load('./IosTabBar.ios.jsx'),tree=f.render({active:'discover',onChange:key=>choices.push(key)});
 const tabs=nodes(tree).filter(n=>n.props.accessibilityRole==='tab');tabs.forEach(n=>n.props.onPress());
 assert.deepEqual(choices,['feed','search','discover','you']);assert.equal(tabs[2].props.accessibilityState.selected,true);
 tabs.forEach(n=>assert.ok(n.props.style({pressed:false})[0].minHeight>=44));
 const header=load('./NativeAppHeader.ios.jsx').render({loggedIn:true,onMenu:()=>choices.push('menu'),onPost:()=>choices.push('post')});
 for(const label of ['Open side menu','Make a post']){const b=nodes(header).find(n=>n.props.accessibilityLabel===label);b.props.onPress();assert.ok(b.props.style({pressed:false})[0].minHeight>=44);}
 assert.deepEqual(choices.slice(-2),['menu','post']);
});

test('iOS detail header reserves matching space as the trailing action grows, shrinks or disappears',()=>{
 const f=load('./ScreenHeader.ios.jsx');let backs=0;
 const props={title:'A long concert title',onBack:()=>backs++,right:{type:'Action',props:{}}};
 for(const width of [44,100,64,44]){
  let tree=f.render(props);
  nodes(tree).find(n=>typeof n.props.onLayout==='function').props.onLayout({nativeEvent:{layout:{width}}});
  tree=f.render(props);
  const leading=tree.props.children[0],back=nodes(leading).find(n=>n.type==='Pressable');
  assert.equal(leading.props.style[1].width,width);
  assert.equal(back.props.style({pressed:false})[0].width,44,'extra reservation does not widen the Back control');
  assert.equal(tree.props.children[1].props.children[1].props.numberOfLines,2);
 }
 let tree=f.render({...props,right:null});
 nodes(tree).find(n=>typeof n.props.onLayout==='function').props.onLayout({nativeEvent:{layout:{width:44}}});
 tree=f.render({...props,right:null});
 assert.equal(tree.props.children[0].props.style[1].width,44);
 nodes(tree).find(n=>n.props.accessibilityRole==='button').props.onPress();assert.equal(backs,1);
});

test('detail back owns only a 20-point edge and commits deliberate completed drags',()=>{
 const f=load('./IosDetailNavigation.ios.jsx');let backs=0;
 const child={type:'Content',props:{}},tree=f.render({enabled:true,onBack:()=>backs++,children:child});
 const detector=nodes(tree).find(n=>n.type==='Detector'),edge=detector.props.children;
 assert.equal(edge.props.style.width,20);assert.equal(edge.props.style.top,52);assert.equal(detector.props.children.type,'View');
 assert.equal(nodes(tree).find(n=>n.type==='AnimatedView').props.children,child);
 const g=f.gestures.at(-1);assert.equal(g.maxPointersValue,1);
 let rejected=0;
 for(const event of [{allTouches:[],numberOfTouches:0},{allTouches:[{absoluteX:10,absoluteY:200}],numberOfTouches:2}])g.onTouchesDownValue(event,{fail:()=>rejected++});
 assert.equal(rejected,2);
 g.onTouchesDownValue({allTouches:[{absoluteX:10,absoluteY:200}],numberOfTouches:1},{fail:()=>assert.fail('valid edge touch rejected')});
 g.onUpdateValue({absoluteX:60});assert.equal(f.shared[2].get(),50);
 g.onUpdateValue({absoluteX:500});assert.equal(f.shared[2].get(),393*0.42);
 g.onEndValue({absoluteX:140,absoluteY:203,translationX:0,translationY:0},true);assert.equal(backs,1);
 g.onEndValue({absoluteX:140,absoluteY:203},false);g.onEndValue({absoluteX:35,absoluteY:203},true);assert.equal(backs,1);
 g.onFinalizeValue();assert.equal(f.shared[2].get(),0);
});

test('screen readers and protected screens retain explicit back without gesture strip',()=>{
 for(const options of [{reader:true,enabled:true},{reader:false,enabled:false}]){
  const f=load('./IosDetailNavigation.ios.jsx',options),tree=f.render({enabled:options.enabled,children:'Page'});
  assert.equal(f.gestures[0].enabledValue,false);assert.ok(!nodes(tree).some(n=>n.type==='Detector'));
 }
 const f=load('./IosDetailNavigation.ios.jsx',{reduced:true}),tree=f.render({enabled:true,children:'Page'});
 assert.equal(nodes(tree).find(n=>n.type==='AnimatedView').props.style[1].transform[0].translateX,0);
});

const completeBackDrag = (gesture, retired = false) => {
 gesture.onTouchesDownValue({allTouches:[{absoluteX:10,absoluteY:200}],numberOfTouches:1},{fail:()=>{ if (!retired) assert.fail("valid touch rejected"); }});
 gesture.onEndValue({absoluteX:140,absoluteY:203},true);
};

for (const interruption of ['unmount','disabled','reader','disabled round trip','reader round trip']) {
 test(`queued detail Back is revoked by ${interruption}`,()=>{
  const f=load('./IosDetailNavigation.ios.jsx',{queued:true});let backs=0;
  const props={enabled:true,onBack:()=>backs++};
  f.render(props);const oldGesture=f.gestures.at(-1);completeBackDrag(oldGesture);
  assert.equal(f.queue.length,1);assert.equal(backs,0);
  if(interruption==='unmount')f.unmount();
  else if(interruption.startsWith('disabled'))f.render({...props,enabled:false});
  else {f.setReader(true);f.render(props);}
  if(interruption.endsWith('round trip')){f.setReader(false);f.render(props);}
  f.flush();assert.equal(backs,0);
  // A delayed old worklet must also remain revoked after permissions return.
  completeBackDrag(oldGesture, true);f.flush();assert.equal(backs,0);
  if(interruption.endsWith('round trip')){completeBackDrag(f.gestures.at(-1));f.flush();assert.equal(backs,1);}
 });
}

test('layout replay retires queued Back and permits a fresh callback',()=>{
 const f=load('./IosDetailNavigation.ios.jsx',{queued:true}),calls=[];
 const props={enabled:true,onBack:()=>calls.push('current')};
 f.render(props);completeBackDrag(f.gestures.at(-1));
 f.replayLayoutEffects();f.render(props);f.flush();assert.deepEqual(calls,[]);
 completeBackDrag(f.gestures.at(-1));f.flush();assert.deepEqual(calls,['current']);
});

test('a replacement detail mount cannot inherit the outgoing screen queued Back',()=>{
 const outgoing=load('./IosDetailNavigation.ios.jsx',{queued:true}),incoming=load('./IosDetailNavigation.ios.jsx',{queued:true});
 const calls=[],onBack=()=>calls.push('pop current route');
 outgoing.render({enabled:true,onBack});completeBackDrag(outgoing.gestures.at(-1));outgoing.unmount();
 incoming.render({enabled:true,onBack});outgoing.flush();assert.deepEqual(calls,[]);
 completeBackDrag(incoming.gestures.at(-1));incoming.flush();assert.deepEqual(calls,['pop current route']);
});

test('non-iOS fallbacks remain inert and drawer pauses feed exposure without replacing its route',()=>{
 for(const name of ['IosTabBar','IosMenuDrawer'])assert.match(readFileSync(new URL(`./${name}.jsx`,import.meta.url),'utf8'),/return null/);
 assert.match(readFileSync(new URL('./IosDetailNavigation.jsx',import.meta.url),'utf8'),/return children/);
 const app=readFileSync(new URL('../../App.js',import.meta.url),'utf8');
 assert.match(app,/const openMainMenu = \(\) => Platform.OS === "ios" \? setIosMenuOpen\(true\) : go\(\{ menu: true \}\)/);
 assert.match(app,/obscured: iosMenuOpen \|\| nativeAccountLinkActive/);
 assert.match(app,/Platform.OS === "ios" && <IosMenuDrawer/);
 assert.match(app,/enabled=\{Platform.OS === "ios" && iosBackGestureAllowed\(nav\)\}/);
});

test('post action rails match the card surface while preserving campaign colors on every platform',()=>{
 const source=readFileSync(new URL('./TicketStub.jsx',import.meta.url),'utf8');
 const surfaces=[...source.matchAll(/\bsurfaceColor=\{([^}]+)\}/g)].map(match=>match[1]);
 assert.equal(surfaces.length,2,'Both status and review swipe rails retain an explicit surface');
 const colors={bg:'screen-background',surface:'card-surface'};
 const campaignTreatment={contentSurfaceColor:'campaign-surface'};
 for(const expression of surfaces){
  const evaluate=new Function('campaignPresentation','campaignTreatment','colors','Platform',`return (${expression});`);
  for(const OS of ['ios','android','web']){
   assert.equal(evaluate(null,campaignTreatment,colors,{OS}),colors.surface,`${OS} ordinary rail matches the card`);
   assert.equal(evaluate({},campaignTreatment,colors,{OS}),campaignTreatment.contentSurfaceColor,`${OS} campaign keeps its own palette`);
  }
 }
 assert.match(source,/\.\.\.\(Platform\.OS === "ios" \? \{\s*card:\s*\{\s*backgroundColor: colors\.surface,/);
});

test('iOS suggested people retain filtering and actual per-person explanations',()=>{
 const source=readFileSync(new URL('./SuggestedPittersRail.ios.jsx',import.meta.url),'utf8');
 assert.match(source,/visibleSuggestedPitters\(suggestions, \{ isFollowing, isBlocked \}\)/);
 assert.match(source,/!enabled \|\| !accountId/);
 assert.match(source,/suggestion.reason \|\| "A fan to follow"/);
 assert.match(source,/onFollow\?\.\(person.id\)/);
 assert.match(source,/onOpenProfile\?\.\(person.id\)/);
 assert.match(source,/People to know/);
 assert.match(readFileSync(new URL('./SuggestedPittersRail.jsx',import.meta.url),'utf8'),/WHO TO FOLLOW/);
});


test('iOS feed large text wraps filters and widens people cards instead of cutting labels',()=>{
 const feed=readFileSync(new URL('../screens/FeedScreen.jsx',import.meta.url),'utf8');
 assert.match(feed,/Platform\.OS === "ios" && fontScale > 1\.25 && \{ flexWrap: "wrap" \}/);
 assert.match(feed,/Platform\.OS === "ios" && fontScale > 1\.25 && \{ flexBasis: "45%"/);
 const rail=readFileSync(new URL('./SuggestedPittersRail.ios.jsx',import.meta.url),'utf8');
 assert.match(rail,/largeText \? Math\.min\(270, width - 52\)/);
 assert.equal((rail.match(/numberOfLines=\{largeText \? undefined : [12]\}/g)||[]).length,3);
});


test('iOS navigation reflows for accessibility text without shrinking type',()=>{
 const tree=load('./IosTabBar.ios.jsx',{fontScale:2.5}).render({active:'feed',onChange:()=>{}});
 const list=nodes(tree).find(n=>n.props.accessibilityRole==='tablist');
 assert.equal(list.props.style[1].flexWrap,'wrap');
 nodes(tree).filter(n=>n.props.accessibilityRole==='tab').forEach(n=>{const styles=n.props.style({pressed:false});assert.equal(styles[1].flexBasis,'45%');assert.ok(styles[0].minHeight>=44);});
 for(const name of ['IosTabBar.ios.jsx','NativeAppHeader.ios.jsx','IosMenuDrawer.ios.jsx']) {
  const source=readFileSync(new URL(name,import.meta.url),'utf8');
  assert.doesNotMatch(source,/allowFontScaling=\{false\}|maxFontSizeMultiplier|adjustsFontSizeToFit/);
  assert.match(source,/flexShrink: 1/);
 }
});

test('iOS drawer renders requested section order and actionable purpose hints',()=>{
 const calls=[], f=load('./IosMenuDrawer.ios.jsx');
 const tree=f.render({visible:true,onClose:()=>calls.push('close'),session:{id:'admin',role:'admin',name:'Admin',handle:'admin'},actions,onLogout:()=>calls.push('logout')});
 const headers=nodes(tree).filter(n=>n.props.accessibilityRole==='header').map(n=>n.props.children);
 assert.deepEqual(headers,['Community','Explore','Account','Settings']);
 const rows=nodes(tree).filter(n=>n.type==='Pressable' && n.props.accessibilityHint);
 assert.equal(rows.length,18);
 for (const row of rows) assert.ok(row.props.style({pressed:false})[0].minHeight>=44);
 const logout=rows.find(n=>n.props.accessibilityLabel==='Sign out');
 logout.props.onPress(); logout.props.onPress();
 assert.deepEqual(calls,['close','logout']);
});

test('iOS drawer omits unavailable destinations rather than rendering empty sections',()=>{
 const tree=load('./IosMenuDrawer.ios.jsx').render({visible:true,actions:{inbox:()=>{},near:true},session:null});
 assert.deepEqual(nodes(tree).filter(n=>n.props.accessibilityRole==='header').map(n=>n.props.children),['Community']);
 assert.ok(!nodes(tree).some(n=>n.props.accessibilityLabel==='Near you'));
});
