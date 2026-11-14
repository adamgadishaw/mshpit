#!/usr/bin/env node
// Render production React screen components with synthetic data through RN Web.
// iOS branches/styles and simulated text scaling are exercised, not UIKit,
// native font metrics, VoiceOver or keyboard animation. No API/session access.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const React = require("react"), RN = require("react-native-web"), { renderToStaticMarkup } = require("react-dom/server");
const { transformSync } = require("@babel/core");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(process.env.PIT_MESSAGING_EVIDENCE || "/tmp/mshpit-messaging-presentation-evidence");
mkdirSync(output, { recursive: true });
const noop = () => {}, ok = async () => ({ ok: true });
const avatar = (bg, shirt) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="104" height="104" viewBox="0 0 104 104"><rect width="104" height="104" fill="${bg}"/><circle cx="52" cy="108" r="43" fill="${shirt}"/><ellipse cx="52" cy="44" rx="23" ry="27" fill="#E3AB84"/><path d="M28 44V32c0-28 51-28 49 4l-5 8-5-20-24 8-9 15Z" fill="#292128"/><circle cx="44" cy="44" r="2" fill="#292128"/><circle cx="60" cy="44" r="2" fill="#292128"/><path d="M45 57q7 6 14 0" fill="none" stroke="#864E47" stroke-width="2"/></svg>`).toString("base64")}`;
const me = { id: "demo-self", name: "Demo member", handle: "demo" };
const people = [
  { id: "demo-maya", name: "Maya Chen", handle: "mayac", initials: "MC", avatarUri: avatar("#565A79", "#D6A579") },
  { id: "demo-leonor", name: "Leonor de los Santos Rivera", handle: "leonorsantos", initials: "LR", avatarUri: avatar("#5C4C4D", "#78969B") },
  { id: "demo-jay", name: "Jay", handle: "jaybeats", initials: "J", avatarColor: "#ED5B8D" },
  { id: "demo-nora", name: "Nóra Álvarez", handle: "nora", initials: "NA", avatarUri: avatar("#676B50", "#ABA4D1") },
  { id: "demo-eli", name: "Eli", handle: "eli", initials: "E", avatarColor: "#5B8DEF" },
];
const previews = ["Meet by the doors at 7?", "I've got the tickets! Let's meet near the entrance before the support act starts.", "That encore was unreal 🔥", "Sending you the setlist after work.", "See you at the next one!"];
const threads = people.map((person, i) => ({ otherId: person.id, otherUser: person, unread: i === 0 ? 3 : i === 1 ? 128 : 0,
  relationshipContext: { friend: true, following: true, followsYou: true },
  last: { id: `preview-${i}`, from: i === 3 ? me.id : person.id, text: previews[i], ts: ["2m", "18m", "Yesterday", "Tue", "Nov 4"][i] } }));
const requests = [{ ...threads[2], unread: 1, relationshipContext: {} }];
const cases = [
  { name: "before-inbox-sparse", before: true, sparse: true },
  { name: "after-inbox-sparse", sparse: true },
  { name: "after-inbox", width: 390 },
  { name: "after-inbox-large-text", width: 320, scale: 2 },
  { name: "after-requests", tab: "requests" },
  { name: "after-search", query: "tickets", filtered: [threads[1]] },
  { name: "after-search-empty", query: "guitar", filtered: [] },
  { name: "after-empty", empty: true },
  { name: "after-compose", composing: true, query: "leo", people: [people[1]] },
  { name: "before-conversation", before: true, thread: true },
  { name: "after-conversation", thread: true },
  { name: "after-conversation-large-text", thread: true, scale: 2, width: 320 },
];

