import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync, parseSync } from "@babel/core";

const require = createRequire(import.meta.url);
const postSource = readFileSync(new URL("./PostScreen.jsx", import.meta.url), "utf8");
const paths = { PostScreen: "./PostScreen.jsx", PhotoViewer: "../components/PhotoViewer.jsx" };
const compiled = new Map();
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node)
  ? node.flatMap(nodes) : typeof node.type === "function" ? nodes(node.type(node.props))
    : [node, ...nodes(node.props?.children)];

// Execute production components and callbacks. Only platform, rendering and
// store seams are replaced; domain projections are their real implementations.
function fixture(name, initialSession, overrides = {}) {
  const calls = { auth: [], comments: [], likes: [], close: [], show: [], scroll: [], focus: [], remember: [], order: [] };
  const slots = [];
  let cursor = 0;
  let session = initialSession;
  const componentUrl = new URL(paths[name], import.meta.url);
  const localRequire = createRequire(componentUrl);
  if (!compiled.has(name)) compiled.set(name, transformSync(readFileSync(componentUrl, "utf8"), {
    filename: `${name}.jsx`, babelrc: false, configFile: false,
    plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
  }).code);
  const jsx = (type, props) => ({ type, props });
  const componentRequire = (dependency) => {
    if (dependency === "react") return {
      useEffect() {}, useMemo: (create) => create(), useCallback: (callback) => callback,
      useRef(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      },
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
      },
    };
    if (dependency === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
    if (dependency === "react-native") return {
      ActivityIndicator: "ActivityIndicator", View: "View", Text: "Text", ScrollView: "ScrollView",
      Pressable: "Pressable", TextInput: "TextInput", Modal: "Modal", Alert: { alert() {} }, Linking: {},
      Platform: { OS: "web" }, StyleSheet: { create: (styles) => styles, absoluteFill: {}, absoluteFillObject: {} },
    };
    if (dependency === "expo") return { useEvent: () => ({}) };
    if (dependency === "expo-video") return { VideoView: "VideoView", useVideoPlayer: () => ({}) };
    if (dependency === "../theme") return { colors: {}, radius: {}, roleColor: () => null };
    if (dependency === "../store") return { useStore: () => ({ session, feed: [],
      commentsFor: () => [{ id: "c_public", userId: "author", name: "Public Author", text: "Public comment" }],
      userById: () => null, userBadges: () => [], loadComments: async () => ({ ok: true }),
      addComment: async (...args) => { calls.comments.push(args); return { ok: true }; },
      deleteOwnComment: () => assert.fail("guest must not delete"), deleteOwnPost: () => assert.fail("guest must not delete"),
    }) };
    if (dependency === "../hooks/useScopedRefresh") return () => ({ refresh() {}, refreshing: false });
    if (dependency.endsWith("/Badge")) return { BadgeRow: "BadgeRow" };
    if (dependency.endsWith("/PublicWebLinks")) return { PublicTextLink: "PublicTextLink" };
    if (dependency.startsWith("../components/") || dependency.startsWith("./")) return dependency.split("/").at(-1);
    return localRequire(dependency);
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled.get(name))(componentRequire, module, module.exports);
  const log = { id: "p_public", artist: "Public Artist", venue: "Public Venue", review: "A public review" };
  let props = {
    log, photos: ["https://example.test/first.jpg", "https://example.test/second.jpg"], index: 0, postId: log.id,
    onRequireAuth: (...args) => { calls.order.push("auth"); calls.auth.push(args); },
    onRememberIndex: (index) => { calls.order.push("remember"); calls.remember.push(index); },
    toggleMediaReaction: (...args) => calls.likes.push(args), loadMediaReactions() {},
    onClose: (...args) => calls.close.push(args), onOpenShow: (...args) => calls.show.push(args),
    ...overrides,
  };
  let tree;
  const render = (update = {}) => {
    props = { ...props, ...update };
    cursor = 0;
    tree = module.exports.default({ ...props, session });
  };
  const find = (predicate) => {
    const node = nodes(tree).find(predicate);
    assert.ok(node, "the production component must render this control");
    return node;
  };
  render();
  return { calls, log, render, find, all: () => nodes(tree), setSession(value) { session = value; render(); } };
}

for (const session of [null, undefined, {}]) {
  test(`PostScreen guest ${String(session)} reply and sign-in CTA do not mutate or navigate away`, () => {
    const f = fixture("PostScreen", session);
    f.find((node) => node.props.accessibilityLabel === "Reply to comment").props.onPress();
    f.find((node) => node.props.accessibilityLabel === "Sign in to comment").props.onPress();
    assert.deepEqual(f.calls.auth, [[], []], "no mutation continuation is handed to auth");
    assert.deepEqual(f.calls.comments, []);
    assert.deepEqual(f.calls.show, []);
    assert.deepEqual(f.calls.close, []);
    assert.equal(f.all().some((node) => node.type === "TextInput"), false);
    f.setSession({ id: "member" });
    assert.deepEqual(f.calls.comments, [], "sign-in never replays the attempted guest reply");
  });
}

