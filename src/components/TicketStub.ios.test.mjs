import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import test from "node:test";
import { transformSync } from "@babel/core";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("./TicketStub.jsx", import.meta.url), "utf8");
const domains = Object.fromEntries([
  "dates", "postMediaDisplay", "feedExperience", "artistCampaignPost", "postFriendTags", "urls", "showNavigation",
  "attendanceTicket", "calendarShows", "concertPostContext", "postAuthor", "onlineReview", "socialShareCard", "reviewRatingSummary",
].map((name) => [`../domain/${name}.mjs`, require(`../domain/${name}.mjs`)]));
const colors = new Proxy({}, { get: (_, key) => `color:${String(key)}` });
const jsx = (type, props, key) => ({ type, props, key });
export function fixture({ platform = "ios", own = false, loggedIn = true, inputSource = source, preview = false, reduceMotion = false } = {}) {
  const calls = [], state = [], sheets = [];
  let cursor = 0;
  const store = {
    userById: () => null, userBadges: () => [], commentsFor: () => [],
    likeInfo: () => ({ count: 3, liked: false }),
    session: loggedIn ? { id: own ? "author" : "viewer" } : null,
    toggleLike: (...args) => calls.push(["like", ...args]),
    setPostRepost: (...args) => calls.push(["repost", ...args]),
    deleteOwnPost: (...args) => calls.push(["deleteFallback", ...args]), refreshFeed: () => calls.push(["refresh"]),
  };
  const modules = { ...domains,
    "./showIOSPostActions": (options, choose) => sheets.push({ options, choose }),
    react: { useRef: (initial) => { const i = cursor++; return state[i] ||= { current: initial }; },
      useLayoutEffect: (effect) => { const i = cursor++; state[i] ||= { setup: effect, cleanup: effect() }; }, useContext: (value) => value, useMemo: (fn) => fn(), useState: (initial) => {
      const i = cursor++; if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial;
      return [state[i], (next) => { state[i] = typeof next === "function" ? next(state[i]) : next; }];
    } },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { View: "View", Text: "Text", Pressable: "Pressable", Platform: { OS: platform },
      StyleSheet: { create: (value) => value, hairlineWidth: 0.5, absoluteFill: {}, absoluteFillObject: {} },
      Alert: { alert: (...args) => calls.push(["alert", ...args]) }, Linking: { openURL: async (url) => { calls.push(["external", url]); } } },
    "expo-image": { Image: "ExpoImage" },
    "../theme": { colors, displayFont: "display", font: "font", mono: "mono", glow: {}, radius: { md: 12, lg: 18, sm: 8, pill: 999 }, shadow: { card: {} }, roleColor: () => null, space: (value) => value * 4 },
    "../store": { useStore: () => store }, "../config/runtime.mjs": { ENABLE_MUSIC_PLAYER: false },
    "../hooks/useReducedMotion": () => reduceMotion,
    "../hooks/useNativeTabPreview": platform === "ios" ? () => preview : require("../hooks/useNativeTabPreview.js"),
    "./PublicWebLinks": { PublicPressableLink: "PublicPressableLink", PublicTextLink: "PublicTextLink" },
    "./SocialReactionButtons": { RepostButton: "RepostButton", RepostAttribution: "RepostAttribution" },
    "./Badge": { BadgeRow: "BadgeRow" }, "./SocialShareStudio": { SocialShareButton: "SocialShareButton" },
    "../cityIdentity.js": { cityIdentityForLocation: () => null },
    "./cities/CityNavigationContext": { CityNavigationContext: null },
    "../domain/contentPreview.mjs": require("../domain/contentPreview.mjs"),
  };
  for (const name of ["SupportingActsLine", "Stars", "Icon", "Avatar", "RatingBars", "SpinStar", "AfterpartyPreview", "ExpandableText", "PostMediaGrid", "ConvertingClipNotice", "SongAttachment", "PostSwipeActions", "ConcertTicketCard"]) modules[`./${name}`] = name;
  const hookSource = readFileSync(new URL(`../hooks/useTicketPresentation${platform === "ios" ? ".ios" : ""}.js`, import.meta.url), "utf8");
  const hookCode = transformSync(hookSource, { babelrc: false, configFile: false, plugins: [require("@babel/plugin-transform-modules-commonjs")] }).code;
  const hookModule = { exports: {} };
  new Function("require", "module", "exports", hookCode)(name => name === "react" ? modules.react : modules["./showIOSPostActions"], hookModule, hookModule.exports);
  modules["../hooks/useTicketPresentation"] = hookModule.exports;
  const code = transformSync(inputSource, { babelrc: false, configFile: false,
    plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
  }).code;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => { assert.ok(name in modules, name); return modules[name]; }, module, module.exports);
  const actions = Object.fromEntries(["onOpen", "onOpenShow", "onOpenPost", "onNotInterested", "onComment", "onRequireAuth", "onOpenProfile", "onOpenArtist", "onOpenArtistArchive", "onOpenVenue", "onReport", "onEdit", "onDelete", "onOpenPhotos", "onRemoveMyPostTag"].map((name) => [name, (...args) => calls.push([name, ...args])]));
  return { calls, actions, store, sheets, reconnect: () => state.forEach(value => { if (value?.setup) { value.cleanup?.(); value.cleanup = value.setup(); } }), unmount: () => state.forEach(value => value?.cleanup?.()), render: (overrides = {}) => { cursor = 0; return module.exports.default({ log: review, compactContent: true, swipeActions: true, ...actions, ...overrides }); } };
}
export const review = { id: "p_review", userId: "author", user: { name: "Reviewer", handle: "reviewer" }, timeAgo: "2h", kind: "review",
  artist: "Main artist", artistPublicSlug: "main-artist", venue: "The venue", city: "Toronto", date: "2026-11-01", review: "The actual review", overall: 4.5,
  band: 4, room: 5, views: 9, viewCount: 9, photos: ["https://example.com/photo.jpg"],
  lineup: [{ name: "Opener", rating: 4, reviewPostId: "p_opener" }], setlist: ["First song", "Last song"], inTourWindow: true,
};
function nodes(tree, expand = true) {
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, expand));
  if (!tree || typeof tree !== "object") return [];
  const rendered = expand && typeof tree.type === "function" ? tree.type(tree.props) : null;
  return [tree, ...nodes(rendered || tree.props?.children, expand)];
}
const style = (value) => Object.assign({}, ...[typeof value === "function" ? value({ pressed: false }) : value].flat(Infinity).filter(Boolean));
const label = (tree, value) => nodes(tree).find((node) => node.props?.accessibilityLabel === value);
const type = (tree, value) => nodes(tree).find((node) => node.type === value);
function strings(tree) {
  if (Array.isArray(tree)) return tree.flatMap(strings);
  if (typeof tree === "string") return [tree];
  if (!tree || typeof tree !== "object") return [];
  if (typeof tree.type === "function") return strings(tree.type(tree.props));
  return strings(tree.props.children);
}

