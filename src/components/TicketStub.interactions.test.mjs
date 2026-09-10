import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";
import { parse } from "@babel/parser";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("./TicketStub.jsx", import.meta.url), "utf8");
const compile = (code) => transformSync(code, {
  filename: "TicketStub.jsx", configFile: false, babelrc: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }],
    require("@babel/plugin-transform-modules-commonjs")],
}).code;
const implementation = compile(source);
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node)
  ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];

// Execute production JSX callbacks; replace hooks/platform/render seams only.
// Domain projections remain real. No browser, backend, or network is involved.
function fixture(kind = "concert", props = {}) {
  const calls = { auth: [], likes: [], show: [], post: [], comments: [], photos: [], profile: [] };
  const slots = [];
  let cursor = 0, session = null;
  const componentRequire = (name) => {
    if (name === "react") return {
      useContext: () => null, useMemo: (create) => create(),
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
      },
    };
    if (name === "react-native") return {
      View: "View", Text: "Text", Pressable: "Pressable", Alert: { alert() {} }, Linking: {},
      Platform: { OS: "web", select: (values) => values.web || values.default || {} },
      StyleSheet: { create: (styles) => styles, absoluteFill: {} },
    };
    if (name === "expo-image") return { Image: "ExpoImage" };
    if (name === "../theme") return { colors: {}, radius: {}, shadow: {}, space: (value) => value, roleColor: () => null };
    if (name === "../store") return { useStore: () => ({ session,
      userById: () => null, likeInfo: () => ({ count: 3, liked: false }), commentsFor: () => [], userBadges: () => [],
      toggleLike: (...args) => calls.likes.push(args), deleteOwnPost: () => assert.fail("not an owner"),
    }) };
    if (name === "../hooks/useReducedMotion") return () => true;
    if (name === "./PublicWebLinks") return { PublicPressableLink: "PublicPressableLink", PublicTextLink: "PublicTextLink" };
    if (name === "./SocialShareStudio") return { SocialShareButton: "SocialShareButton" };
    if (name === "./Badge") return { BadgeRow: "BadgeRow" };
    if (name === "./cities/CityNavigationContext") return { CityNavigationContext: {} };
    if (name.startsWith("./")) return name.slice(2);
    return require(name);
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", implementation)(componentRequire, module, module.exports);
  const log = { id: "p_guest_fixture", kind: kind === "status" ? "status" : "review",
    experienceType: kind === "online" ? "online" : "live", artist: "Fixture Artist", venue: "Fixture Venue",
    userId: "author", user: { id: "author", name: "Fixture Author", handle: "fixture-author", role: "fan" },
    date: "2026-09-01", review: "A public concert memory", likes: 3, comments: 2, overall: 4, band: 4, room: 4,
    taggedPeople: [{ id: "friend", name: "Public Friend", handle: "friend" }],
    photos: ["https://example.test/public-photo.jpg"],
  };
  let currentProps = { log, onRequireAuth: (...args) => calls.auth.push(args),
    onOpen: (...args) => calls.show.push(args), onOpenPost: (...args) => calls.post.push(args),
    onComment: (...args) => calls.comments.push(args), onOpenPhotos: (...args) => calls.photos.push(args),
    onOpenProfile: (...args) => calls.profile.push(args), ...props };
  let tree;
  const render = (update = {}) => { currentProps = { ...currentProps, ...update }; cursor = 0; tree = module.exports.default(currentProps); };
  const find = (predicate) => {
    const node = nodes(tree).find(predicate);
    assert.ok(node, "the real card must render the requested control");
    return node;
  };
  render();
  return { calls, log, render, find, signIn: () => { session = { id: "viewer", role: "fan" }; render(); } };
}