test("PostScreen footer comment links scroll to this thread and leave show navigation explicit", () => {
  const f = fixture("PostScreen");
  f.find((node) => node.type === "ScrollView").props.ref.current = { scrollToEnd: (...args) => f.calls.scroll.push(args) };
  const ticket = f.find((node) => node.type === "TicketStub");
  ticket.props.onComment();
  ticket.props.onOpenPost();
  assert.deepEqual(f.calls.scroll, [[{ animated: true }], [{ animated: true }]]);
  assert.deepEqual(f.calls.show, []);
  assert.deepEqual(f.calls.auth, []);
  ticket.props.onRequireAuth();
  assert.deepEqual(f.calls.auth, [[]]);
});

test("PostScreen member reply and send preserve the parent comment and clear the completed draft", async () => {
  const f = fixture("PostScreen", { id: "member" });
  f.find((node) => node.type === "TextInput").props.ref.current = { focus: () => f.calls.focus.push(true) };
  f.find((node) => node.props.accessibilityLabel === "Reply to comment").props.onPress();
  f.render();
  assert.deepEqual(f.calls.focus, [true]);
  const input = f.find((node) => node.type === "TextInput");
  assert.equal(input.props.placeholder, "Write a reply...");
  input.props.onChangeText("  A deliberate member reply  ");
  f.render();
  await f.find((node) => node.props.accessibilityLabel === "Send comment").props.onPress();
  assert.deepEqual(f.calls.comments, [[f.log.id, "A deliberate member reply", "c_public"]]);
  assert.deepEqual(f.calls.auth, []);
  f.render();
  assert.equal(f.find((node) => node.type === "TextInput").props.value, "");
  assert.equal(f.find((node) => node.type === "TextInput").props.placeholder, "Reply to this post...");
});

test("PostScreen send guard rejects a guest even when a nonempty draft reaches the callback", async () => {
  const ast = parseSync(postSource, { filename: "PostScreen.jsx", babelrc: false, configFile: false, parserOpts: { plugins: ["jsx"] } });
  const screen = ast.program.body.find((node) => node.type === "ExportDefaultDeclaration").declaration;
  const send = screen.body.body.filter((node) => node.type === "VariableDeclaration")
    .flatMap((node) => node.declarations).find((node) => node.id.name === "send").init;
  for (const session of [null, undefined, {}]) {
    const calls = [];
    const action = new Function("session", "onRequireAuth", "text", "sending", "addComment", "setSending", "log", "replyTo", "setText", "setReplyTo",
      `return (${postSource.slice(send.start, send.end)});`)(session, (...args) => calls.push(args), "Guest draft", false,
      () => assert.fail("guest send must not mutate"), () => assert.fail("guest send must not start pending state"), { id: "p_public" }, null,
      () => assert.fail("guest draft must not change"), () => assert.fail("guest reply must not change"));
    await action();
    assert.deepEqual(calls, [[]]);
  }
});

test("PhotoViewer guest heart remembers the displayed index before auth without closing or liking", () => {
  const f = fixture("PhotoViewer");
  f.find((node) => node.props.accessibilityLabel === "Next media").props.onPress();
  f.render();
  assert.equal(f.find((node) => node.type === "SmartImage").props.uri, "https://example.test/second.jpg");
  let stopped = 0;
  const heart = f.find((node) => /^Like this photo/.test(node.props.accessibilityLabel || ""));
  assert.equal(heart.props.disabled, false);
  heart.props.onPress({ stopPropagation: () => { stopped++; } });
  assert.equal(stopped, 1);
  assert.deepEqual(f.calls.remember, [1]);
  assert.deepEqual(f.calls.order, ["remember", "auth"]);
  assert.deepEqual(f.calls.auth, [[]]);
  assert.deepEqual(f.calls.likes, []);
  assert.deepEqual(f.calls.close, []);
  const restored = fixture("PhotoViewer", null, { index: f.calls.remember[0] });
  assert.equal(restored.find((node) => node.type === "SmartImage").props.uri, "https://example.test/second.jpg");
  f.setSession({ id: "member" });
  assert.deepEqual(f.calls.likes, [], "sign-in alone cannot replay a guest heart tap");
  f.find((node) => /^Like this photo/.test(node.props.accessibilityLabel || "")).props.onPress();
  assert.deepEqual(f.calls.likes, [["https://example.test/second.jpg", "p_public"]]);
});

test("PhotoViewer remembers its displayed index before guest report navigation too", () => {
  const order = [];
  const f = fixture("PhotoViewer", null, {
    onRememberIndex: (index) => order.push(["remember", index]),
    onReport: (target) => order.push(["report", target.mediaUri]),
  });
  f.find((node) => node.props.accessibilityLabel === "Next media").props.onPress();
  f.render();
  f.find((node) => node.props.accessibilityLabel === "Report this photo").props.onPress();
  assert.deepEqual(order, [["remember", 1], ["report", "https://example.test/second.jpg"]]);
  assert.deepEqual(f.calls.likes, []);
});