test("iOS cards have distinct surfaces and one venue/date while review and media precede secondary routes", () => {
  const f = fixture(); label(f.render(), "Show details").props.onPress();
  const tree = f.render(), all = nodes(tree);
  const card = style(tree.props.style);
  assert.equal(card.backgroundColor, "color:surface"); assert.equal(card.borderColor, "color:line");
  assert.equal(card.borderWidth, 1); assert.equal(card.borderRadius, 18); assert.equal(card.padding, 14); assert.equal(card.marginBottom, 16);
  assert.equal(strings(tree).filter((value) => value === review.venue).length, 1);
  assert.equal(strings(tree).filter((value) => value.includes("2026") && value.includes("11")).length, 1);
  assert.ok(all.findIndex((node) => node.type === "ExpandableText") < all.findIndex((node) => node.props.accessibilityLabel === "View Main artist show"));
  assert.ok(all.indexOf(type(tree, "PostMediaGrid")) < all.indexOf(type(tree, "SupportingActsLine")));
  assert.equal(type(tree, "SupportingActsLine").props.compact, false);
  assert.equal(type(f.render({ compactContent: false }), "SupportingActsLine").props.compact, false);
  assert.equal(type(tree, "PostSwipeActions").props.surfaceColor, card.backgroundColor);
  assert.ok(label(tree, "9 member views"));
});

test("iOS score disclosure retains honest factors and original rating inputs", () => {
  const f = fixture(); let tree = f.render();
  assert.equal(type(tree, "RatingBars"), undefined);
  label(tree, "Overall 4.5 out of 5. Show the rating breakdown.").props.onPress(); tree = f.render();
  assert.ok(label(tree, "Overall 4.5 out of 5. Hide the rating breakdown."));
  assert.ok(strings(tree).includes("Band 4.0 · Room 5.0"));
  assert.equal(type(tree, "RatingBars").props.band, 4); assert.equal(type(tree, "RatingBars").props.room, 5);
  const sparse = fixture();
  const input = { log: { ...review, band: null, room: null, overall: 5 } };
  label(sparse.render(input), "Overall 5.0 out of 5. Show the rating breakdown.").props.onPress();
  assert.equal(type(sparse.render(input), "RatingBars").props.band, null);
});

