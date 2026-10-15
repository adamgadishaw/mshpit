import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {transformSync} from "@babel/core";
const require=createRequire(import.meta.url);
function component(relative,{fontScale=1,extra=""}={}){
  const dimensions={width:360,fontScale},state=[],linked=[];let cursor=0;
  const jsx=(type,props)=>({type,props}),react={memo:x=>x,useEffect:()=>{},useMemo:f=>f(),useState:initial=>{const i=cursor++;if(!(i in state))state[i]=typeof initial==="function"?initial():initial;return[state[i],next=>{state[i]=typeof next==="function"?next(state[i]):next;}];}};
  const fill={position:"absolute",left:0,right:0,top:0,bottom:0};
  const deps={react,"react/jsx-runtime":{jsx,jsxs:jsx},"react-native":{View:"View",Text:"Text",Pressable:"Pressable",AccessibilityInfo:{announceForAccessibility:()=>{}},AppState:{currentState:"active",addEventListener:()=>({remove(){}})},Linking:{openURL:url=>{linked.push(url);return Promise.resolve();}},StyleSheet:{create:s=>s,absoluteFill:fill,hairlineWidth:1},Platform:{OS:"android",select:v=>v.android??v.default},useWindowDimensions:()=>dimensions},"expo-image":{Image:"Image"}};
  const theme={colors:new Proxy({text:"#1C140C",surface:"#FFFFFF"},{get:(o,k)=>o[k]||"#9C4708"}),radius:{md:12,lg:16,pill:999},shadow:{card:{},control:{}},space:n=>n*4};
  const mocks={"./DiscoverEventCard":"EventCard","../../hooks/useReducedMotion":()=>false,"../../domain/dataPolicy.mjs":{calendarDateKey:()=>20261102},"../../theme":theme,"../theme":theme,"../Icon":"Icon","./Icon":"Icon","../../components/Icon":"Icon","./FestivalBackdrop":"FestivalBackdrop",
    "../../lib/img":{isHttp:x=>/^http/.test(x||""),proxied:x=>x},"../../domain/artistInitials.mjs":{artistInitials:()=>"AL"},"../../domain/discoverView.mjs":{discoverGenreLabel:x=>x},"../../domain/urls.mjs":{artistPath:r=>'/artist/'+r.name},"../PublicWebLinks":{PublicPressableLink:"Link"},"./PublicWebLinks":{PublicTextLink:"Link"},
    "../domain/venueDiscovery.mjs":{eventDateMeta:()=>({month:"Nov",day:"2",timing:"Upcoming"}),optionalDistanceKm:()=>null,splitVenuePlace:p=>({city:p||"Toronto",region:""})},"../domain/liveDiscovery.mjs":{liveEventTitle:e=>e.title||e.artist,liveEventLineupLabel:()=>""},"../domain/eventLifecycle.mjs":{LIVE_EVENT_PHASE:{ACTIVE:"active"},liveEventPhase:()=>"upcoming"},"../domain/urls.mjs":{eventPath:()=>"/event/test"},
    "./festivalFormat.mjs":{festivalAccent:()=>["#111","#333"],festivalCountdown:()=>null,festivalDateRange:()=>"Nov 2–3",festivalLength:()=>"2 days",festivalPlace:e=>e.place||"Toronto",goingLine:()=>null,lineupIsNew:()=>false}};
  const code=transformSync(readFileSync(new URL(relative,import.meta.url),"utf8")+extra,{filename:relative,babelrc:false,configFile:false,plugins:[[require("@babel/plugin-transform-react-jsx"),{runtime:"automatic"}],require("@babel/plugin-transform-modules-commonjs")]}).code;
  const module={exports:{}};new Function("require","module","exports",code)(name=>{if(name in deps)return deps[name];if(name in mocks)return mocks[name];throw Error("Unmocked "+name);},module,module.exports);
  return{exports:module.exports,dimensions,linked,render:(fn,props)=>{cursor=0;return fn(props);}};
}
function nodes(tree){if(!tree)return[];if(Array.isArray(tree))return tree.flatMap(nodes);if(typeof tree!=="object")return[];return[tree,...nodes(tree.props?.children)];}
const text=tree=>nodes(tree).filter(n=>n.type==="Text").map(n=>n.props.children).flat().filter(x=>typeof x==="string").join(" ");
const title="An extraordinarily long concert and artist name that needs room to wrap";
const eventProps={current:{id:"e1",title,venue:"Long venue name",place:"Toronto"},date:"Nov 2, 2026",index:0,count:1};
test("native event title stays in flow, artwork stays16:9 and navigation receives the original event",()=>{
  const c=component("./DiscoverEventCard.jsx"),called=[],props={...eventProps,onOpen:()=>called.push("event")},tree=c.render(c.exports.default,props);
  assert.ok(nodes(tree).some(n=>n.props.style?.aspectRatio===16/9));assert.ok(text(tree).includes(title));nodes(tree).find(n=>n.props.accessibilityLabel?.startsWith("Open ")).props.onPress();assert.deepEqual(called,["event"]);
  c.dimensions.fontScale=1.5;const large=c.render(c.exports.default,props);assert.equal(nodes(large).find(n=>n.type==="Text"&&n.props.children===title).props.numberOfLines,undefined);
});
test("native browsing cards show no source names or per-card credit controls",()=>{
  const c=component("./DiscoverEventCard.jsx"),tree=c.render(c.exports.default,{...eventProps,media:{uri:"file://photo",by:"Photographer"},attribution:{creator:"Photographer",license:"CC BY4.0"}});
  assert.doesNotMatch(text(tree),/Photographer|Source|credits|CC BY/);assert.equal(nodes(tree).some(n=>n.props.accessibilityLabel==="Photo credits"),false);
});
test("actual banner navigation carries selected-photo metadata into event details",()=>{
  const c=component("./DiscoverEventBanner.jsx"),event={id:"event-1",artist:"Artist"},media={uri:"https://example.org/photo.jpg",source:"provider",provider:"ticketmaster",by:"Photographer",sourcePage:"https://example.org/photo"};let selected;
  const tree=c.render(c.exports.default,{slides:[{id:"slide-1",title:"Artist",date:"2026-11-02",event,media}],onOpenEvent:e=>selected=e});assert.equal(tree.type,"EventCard");tree.props.onOpen();assert.equal(selected.id,event.id);assert.deepEqual(selected.discoverPhotoCredit,{creator:"Photographer",sourcePage:media.sourcePage,license:undefined,licenseUrl:undefined});
});
test("details preserve truthful source/license links and never invent a provider license",()=>{
  const c=component("../EventPhotoCredit.jsx"),credit={creator:"Photographer",sourcePage:"https://example.org/photo",license:"CC BY4.0",licenseUrl:"https://example.org/license"};let tree=c.render(c.exports.default,{credit});
  for(const link of nodes(tree).filter(n=>n.props.accessibilityRole==="link"))link.props.onPress();assert.deepEqual(c.linked,[credit.sourcePage,credit.licenseUrl]);
  tree=c.render(c.exports.default,{credit:{creator:"Provider",sourcePage:"https://example.org/photo"}});assert.doesNotMatch(text(tree),/CC BY|license/);assert.equal(nodes(tree).filter(n=>n.props.accessibilityRole==="link").length,1);
  tree=c.render(c.exports.default,{credit:{creator:"X",sourcePage:"javascript:alert(1)",licenseUrl:"http://unsafe.example",license:"Unknown"}});assert.equal(nodes(tree).filter(n=>n.props.accessibilityRole==="link").length,0);
});
test("artist cards wrap native titles and use one column at larger text without changing their destinations",()=>{
  const c=component("./DiscoverArtistCard.jsx"),rows=[{name:title,genre:"Alternative"},{name:"Second artist"}],fn=c.exports.DiscoverArtistGrid;
  const normal=c.render(fn,{rows});const normalWidth=nodes(normal).find(n=>n.props.row)?.props.width;c.dimensions.fontScale=1.5;const large=c.render(fn,{rows});assert.ok(nodes(large).find(n=>n.props.row).props.width>normalWidth);
  let selected;const card=c.render(c.exports.DiscoverArtistCard,{row:rows[0],width:300,onOpen:r=>selected=r});assert.equal(nodes(card).find(n=>n.type==="Text"&&n.props.children===title).props.numberOfLines,undefined);card.props.onNavigate();assert.equal(selected,rows[0]);
});
test("artist image fallback is present while loading and an old image failure does not poison a replacement",()=>{
  const c=component("./DiscoverArtistCard.jsx",{extra:"\nexport { ArtistPhoto };"}),fn=c.exports.ArtistPhoto;let tree=c.render(fn,{row:{name:"A",photo:"file://one"},size:120});assert.match(text(tree),/AL/);const old=nodes(tree).find(n=>n.type==="Image").props.onError;old();tree=c.render(fn,{row:{name:"A",photo:"file://one"},size:120});assert.equal(nodes(tree).some(n=>n.type==="Image"),false);
  tree=c.render(fn,{row:{name:"B",photo:"file://two"},size:120});assert.equal(nodes(tree).find(n=>n.type==="Image").props.source.uri,"file://two");old();tree=c.render(fn,{row:{name:"B",photo:"file://two"},size:120});assert.equal(nodes(tree).find(n=>n.type==="Image").props.source.uri,"file://two");
});
test("festival artwork failure preserves backdrop, long title and the original edition destination",()=>{
  const c=component("../../features/festivals/FestivalCard.jsx",{fontScale:1.5}),edition={id:"f1",name:title,startDate:"2026-11-02",endDate:"2026-11-03",imageUrl:"file://one",headliners:["One","Two"]};let selected;const props={edition,onOpen:e=>selected=e};let tree=c.render(c.exports.default,props);assert.ok(nodes(tree).some(n=>n.type==="FestivalBackdrop"));assert.equal(nodes(tree).find(n=>n.type==="Text"&&n.props.children===title).props.numberOfLines,undefined);tree.props.onPress();assert.equal(selected,edition);nodes(tree).find(n=>n.type==="Image").props.onError();tree=c.render(c.exports.default,props);assert.equal(nodes(tree).some(n=>n.type==="Image"),false);assert.ok(nodes(tree).some(n=>n.type==="FestivalBackdrop"));
});
test("venue/event cards keep full accessible destinations and ticket callbacks while allowing wrapping",()=>{
  const c=component("../VenueDiscoveryCards.jsx"),venue={name:title,place:"Toronto",upcoming:3};let calls=0;const tree=c.render(c.exports.VenueDiscoveryCard,{venue,onPress:()=>calls++});assert.ok(tree.props.accessibilityLabel.includes(title));tree.props.onPress();assert.equal(calls,1);assert.equal(nodes(tree).find(n=>n.type==="Text"&&n.props.children===title).props.numberOfLines,undefined);
  const event={title,artist:"Artist",venue:"Venue",ticketUrl:"https://tickets.example"};const show=c.render(c.exports.UpcomingEventCard,{event,onTickets:()=>calls++});nodes(show).find(n=>n.props.accessibilityLabel===`Tickets for ${title}`).props.onPress();assert.equal(calls,2);
});