test("PhotoViewer without post context keeps hearts disabled and close remains public", () => {
  const f = fixture("PhotoViewer", null, { postId: null });
  assert.equal(f.find((node) => /^Like this photo/.test(node.props.accessibilityLabel || "")).props.disabled, true);
  f.find((node) => node.props.accessibilityLabel === "Close").props.onPress();
  assert.deepEqual(f.calls.close, [[]]);
  assert.deepEqual(f.calls.auth, []);
  assert.deepEqual(f.calls.likes, []);
});

test("PostScreen and PhotoViewer tolerate an absent optional auth callback", () => {
  const post = fixture("PostScreen", null, { onRequireAuth: undefined });
  post.find((node) => node.props.accessibilityLabel === "Reply to comment").props.onPress();
  post.find((node) => node.props.accessibilityLabel === "Sign in to comment").props.onPress();
  const photo = fixture("PhotoViewer", null, { onRequireAuth: undefined, onRememberIndex: undefined });
  photo.find((node) => /^Like this photo/.test(node.props.accessibilityLabel || "")).props.onPress();
  assert.deepEqual(post.calls.comments, []);
  assert.deepEqual(photo.calls.likes, []);
});

const appSource = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const appAst = parseSync(appSource, { filename: "App.js", babelrc: false, configFile: false, parserOpts: { plugins: ["jsx"] } });
const root = appAst.program.body.find((node) => node.type === "FunctionDeclaration" && node.id.name === "Root");
const rootFunction = (name) => {
  const node = root.body.body.filter((entry) => entry.type === "VariableDeclaration")
    .flatMap((entry) => entry.declarations).find((entry) => entry.id.name === name)?.init;
  assert.ok(node, `Root must provide ${name}`);
  return appSource.slice(node.start, node.end);
};

test("Root consistently wires every public guest action surface to the single sign-in entry", () => {
  const expected = {
    FeedScreen: 1, ProfileScreen: 1, PostScreen: 1, PhotoViewer: 1, ArtistScreen: 2,
    LoungeScreen: 1, FanClubScreen: 1, ShowScreen: 1, ClipsScreen: 1,
  };
  const found = Object.fromEntries(Object.keys(expected).map((name) => [name, []]));
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "JSXOpeningElement" && Object.hasOwn(found, node.name?.name)) found[node.name.name].push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(root);
  for (const [name, count] of Object.entries(expected)) {
    assert.equal(found[name].length, count, `all ${name} branches must be audited`);
    for (const component of found[name]) {
      const callback = component.attributes.find((attribute) => attribute.name?.name === "onRequireAuth")?.value?.expression;
      assert.equal(callback?.type, "Identifier", `${name} must forward the shared callback directly`);
      assert.equal(callback.name, "openSignIn");
    }
  }
  const remember = found.PhotoViewer[0].attributes.find((attribute) => attribute.name?.name === "onRememberIndex")?.value?.expression;
  assert.equal(remember?.name, "rememberPhotoIndex");
});

test("Root sign-in helper preserves the underlying frame, deduplicates taps, and stores no action replay", () => {
  const underlying = { post: { id: "p_public" } };
  const stackRef = { current: [{}, underlying] };
  const frames = [];
  const go = (frame) => { frames.push(frame); stackRef.current = [...stackRef.current, frame]; };
  const openSignIn = new Function("stackRef", "go", `return (${rootFunction("openSignIn")});`)(stackRef, go);
  const requireAuth = new Function("session", "openSignIn", `return (${rootFunction("requireAuth")});`)(null, openSignIn);
  requireAuth(() => assert.fail("a guest action must not execute or be saved"));
  openSignIn(() => assert.fail("a press payload must not become a deferred action"));
  assert.deepEqual(frames, [{ auth: true }]);
  assert.equal(stackRef.current[1], underlying);
  stackRef.current = stackRef.current.slice(0, -1);
  assert.equal(stackRef.current.at(-1), underlying, "cancel/back returns to the original public destination");
  assert.equal(frames.length, 1);
});

test("Root remembers only a valid current gallery index without growing the navigation stack", () => {
  const photos = { images: ["first", "second"], index: 0, postId: "p_public" };
  const stackRef = { current: [{}, { photos }] };
  const frames = [];
  const commitReplace = (frame) => { frames.push(frame); stackRef.current = [...stackRef.current.slice(0, -1), frame]; };
  const remember = new Function("stackRef", "commitReplace", `return (${rootFunction("rememberPhotoIndex")});`)(stackRef, commitReplace);
  for (const index of [-1, 2, 0.5, NaN, null, 0]) remember(index);
  assert.deepEqual(frames, []);
  remember(1);
  assert.equal(stackRef.current.length, 2);
  assert.equal(stackRef.current[1].photos.index, 1);
  assert.equal(stackRef.current[1].photos.images, photos.images);
  assert.equal(photos.index, 0, "the prior navigation object is immutable");
  stackRef.current.push({ auth: true });
  remember(0);
  assert.equal(frames.length, 1, "a late callback cannot replace the auth frame");
});