test("iOS routes, moderation, social actions and media opener ownership remain intact", () => {
  const f = fixture(), opener = { focus() {} };
  label(f.render(), "Show details").props.onPress();
  label(f.render(), "More post actions").props.onPress();
  const tree = f.render();
  label(tree, "View Main artist show").props.onNavigate();
  label(tree, "Compare scores across Main artist concerts").props.onNavigate();
  label(tree, "Comments, 0").props.onNavigate(); label(tree, "Report post").props.onPress();
  label(tree, "Like, 3 likes").props.onPress();
  label(tree, "Not for me. Hide this recommendation.").props.onPress();
  type(tree, "PostMediaGrid").props.onOpen(0, opener);
  assert.deepEqual(f.calls.slice(0, 6).map((call) => call[0]), ["onOpenShow", "onOpenArtistArchive", "onComment", "onReport", "like", "onNotInterested"]);
  assert.equal(f.calls[0][1], review); assert.equal(f.calls[3][1], review);
  assert.equal(f.calls[6][0], "onOpenPhotos"); assert.equal(f.calls[6][3], review.id); assert.equal(f.calls[6][4], opener);
  assert.equal(f.calls[6][1][0].uri, review.photos[0]);
  const swipe = type(tree, "PostSwipeActions").props;
  assert.equal(swipe.accountId, "viewer"); assert.equal(swipe.enabled, true); assert.equal(swipe.post, review);
  assert.equal(swipe.setPostRepost, f.store.setPostRepost); assert.equal(swipe.toggleLike, f.store.toggleLike);
  assert.equal(type(tree, "RepostButton").props.onRepost, f.store.setPostRepost);
  assert.equal(type(tree, "RepostAttribution").props.onOpenProfile, f.actions.onOpenProfile);
  assert.equal(type(tree, "AfterpartyPreview").props.log, review);
  const guest = fixture({ loggedIn: false }); label(guest.render(), "Like, 3 likes").props.onPress();
  assert.deepEqual(guest.calls, [["onRequireAuth"]]);
});

test("owner edit/delete remains behind the same confirmation and no ownership bypass", () => {
  const f = fixture({ own: true });
  label(f.render(), "More post actions").props.onPress();
  const tree = f.render();
  label(tree, "Edit post").props.onPress(); label(tree, "Delete post").props.onPress();
  assert.equal(f.calls[0][0], "onEdit"); assert.equal(f.calls[1][0], "alert");
  assert.equal(f.calls.some((call) => call[0] === "onDelete"), false);
  f.calls[1][3].find((button) => button.style === "destructive").onPress();
  assert.deepEqual(f.calls.at(-1), ["onDelete", review.id]);
  assert.equal(label(fixture().render(), "Delete post"), undefined);
});

test("status, artist campaign and online review retain their distinct surfaces and controls", () => {
  const f = fixture();
  const status = f.render({ log: { ...review, kind: "status" } });
  assert.equal(type(status, "SupportingActsLine"), undefined); assert.equal(type(status, "Stars"), undefined);
  const campaign = f.render({ log: { ...review, kind: "status", campaign: { version: 1, treatment: "after-dark" } } });
  assert.equal(style(campaign.props.style).backgroundColor, "#120D26");
  assert.equal(type(campaign, "PostSwipeActions").props.surfaceColor, "#0C0A1A");
  assert.ok(label(campaign, "More post actions")); assert.ok(type(campaign, "SocialShareButton"));
  const online = f.render({ log: { ...review, experienceType: "online", youtubeUrl: "https://www.youtube.com/watch?v=abcdefghijk" } });
  assert.equal(type(online, "SupportingActsLine"), undefined);
  assert.ok(label(online, "Watch this online concert on YouTube"));
  assert.equal(label(online, "View Main artist show"), undefined);
});