for (const kind of ["status", "concert", "online"]) {
  test(`${kind} guest Like requests authentication without navigation, mutation, or deferred replay`, () => {
    const f = fixture(kind);
    let stopped = 0;
    f.find((node) => /^Like,/.test(node.props.accessibilityLabel || "")).props.onPress({
      stopPropagation: () => { stopped++; }, nativeEvent: { stopPropagation: () => { stopped++; } },
    });
    assert.deepEqual(f.calls.auth, [[]], "the prompt receives no saved mutation continuation");
    assert.deepEqual(f.calls.likes, []);
    assert.deepEqual(f.calls.show, []);
    assert.deepEqual(f.calls.post, []);
    assert.deepEqual(f.calls.comments, []);
    assert.equal(stopped, 2);
    f.signIn();
    assert.deepEqual(f.calls.likes, [], "sign-in alone never replays the guest tap");
    f.find((node) => /^Like,/.test(node.props.accessibilityLabel || "")).props.onPress();
    assert.deepEqual(f.calls.likes, [[f.log.id, 3]], "a new deliberate member tap still likes exactly once");
  });
  test(`${kind} guest comment controls remain public and target the original post`, () => {
    const f = fixture(kind, { onComment: undefined });
    f.find((node) => /^Comments,/.test(node.props.accessibilityLabel || "")).props.onNavigate();
    f.find((node) => node.type === "AfterpartyPreview").props.onOpen(f.log);
    assert.deepEqual(f.calls.post, [[f.log], [f.log]]);
    assert.deepEqual(f.calls.show, []);
    assert.deepEqual(f.calls.auth, []);
    assert.deepEqual(f.calls.likes, []);
  });
  test(`${kind} missing guest auth handler never falls through to show navigation`, () => {
    const f = fixture(kind, { onRequireAuth: undefined });
    f.find((node) => /^Like,/.test(node.props.accessibilityLabel || "")).props.onPress();
    assert.deepEqual(f.calls.show, []);
    assert.deepEqual(f.calls.post, []);
    assert.deepEqual(f.calls.likes, []);
  });
}

test("comments without an in-app post callback retain a real browser link, not a show callback", () => {
  const f = fixture("concert", { onComment: undefined, onOpenPost: undefined });
  const comments = f.find((node) => /^Comments,/.test(node.props.accessibilityLabel || "")).props;
  assert.equal(comments.href, `/post/${f.log.id}`);
  assert.equal(comments.onNavigate, undefined, "do not suppress native browser navigation with an empty callback");
});

test("guest media, profile tags, and sharing keep their public viewing contracts", () => {
  const f = fixture("concert");
  f.find((node) => node.type === "PostMediaGrid").props.onOpen(0);
  assert.equal(f.calls.photos.length, 1);
  const tags = f.find((node) => node.type?.name === "TaggedPeopleRow");
  assert.equal(tags.props.selfId, undefined);
  const profile = nodes(tags.type(tags.props)).find((node) => node.type === "PublicPressableLink");
  profile.props.onNavigate();
  assert.deepEqual(f.calls.profile, [["friend"]]);
  const share = f.find((node) => node.type === "SocialShareButton");
  assert.equal(share.props.accountId, null);
  assert.ok(share.props.model);
  assert.deepEqual(f.calls.auth, []);
  assert.deepEqual(f.calls.likes, []);
});

for (const [path, variable, itemProp] of [
  ["../screens/FeedScreen.jsx", "FeedTicketRow", "item"],
  ["../screens/ProfileScreen.jsx", "ProfileTicketRow", "log"],
]) {
  test(`${variable} forwards the latest guest auth callback without copying a stale handler`, () => {
    const screen = readFileSync(new URL(path, import.meta.url), "utf8");
    const declaration = parse(screen, { sourceType: "module", plugins: ["jsx"] }).program.body
      .find((node) => node.type === "VariableDeclaration" && node.declarations[0].id.name === variable);
    const component = declaration.declarations[0].init.arguments[0];
    const body = compile(`const Row = ${screen.slice(component.start, component.end)}; export default Row;`);
    const module = { exports: {} };
    const actionsRef = { current: { onRequireAuth: () => assert.fail("stale handler") } };
    new Function("require", "module", "exports", "useCallback", "TicketStub", body)
      (require, module, module.exports, (callback) => callback, "TicketStub");
    const row = module.exports.default({ [itemProp]: { id: "p_fixture" }, actionsRef,
      capabilities: { requireAuth: true }, surface: "everyone", itemIndex: 0 });
    let prompts = 0;
    actionsRef.current = { onRequireAuth: () => { prompts++; } };
    assert.equal(typeof row.props.onRequireAuth, "function");
    row.props.onRequireAuth();
    assert.equal(prompts, 1);
    assert.match(screen, /const canRequireAuth = typeof onRequireAuth === "function"/);
    assert.match(screen, /requireAuth: canRequireAuth/);
    assert.match(screen, /(?:rowActionsRef|postActionsRef)\.current = \{[\s\S]*?onRequireAuth,/);
  });
}