function renderCase(scenario) {
  console.log(`Rendering ${scenario.name}`);
  const scale = scenario.scale || 1, width = scenario.width || 390, cache = new Map();
  const native = { ...RN, TextInput: props => React.createElement(RN.TextInput, { rows: 1, ...props }), Platform: { OS: "ios", select: choices => choices.ios ?? choices.native ?? choices.default },
    useWindowDimensions: () => ({ width, height: 844, fontScale: scale, scale: 2 }),
    StyleSheet: { ...RN.StyleSheet, create: values => RN.StyleSheet.create(Object.fromEntries(Object.entries(values).map(([key, style]) => [key,
      { ...style, ...(style.fontSize ? { fontSize: style.fontSize * scale } : {}), ...(style.lineHeight ? { lineHeight: style.lineHeight * scale } : {}) }]))) },
  };
  const rows = scenario.sparse ? threads.slice(0, 2).map(t => ({ ...t, unread: 0 })) : scenario.empty ? [] : threads;
  const messages = [
    { id: "demo-msg-1", from: people[1].id, text: "Hey! Are you going to the show on Friday?", ts: "6:42 PM", at: 1, server: true },
    { id: "demo-msg-2", from: me.id, text: "Absolutely 🙌", ts: "6:43 PM", at: 2, server: true },
    { id: "demo-msg-3", from: people[1].id, text: "Nice. Doors are at seven. I can save you a spot near the back if you're running late.", ts: "6:43 PM", at: 3, server: true },
    { id: "demo-msg-4", from: me.id, text: "Perfect, see you there!", ts: "6:44 PM", at: 4, server: true },
  ];
  const store = { session: me, chatAuthEpoch: 1, mainThreads: () => rows, requestThreads: () => requests,
    searchPeople: async () => people, loadInboxThreads: async () => [], userById: id => people.find(p => p.id === id),
    threadMessages: () => messages, sendDM: ok, retryChatMessage: ok, cancelChatMessage: noop, loadThread: async () => ({}),
    markThreadRead: noop, loadUser: noop, getDMRequestState: () => "accepted", acceptDMRequest: ok,
    isBlocked: () => false, isMuted: () => false, isBlockMutationPending: () => false,
    blockUser: ok, unblockUser: ok, muteUser: ok, unmuteUser: ok };
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const relative = file.slice(root.length + 1);
    const source = scenario.before && ["src/screens/InboxScreen.jsx", "src/screens/ThreadScreen.jsx"].includes(relative)
      ? execFileSync("git", ["show", `85fbc1daeccd2913ae3d36af44115915131801f4:${relative}`], { cwd: root, encoding: "utf8" }) : readFileSync(file, "utf8");
    const code = transformSync(source, { filename: file, babelrc: false, configFile: false,
      plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")] }).code;
    function dependency(name) {
      if (name === "react-native") return native;
      if (name === "react" || name.startsWith("react/")) return require(name);
      if (name === "react-native-svg") return { __esModule: true, default: props => React.createElement("svg", props),
        ...Object.fromEntries(["Path", "Circle", "Line", "Polyline", "Polygon", "Rect"].map(tag => [tag, props => React.createElement(tag.toLowerCase(), props)])) };
      if (name === "expo-image") return { Image: ({ source, style }) => React.createElement(RN.Image, { source, style, resizeMode: "cover" }) };
      if (name.endsWith("/store")) return { useStore: () => store };
      if (name.endsWith("/themeRuntime")) return { nativeThemeRuntime: true, readThemeSelection: () => ({ theme: "stage" }), persistThemeSelection: noop, clearThemeSelection: noop, reloadTheme: noop };
      if (name.endsWith("/img")) return { displaySrc: value => value, previewSrc: value => value };
      if (name.endsWith("/useImageAttempt")) return (_scope, sources) => ({ uri: sources[0], index: 0, onError: noop, onDisplay: noop });
      if (name.endsWith("/feedImageRetry")) return { useFeedImageRetryPulse: () => 0 };
      if (name.endsWith("/VinylRefreshBoundary") || name.endsWith("/IOSPostKeyboardView")) return ({ children, style, testID }) => React.createElement(RN.View, { style: [{ flex: 1, minHeight: 0 }, style], testID }, children);
      if (name.endsWith("/useLiveChat")) return noop;
      if (name.endsWith("/useScopedRefresh")) return () => ({ refresh: noop, refreshing: false });
      if (name.endsWith("/useChatScroll")) return () => ({ scrollRef: { current: null }, onScroll: noop, onContentSizeChange: noop, onLayout: noop, onScrollBeginDrag: noop });
      if (name.endsWith("/useIOSThreadControls")) return () => () => true;
      if (name.endsWith("/useIOSThreadRefreshAnnouncement")) return () => ({ begin: noop, finish: noop });
      if (!name.startsWith(".")) return require(name);
      const target = resolve(dirname(file), name);
      const resolved = [target, `${target}.ios.jsx`, `${target}.ios.js`, `${target}.jsx`, `${target}.js`, `${target}.mjs`].find(existsSync);
      assert.ok(resolved, `Cannot resolve ${name}`); return load(resolved);
    }
    new Function("require", "module", "exports", code)(dependency, module, module.exports);
    return module.exports;
  }
  let element;
  if (scenario.thread) {
    const Thread = load(join(root, "src/screens/ThreadScreen.jsx")).default;
    element = React.createElement(Thread, { otherId: people[1].id, onClose: noop, onOpenProfile: noop, onReport: noop });
  } else if (scenario.before) {
    const Inbox = load(join(root, "src/screens/InboxScreen.jsx")).default;
    element = React.createElement(Inbox, { onClose: noop, onOpenThread: noop });
  } else {
    const Inbox = load(join(root, "src/components/InboxPresentation.jsx")).default;
    element = React.createElement(Inbox, { session: me, composing: !!scenario.composing, query: scenario.query || "", setQuery: noop,
      inboxQuery: scenario.query || "", setInboxQuery: noop, peopleSearch: { status: "ready", rows: scenario.people || [] }, people: scenario.people || [], retryPeople: noop,
      tab: scenario.tab || "main", setTab: noop, requests, threads: scenario.filtered || (scenario.tab === "requests" ? requests : rows),
      inboxStatus: "ready", inboxRefreshing: false, refreshInbox: noop, onClose: noop, onCompose: noop, closeComposer: noop, onOpenThread: noop, openPerson: noop });
  }
  RN.AppRegistry.registerComponent(scenario.name, () => () => element);
  const app = RN.AppRegistry.getApplication(scenario.name);
  const markup = renderToStaticMarkup(app.element), css = renderToStaticMarkup(app.getStyleElement());
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}<style>html,body{margin:0;background:#09090B}#root{height:844px;box-sizing:border-box;padding-top:54px;padding-bottom:34px;display:flex;flex-direction:column}#root>div{flex:1;min-height:0}</style></head><body><div id="root">${markup}</div><script>requestAnimationFrame(()=>{document.body.dataset.layout=JSON.stringify({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,rows:[...document.querySelectorAll('[data-testid="conversation-row"]')].map(e=>({top:e.getBoundingClientRect().top,height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right})),heading:[...document.querySelectorAll('[role="heading"]')].map(e=>({text:e.textContent,height:e.getBoundingClientRect().height,lineHeight:getComputedStyle(e).lineHeight,fontSize:getComputedStyle(e).fontSize})),buttons:[...document.querySelectorAll('[role="button"],[role="tab"]')].map(e=>({label:e.getAttribute('aria-label'),height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}))})})</script></body></html>`;
  writeFileSync(join(output, `${scenario.name}.html`), html);
  return { ...scenario, width, scale };
}
const manifest = cases.map(renderCase);
writeFileSync(join(output, "manifest.json"), JSON.stringify({ renderer: "Production React source → React Native Web server rendering; iOS branches, synthetic text scale and safe areas; no native/device verification", scenarios: manifest }, null, 2));
console.log(`Rendered ${manifest.length} messaging scenarios to ${output}`);