test("iOS text and secondary controls can grow at maximum Dynamic Type without losing controls", () => {
  const f = fixture();
  label(f.render(), "Show details").props.onPress();
  label(f.render(), "More post actions").props.onPress();
  const tree = f.render();
  for (const name of ["View Main artist show", "Compare scores across Main artist concerts", "Reveal setlist spoilers. 2 songs", "Report post", "Like, 3 likes", "Comments, 0"]) {
    const control = label(tree, name); assert.ok(control, name);
    assert.ok(style(control.props.style).minHeight >= 44, name);
    assert.equal(style(control.props.style).height, undefined, name);
  }
  const title = nodes(tree).find((node) => node.type === "Text" && node.props.children?.type === "PublicTextLink");
  assert.ok(title); assert.equal(title.props.numberOfLines, undefined);
  for (const route of ["View Main artist show", "Compare scores across Main artist concerts"]) {
    for (const node of nodes(label(tree, route)).filter((item) => item.type === "Text")) assert.equal(node.props.numberOfLines, undefined);
  }
  const setlist = label(tree, "Reveal setlist spoilers. 2 songs"); setlist.props.onPress();
  assert.ok(strings(f.render()).includes("First song  ·  Last song"));
  const recommended = { log: { ...review, recommendation: { personalized: true } } };
  const why = label(f.render(recommended), "Suggested post. Show more information.");
  assert.ok(style(why.props.style).minHeight >= 44); why.props.onPress();
  assert.equal(label(f.render(recommended), "Suggested post. Hide more information.").props.accessibilityState.expanded, true);
});

// Full normalized host trees recorded from b00f507, including evaluated styles,
// all local child components, callbacks' presence and exact non-iOS copy.
export function treeHash(tree) {
  const clean = (value) => {
    if (value == null || value === false) return undefined;
    if (Array.isArray(value)) return value.flatMap((item) => { const next = clean(item); return next === undefined ? [] : [next]; });
    if (typeof value === "function") return "callback";
    if (typeof value !== "object") return value;
    if (typeof value.type === "function") return clean(value.type(value.props));
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "key").map(([key, val]) => [key, key === "style" ? clean(style(val)) : clean(val)]).filter(([, val]) => val !== undefined));
  };
  return createHash("sha256").update(JSON.stringify(clean(tree))).digest("hex");
}
test("Android and web retain their exact original card, action and copy trees", () => {
  const expected = { android: "d872da43b6278e1354d8f4ac673397639f37ca9a2e8d11f93b4e691f226d6f40", web: "a15a5cd6874e6d7f7881048096704fdf980799539a16fb2f33be23cd3e8640ae" };
  for (const platform of ["android", "web"]) assert.equal(treeHash(fixture({ platform }).render()), expected[platform]);
});

test("Android and web status, campaign and online cards also match their original host trees", () => {
  const expected = {
    android: { status: "2e7e27ad545e3587964b80b3c9c3e405f13dd09ec26d13f27342c78a90d4b39b", campaign: "4d68abf44aab566a795acc92171c63ca07cfd7f8d56b0176bd2c949527ba5e72", online: "601b55146439307eda4ede925806cdadbbe05147e138f94d4f0c7379047fe062" },
    web: { status: "954a49e101012ae496cdcffd52fe1445241bf3b76ad3590b5520a20080ad0f36", campaign: "6d16883e45961d749a1b44a1704e93d6a3fd6fc692b1ddf124ac3158566f9296", online: "5bf3d3c6dce2fffc148ca3c83286388bbee1044864f57ffbe5beb92c7df57b38" },
  };
  for (const platform of ["android", "web"]) {
    const f = fixture({ platform });
    for (const [kind, log] of Object.entries({ status: { ...review, kind: "status" },
      campaign: { ...review, kind: "status", campaign: { version: 1, treatment: "after-dark" } },
      online: { ...review, experienceType: "online", youtubeUrl: "https://www.youtube.com/watch?v=abcdefghijk" },
    })) assert.equal(treeHash(f.render({ log })), expected[platform][kind]);
  }
});


test("one collapsed show disclosure retains address, attendance, lineup, comparison and spoiler protection", () => {
  const f = fixture(), input = { log: { ...review, eventAddress: "508 Queen St W", seen: 3 } };
  let tree = f.render(input);
  assert.equal(label(tree, "Show details").props.accessibilityState.expanded, false);
  assert.equal(label(tree, "View Main artist show"), undefined);
  assert.equal(type(tree, "SupportingActsLine"), undefined);
  assert.equal(strings(tree).some(text => text.includes("508 Queen")), false);
  assert.equal(strings(tree).some(text => text.includes("3rd time")), false);
  assert.ok(type(tree, "PostMediaGrid"));
  label(tree, "Show details").props.onPress(); tree = f.render(input);
  assert.deepEqual(f.calls, [], "expansion performs no request, navigation or mutation");
  assert.equal(label(tree, "Hide show details").props.accessibilityState.expanded, true);
  assert.ok(strings(tree).includes("508 Queen St W"));
  assert.ok(strings(tree).join("").includes("3rd time in the pit"));
  assert.equal(type(tree, "SupportingActsLine").props.compact, false, "no nested lineup disclosure");
  assert.ok(label(tree, "Compare scores across Main artist concerts"));
  assert.equal(strings(tree).includes("First song  ·  Last song"), false);
  label(tree, "Reveal setlist spoilers. 2 songs").props.onPress(); tree = f.render(input);
  assert.ok(strings(tree).includes("First song  ·  Last song"));
  label(tree, "Hide show details").props.onPress(); tree = f.render(input);
  assert.equal(type(tree, "SupportingActsLine"), undefined);
  label(tree, "Show details").props.onPress(); tree = f.render(input);
  assert.ok(strings(tree).includes("First song  ·  Last song"));
  tree = f.render({ log: { ...input.log, id: "p_second" } });
  assert.equal(label(tree, "Show details").props.accessibilityState.expanded, false);
  label(tree, "Show details").props.onPress(); tree = f.render({ log: { ...input.log, id: "p_second" } });
  assert.ok(label(tree, "Reveal setlist spoilers. 2 songs"), "spoiler choice does not leak to another post");
});

test("overflow opens and cancels without publishing; selections close and preserve guards across accounts", () => {
  const f = fixture(); let tree = f.render();
  for (const hidden of ["Report post", "Not for me. Hide this recommendation.", "Edit post", "Delete post"])
    assert.equal(label(tree, hidden), undefined);
  for (const visible of ["Like, 3 likes", "Comments, 0", "More post actions"]) assert.ok(label(tree, visible));
  assert.ok(type(tree, "RepostButton")); assert.ok(type(tree, "SocialShareButton"));
  label(tree, "More post actions").props.onPress(); tree = f.render();
  assert.equal(label(tree, "More post actions").props.accessibilityState.expanded, true);
  assert.deepEqual(f.calls, []);
  assert.equal(label(tree, "Delete post"), undefined);
  label(tree, "Close post actions").props.onPress(); tree = f.render();
  assert.equal(label(tree, "Report post"), undefined); assert.deepEqual(f.calls, []);
  label(tree, "More post actions").props.onPress(); tree = f.render();
  label(tree, "Report post").props.onPress(); tree = f.render();
  assert.deepEqual(f.calls, [["onReport", review]]);
  assert.equal(label(tree, "Report post"), undefined);
  label(tree, "More post actions").props.onPress(); f.store.session = { id: "author" }; tree = f.render();
  assert.equal(label(tree, "More post actions").props.accessibilityState.expanded, false);
  f.store.session = { id: "viewer" }; tree = f.render();
  assert.equal(label(tree, "More post actions").props.accessibilityState.expanded, false);
  label(tree, "More post actions").props.onPress(); tree = f.render({ log: { ...review, id: "other" } });
  assert.equal(label(tree, "Report post"), undefined);
  tree = f.render(); assert.equal(label(tree, "Report post"), undefined);
});

test("guest and unavailable actions remain honest, owner attendance cannot be edited, delete still requires confirmation", () => {
  const guest = fixture({ loggedIn: false });
  label(guest.render(), "More post actions").props.onPress(); let tree = guest.render();
  assert.ok(label(tree, "Report post")); assert.equal(label(tree, "Edit post"), undefined);
  assert.equal(label(tree, "Delete post"), undefined);
  label(tree, "Like, 3 likes").props.onPress(); assert.deepEqual(guest.calls, [["onRequireAuth"]]);
  assert.equal(type(tree, "RepostButton").props.accountId, undefined);
  const noActions = fixture();
  tree = noActions.render({ onReport: undefined, onNotInterested: undefined, onOpenArtistArchive: undefined });
  assert.equal(label(tree, "More post actions"), undefined);
  label(tree, "Show details").props.onPress();
  tree = noActions.render({ onReport: undefined, onNotInterested: undefined, onOpenArtistArchive: undefined });
  assert.equal(label(tree, "Compare scores across Main artist concerts"), undefined);
  const owner = fixture({ own: true }), input = { log: { ...review, attendanceTicket: {} } };
  label(owner.render(input), "More post actions").props.onPress(); tree = owner.render(input);
  assert.equal(label(tree, "Edit post"), undefined); assert.equal(label(tree, "Report post"), undefined);
  label(tree, "Delete post").props.onPress();
  assert.equal(owner.calls[0][0], "alert"); assert.equal(owner.calls.length, 1);
  assert.equal(label(owner.render(input), "Delete post"), undefined);
  assert.ok(owner.calls[0][3].find(item => item.style === "cancel"));
});

test("suggestion explanation defaults to quiet collapsed text; views and compact score are not buttons", () => {
  const f = fixture(), input = { log: { ...review, recommendation: { personalized: true } } };
  let tree = f.render(input);
  assert.ok(strings(tree).join("").includes("Suggested · Why?"));
  const why = label(tree, "Suggested post. Show more information.");
  assert.equal(why.props.accessibilityState.expanded, false);
  why.props.onPress(); tree = f.render(input);
  assert.ok(strings(tree).join("").includes("Suggested · Hide"));
  assert.ok(nodes(tree).some(node => node.props.accessibilityLiveRegion === "polite"));
  assert.equal(label(tree, "9 member views").props.accessibilityRole, "text");
  const score = label(tree, "Overall 4.5 out of 5. Show the rating breakdown.");
  assert.ok(style(score.props.style).minHeight >= 44);
  assert.equal(style(score.props.style).borderWidth, undefined);
  assert.equal(type(tree, "Stars"), undefined);
});


test("details can close and reopen on full posts, while non-tour setlists need no extra disclosure", () => {
  const f = fixture(), input = { compactContent: false, log: { ...review, inTourWindow: false } };
  let tree = f.render(input);
  assert.ok(label(tree, "Hide show details"));
  assert.ok(strings(tree).includes("First song  ·  Last song"));
  assert.equal(label(tree, "Reveal setlist spoilers. 2 songs"), undefined);
  label(tree, "Hide show details").props.onPress(); tree = f.render(input);
  assert.equal(type(tree, "SupportingActsLine"), undefined);
  label(tree, "Show details").props.onPress(); tree = f.render(input);
  assert.ok(type(tree, "SupportingActsLine")); assert.deepEqual(f.calls, []);
});

test("iOS hold opens a visible native sheet without mutation and keeps tap/accessibility alternatives", () => {
  for (const log of [review, { ...review, kind: "status" }, { ...review, kind: "status", campaign: { version: 1, treatment: "after-dark" } }, { ...review, experienceType: "online" }]) {
    const f = fixture(); const tree = f.render({ log });
    assert.equal(tree.type, "Pressable"); assert.equal(tree.props.delayLongPress, 500);
    assert.equal(tree.props.onPress, undefined); assert.equal(tree.props.accessible, false);
    assert.equal(tree.props.onStartShouldSetResponderCapture, undefined);
    tree.props.onLongPress(); tree.props.onLongPress();
    assert.equal(f.sheets.length, 1); assert.deepEqual(f.calls, []);
    assert.deepEqual(f.sheets[0].options.options, ["Not for me", "Report post", "Cancel"]);
    f.sheets[0].choose(2); assert.deepEqual(f.calls, []);
    label(f.render({ log }), "More post actions").props.onPress();
    assert.ok(label(f.render({ log }), "Report post"));
    tree.props.onLongPress(); f.sheets[1].choose(1);
    assert.deepEqual(f.calls, [["onReport", log]]);
  }
});

test("native hold sheet fences recycled rows, account changes, ownership changes and unmount", () => {
  for (const retire of [f => f.render({ log: { ...review, id: "other" } }),
    f => { f.store.session = null; f.render(); f.store.session = { id: "author" }; f.render(); },
    f => f.render({ log: { ...review, userId: "other" } }), f => f.unmount()]) {
    const f = fixture({ own: true }); f.render().props.onLongPress();
    retire(f); f.sheets[0].choose(2); assert.deepEqual(f.calls, []);
  }
  const owner = fixture({ own: true }); owner.render().props.onLongPress();
  assert.deepEqual(owner.calls, []); owner.sheets[0].choose(2);
  assert.equal(owner.calls[0][0], "alert"); assert.equal(owner.calls.length, 1);
  assert.ok(owner.calls[0][3].find(button => button.style === "cancel"));
  const guest = fixture({ loggedIn: false }); guest.render().props.onLongPress();
  assert.deepEqual(guest.sheets[0].options.options, ["Not for me", "Report post", "Cancel"]);
  assert.deepEqual(guest.calls, []);
  assert.equal(fixture().render({ onReport: undefined, onNotInterested: undefined }).props.onLongPress, undefined);
});

test("native sheet uses latest callback and never replaces nested media or non-iOS interactions", () => {
  const f = fixture(); const tree = f.render(); tree.props.onLongPress();
  let reported; f.render({ onReport: log => { reported = log; } }); f.sheets[0].choose(1);
  assert.equal(reported, review); assert.deepEqual(f.calls, []);
  const opener = { focus() {} }, media = type(tree, "PostMediaGrid");
  assert.equal(media.props.onLongPress, undefined); media.props.onOpen(0, opener);
  assert.equal(f.calls[0][0], "onOpenPhotos"); assert.equal(f.calls[0][4], opener);
  for (const platform of ["web", "android"]) {
    const other = fixture({ platform }).render();
    assert.equal(other.type, "View"); assert.equal(other.props.onLongPress, undefined);
  }
});

test("body link responders receive the hold handler while ordinary navigation and media remain separate", () => {
  for (const log of [review, { ...review, kind: "status" }, { ...review, review: "" }, { ...review, experienceType: "online" }]) {
    const f = fixture(); const tree = f.render({ log });
    const expandable = type(tree, "ExpandableText");
    const body = expandable ? expandable.props.renderText({ text: "Review", accessibilityLabel: "Review" })
      : nodes(tree).find(node => node.type === "PublicPressableLink" && node.props.onLongPress);
    assert.equal(body.props.onLongPress, tree.props.onLongPress);
    assert.equal(body.props.delayLongPress, 500);
    body.props.onLongPress(); assert.equal(f.sheets.length, 1); assert.deepEqual(f.calls, []);
    f.sheets[0].choose(f.sheets[0].options.cancelButtonIndex);
    body.props.onNavigate(); assert.equal(f.calls.length, 1, "ordinary taps retain their navigation owner");
  }
});

test("retained Feed presentation rejects a sheet and a later delete confirmation after navigation", () => {
  const f = fixture({ own: true }); let current = true;
  const contextPresentation = { current: () => current };
  f.render({ contextPresentation }).props.onLongPress(); current = false;
  f.sheets[0].choose(2); assert.deepEqual(f.calls, []);
  f.render({ contextPresentation }).props.onLongPress(); assert.equal(f.sheets.length, 1);
  current = true; f.render({ contextPresentation }).props.onLongPress(); f.sheets[1].choose(2);
  assert.equal(f.calls[0][0], "alert"); current = false;
  f.calls[0][3].find(button => button.style === "destructive").onPress();
  assert.equal(f.calls.length, 1, "navigation during delete confirmation cannot mutate the retained post");
});

test("native-sheet deletion confirmation is retired on account switch", () => {
  const f = fixture({ own: true }); f.render().props.onLongPress(); f.sheets[0].choose(2);
  f.store.session = { id: "other" }; f.render();
  f.calls[0][3].find(button => button.style === "destructive").onPress();
  assert.equal(f.calls.length, 1);
});

test("existing Android delete button still accepts its native press event", () => {
  const f = fixture({ platform: "android", own: true });
  label(f.render(), "Delete post").props.onPress({ nativeEvent: {} });
  f.calls[0][3].find(button => button.style === "destructive").onPress();
  assert.deepEqual(f.calls.at(-1), ["onDelete", review.id]);
});

test("queued old hold handlers cannot borrow a new post/account action owner", () => {
  for (const retire of [f => f.render({ log: { ...review, id: "other" } }),
    f => { f.store.session = { id: "another-viewer" }; f.render(); },
    f => { f.store.session = null; f.render(); f.store.session = { id: "viewer" }; f.render(); },
    f => f.unmount()]) {
    const f = fixture(), hold = f.render().props.onLongPress;
    retire(f); hold(); assert.equal(f.sheets.length, 0); assert.deepEqual(f.calls, []);
  }
  assert.match(readFileSync(new URL("../hooks/useTicketPresentation.ios.js", import.meta.url), "utf8"), /useLayoutEffect\(\(\) => \{\s*mounted.current = true;/,
    "native callback ownership retires during unmount commit, not a later passive effect");
});

test("layout-effect reconnect retires old native callbacks and publishes a usable hold handler", () => {
  const f = fixture(), oldHold = f.render().props.onLongPress;
  oldHold(); f.reconnect();
  f.sheets[0].choose(1); assert.deepEqual(f.calls, []);
  oldHold(); assert.equal(f.sheets.length, 1);
  f.render().props.onLongPress(); assert.equal(f.sheets.length, 2);
  f.sheets[1].choose(1); assert.deepEqual(f.calls, [["onReport", review]]);
});

test("native sheet callbacks are consumed once and cannot release a newer sheet", () => {
  for (const firstChoice of [1, 2]) {
    const f = fixture(); const hold = f.render().props.onLongPress;
    hold(); const old = f.sheets[0]; old.choose(firstChoice);
    const expected = firstChoice === 1 ? [["onReport", review]] : [];
    old.choose(1); assert.deepEqual(f.calls, expected, "selected and canceled sheets cannot run again");
    hold(); assert.equal(f.sheets.length, 2);
    old.choose(1); old.choose(2); hold();
    assert.equal(f.sheets.length, 2, "old callbacks cannot clear the newer sheet's busy owner");
    assert.deepEqual(f.calls, expected);
    f.sheets[1].choose(1); f.sheets[1].choose(1);
    assert.deepEqual(f.calls, [...expected, ["onReport", review]]);
    hold(); assert.equal(f.sheets.length, 3, "consuming the current sheet permits a fresh hold");
  }
});

test("campaign artwork requires committed presentation and motion permission", () => {
  const uri = "https://example.test/campaign.gif";
  const log = { ...review, kind: "status", photos: [uri],
    media: [{ id: "ma_campaign_art", kind: "image", status: "ready", uri }],
    campaign: { version: 1, treatment: "after-dark", backgroundAssetId: "ma_campaign_art" } };
  for (const platform of ["ios", "android", "web"]) for (const preview of [false, true]) for (const reduceMotion of [false, true]) {
    const f = fixture({ platform, preview, reduceMotion });
    const image = type(f.render({ log }), "ExpoImage");
    assert.ok(image, `${platform} renders the real campaign artwork`);
    assert.equal(image.props.source.uri, uri);
    assert.equal(image.props.autoplay, !(platform === "ios" && preview) && !reduceMotion);
    assert.equal(image.props.transition, reduceMotion ? 0 : 180);
    assert.equal(image.props.accessible, false);
  }
});

test("iOS footer metadata shares one wrapping row outside the unchanged swipe action region", () => {
  for (const log of [review, { ...review, kind: "status" }, { ...review, experienceType: "online" },
    { ...review, kind: "status", campaign: { version: 1, treatment: "after-dark" } }]) {
    const f = fixture(), tree = f.render({ log: { ...log, recommendation: { personalized: true } } });
    const row = nodes(tree).find(n => n.type === "View" && style(n.props.style).columnGap === 12 && style(n.props.style).flexWrap === "wrap");
    assert.ok(row); assert.ok(label(row, "9 member views"));
    assert.ok(label(row, "Suggested post. Show more information."));
    assert.equal(nodes(tree).filter(n => n.props?.accessibilityLabel === "9 member views").length, 1);
    const swipe = type(tree, "PostSwipeActions");
    assert.equal(label(swipe, "9 member views"), undefined);
    assert.equal(label(swipe, "Suggested post. Show more information."), undefined);
    assert.ok(label(swipe, "Like, 3 likes")); assert.ok(label(swipe, "Comments, 0"));
    assert.ok(type(swipe, "RepostButton")); assert.ok(type(swipe, "SocialShareButton"));
    assert.ok(label(swipe, "More post actions"));
    const rail = nodes(swipe).find(n => n.type === "View" && style(n.props.style).borderTopWidth);
    assert.equal(style(rail.props.style).marginTop, 4); assert.equal(style(rail.props.style).paddingTop, 4);
    const tallyStyle = style(label(row, "9 member views").props.style);
    assert.equal(tallyStyle.minHeight, undefined); assert.equal(tallyStyle.maxWidth, "100%");
  }
});

test("iOS metadata controls grow and wrap, expanded details remain full-width siblings", () => {
  const f = fixture(), input = { log: { ...review, recommendation: { personalized: true }, eventAddress: "A long address" } };
  let tree = f.render(input);
  for (const text of ["Show details", "Suggested post. Show more information."]) {
    const control = label(tree, text), controlStyle = style(control.props.style);
    assert.ok(controlStyle.minHeight >= 44); assert.ok(controlStyle.minWidth >= 44);
    assert.equal(controlStyle.height, undefined);
    for (const node of nodes(control).filter(n => n.type === "Text")) {
      assert.equal(node.props.numberOfLines, undefined); assert.equal(node.props.adjustsFontSizeToFit, undefined);
      assert.equal(style(node.props.style).flexShrink, 1);
    }
    control.props.onPress();
  }
  tree = f.render(input);
  const row = nodes(tree).find(n => n.type === "View" && style(n.props.style).columnGap === 12);
  assert.equal(label(row, "View Main artist show"), undefined);
  assert.ok(label(tree, "View Main artist show"));
  assert.ok(nodes(row).some(n => style(n.props?.style).flexBasis === "100%"));
  assert.equal(label(tree, "Suggested post. Hide more information.").props.accessibilityState.expanded, true);
});
