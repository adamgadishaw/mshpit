import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";
import * as attendanceTicket from "../domain/attendanceTicket.mjs";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("./GoingTicketComposer.jsx", import.meta.url), "utf8");
const implementation = transformSync(source, {
  filename: "GoingTicketComposer.jsx",
  configFile: false,
  babelrc: false,
  plugins: [
    [require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }],
    require("@babel/plugin-transform-modules-commonjs"),
  ],
}).code;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((done) => setImmediate(done));
const sameDependencies = (before, after) => before && after
  && before.length === after.length && before.every((value, index) => Object.is(value, after[index]));
const POST_ERROR = "Couldn't share this ticket right now. Your Going status is still saved.";

// Execute the actual component and event callbacks. The small hook scheduler
// gives tests explicit commit/unmount boundaries; only rendering/platform seams
// are replaced. No copied publish algorithm, backend, browser, or network call.
function fixture(overrides = {}) {
  const slots = [], pendingEffects = [], calls = [], dismissals = [], writes = [];
  let cursor = 0, mounted = true, tree, nextMutation = 0;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, (next) => {
        writes.push({ mounted });
        slots[index].value = typeof next === "function" ? next(slots[index].value) : next;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useMemo(create, dependencies) {
      const index = cursor++;
      if (!slots[index] || !sameDependencies(slots[index].dependencies, dependencies)) {
        slots[index] = { value: create(), dependencies };
      }
      return slots[index].value;
    },
    useEffect(create, dependencies) {
      const index = cursor++;
      if (slots[index] && sameDependencies(slots[index].dependencies, dependencies)) return;
      const previous = slots[index];
      slots[index] = { dependencies };
      pendingEffects.push(() => {
        previous?.cleanup?.();
        slots[index].cleanup = create();
      });
    },
  };
  const componentModule = { exports: {} };
  const componentRequire = (name) => {
    if (name === "react") return hooks;
    if (name === "react-native") return {
      Pressable: "Pressable", Text: "Text", TextInput: "TextInput", View: "View",
      StyleSheet: { create: (styles) => styles },
    };
    if (name === "../domain/attendanceTicket.mjs") return {
      ...attendanceTicket,
      createAttendanceTicketClientMutationId: () => `p_local_ticket_fixture_${++nextMutation}`,
    };
    if (name === "../theme") return { colors: {}, radius: {}, shadow: {} };
    if (["./Button", "./ConcertTicketCard", "./Icon"].includes(name)) return name.slice(2);
    return require(name);
  };
  new Function("require", "module", "exports", implementation)(componentRequire, componentModule, componentModule.exports);
  const Component = componentModule.exports.default;
  let props = {
    event: { artistName: "Fixture artist", venueName: "Fixture venue", startDate: "2026-10-12" },
    tourDateId: "event-a",
    user: { id: "account-a", name: "Fixture member" },
    onDismiss: () => dismissals.push("dismiss"),
    onPost: (post) => {
      const response = deferred();
      calls.push({ post, ...response });
      return response.promise;
    },
    ...overrides,
  };
  const nodes = (node) => {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap((child) => nodes(child));
    return [node, ...nodes(node.props?.children)];
  };
  const find = (predicate) => {
    const node = nodes(tree).find(predicate);
    assert.ok(node, "the actual composer must render the requested control");
    return node;
  };
  const render = (update = {}) => {
    assert.equal(mounted, true, "cannot render an unmounted fixture");
    props = { ...props, ...update };
    cursor = 0;
    tree = Component(props);
    for (const effect of pendingEffects.splice(0)) effect();
    return tree;
  };
  const button = (title) => find((node) => node.type === "Button" && node.props.title === title).props;
  const labelled = (label) => find((node) => node.props?.accessibilityLabel === label).props;
  const error = () => nodes(tree).find((node) => node.props?.accessibilityRole === "alert")?.props.children || "";
  const unmount = () => {
    mounted = false;
    for (const slot of slots) slot?.cleanup?.();
  };
  render();
  return { render, button, labelled, error, unmount, calls, dismissals, writes };
}

function enterDraft(f) {
  f.labelled("Optional note for your Going post").onChangeText("  Meet you there!  ");
  f.labelled("Share my seat location publicly").onPress();
  f.render();
  f.labelled("Public section or general admission area").onChangeText(" 118 ");
  f.labelled("Public row, optional").onChangeText(" G ");
  f.labelled("Public seat, optional").onChangeText(" 9 ");
  f.render();
}

test("a rejected publish releases loading and preserves the complete draft and mutation id for retry", async () => {
  const f = fixture();
  enterDraft(f);
  f.button("Share post").onPress();
  f.render();
  assert.equal(f.button("Share post").loading, true);
  assert.equal(f.button("Not now").disabled, true);
  f.calls[0].reject(new Error("private backend detail that must never render"));
  await tick();
  f.render();
  assert.equal(f.button("Share post").loading, false);
  assert.equal(f.button("Not now").disabled, false);
  assert.equal(f.error(), POST_ERROR);
  assert.equal(f.labelled("Optional note for your Going post").value, "  Meet you there!  ");
  assert.equal(f.labelled("Public section or general admission area").value, " 118 ");
  assert.equal(f.labelled("Public row, optional").value, " G ");
  assert.equal(f.labelled("Public seat, optional").value, " 9 ");
  assert.equal(f.labelled("Share my seat location publicly").accessibilityState.checked, true);
  f.button("Share post").onPress();
  f.render();
  assert.equal(f.error(), "");
  assert.deepEqual(f.calls[1].post, f.calls[0].post);
  assert.equal(f.calls[1].post.review, "Meet you there!");
  assert.equal(f.calls[1].post.attendanceTicket.includeSeat, true);
  assert.equal(f.calls[1].post.attendanceTicket.section, "118");
  assert.equal(f.calls[1].post.attendanceTicket.row, "G");
  assert.equal(f.calls[1].post.attendanceTicket.seat, "9");
  f.calls[1].resolve({ ok: true });
  await tick();
  f.render();
  assert.equal(f.button("Share post").loading, false);
  assert.deepEqual(f.dismissals, ["dismiss"]);
});

test("same-tick repeated presses and a retained callback send exactly one pending request", async () => {
  const f = fixture(), press = f.button("Share post").onPress;
  press();
  press();
  f.render();
  press();
  f.button("Share post").onPress();
  assert.equal(f.calls.length, 1);
  f.calls[0].resolve({ ok: true });
  await tick();
  press();
  assert.equal(f.calls.length, 1, "a completed composer cannot submit a second post before unmount");
  assert.deepEqual(f.dismissals, ["dismiss"]);
});

test("a synchronous callback throw is contained and leaves the composer retryable", async () => {
  const f = fixture({ onPost: () => { throw new Error("private synchronous failure"); } });
  f.button("Share post").onPress();
  await tick();
  f.render();
  assert.equal(f.button("Share post").loading, false);
  assert.equal(f.error(), POST_ERROR);
  assert.deepEqual(f.dismissals, []);
  f.render({ onPost: () => ({ ok: true }) });
  f.button("Share post").onPress();
  await tick();
  assert.deepEqual(f.dismissals, ["dismiss"]);
});

for (const result of [undefined, { ok: false }, { ok: false, error: { message: "private", userMessage: "generic" } }]) {
  test(`returned failure ${JSON.stringify(result)} uses only ticket-specific recovery copy`, async () => {
    const f = fixture();
    f.button("Share post").onPress();
    f.calls[0].resolve(result);
    await tick();
    f.render();
    assert.equal(f.button("Share post").loading, false);
    assert.equal(f.error(), POST_ERROR);
    assert.deepEqual(f.dismissals, []);
    assert.equal(f.calls[0].post.attendanceTicket.includeSeat, false);
    for (const field of ["section", "row", "seat", "seatLocation"]) {
      assert.equal(field in f.calls[0].post.attendanceTicket, false);
    }
  });
}

for (const result of [{ ok: true, stale: true }, { ok: false, stale: true }]) {
  test(`a stale result (${result.ok ? "successful" : "failed"}) cannot dismiss or report a fresh failure`, async () => {
    const f = fixture();
    f.button("Share post").onPress();
    f.calls[0].resolve(result);
    await tick();
    f.render();
    assert.equal(f.button("Share post").loading, false);
    assert.equal(f.error(), "");
    assert.deepEqual(f.dismissals, []);
    f.button("Share post").onPress();
    assert.equal(f.calls[1].post.id, f.calls[0].post.id);
    f.calls[1].resolve({ ok: false });
    await tick();
  });
}

for (const error of [Object.assign(new Error("cancelled"), { name: "AbortError" }), { stale: true }]) {
  test(`a thrown cancellation ${error.name || "stale"} silently releases the pending claim`, async () => {
    const f = fixture();
    f.button("Share post").onPress();
    f.calls[0].reject(error);
    await tick();
    f.render();
    assert.equal(f.button("Share post").loading, false);
    assert.equal(f.error(), "");
    assert.deepEqual(f.dismissals, []);
    f.button("Share post").onPress();
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].post.id, f.calls[0].post.id);
    f.calls[1].resolve({ ok: false });
    await tick();
  });
}

for (const outcome of ["success", "rejection"]) {
  test(`unmount ignores a late ${outcome} without any state writes or dismiss callback`, async () => {
    const f = fixture(), oldPress = f.button("Share post").onPress;
    oldPress();
    f.unmount();
    const before = f.writes.length;
    if (outcome === "success") f.calls[0].resolve({ ok: true });
    else f.calls[0].reject(new Error("late private failure"));
    await tick();
    oldPress();
    assert.equal(f.calls.length, 1);
    assert.equal(f.writes.length, before);
    assert.deepEqual(f.dismissals, []);
  });

  test(`explicit dismissal invalidates a pending ${outcome} even before unmount`, async () => {
    const f = fixture(), oldPress = f.button("Share post").onPress;
    oldPress();
    f.labelled("Do not share a Going post").onPress();
    const before = f.writes.length;
    if (outcome === "success") f.calls[0].resolve({ ok: true });
    else f.calls[0].reject(new Error("late private failure"));
    await tick();
    oldPress();
    f.render();
    assert.equal(f.calls.length, 1);
    assert.equal(f.writes.length, before);
    assert.equal(f.button("Share post").loading, false);
    assert.equal(f.error(), "");
    assert.deepEqual(f.dismissals, ["dismiss"]);
  });
}

for (const transition of ["account", "event", "logout", "account roundtrip", "event roundtrip"]) {
  for (const outcome of ["success", "rejection"]) {
    test(`${transition}: an old ${outcome} cannot clear or dismiss the new pending submission`, async () => {
      const f = fixture(), oldPress = f.button("Share post").onPress;
      oldPress();
      if (transition.startsWith("event")) f.render({ tourDateId: "event-b" });
      else f.render({ user: transition === "logout" ? null : { id: "account-b", name: "Other member" } });
      if (transition === "account roundtrip") f.render({ user: { id: "account-a", name: "Fixture member" } });
      if (transition === "event roundtrip") f.render({ tourDateId: "event-a" });
      assert.equal(f.button("Share post").loading, false);
      oldPress();
      assert.equal(f.calls.length, 1, "an old rendered callback cannot submit under the new identity");
      f.button("Share post").onPress();
      f.render();
      assert.notEqual(f.calls[1].post.id, f.calls[0].post.id);
      assert.equal(f.button("Share post").loading, true);
      const before = f.writes.length;
      if (outcome === "success") f.calls[0].resolve({ ok: true });
      else f.calls[0].reject(new Error("departed scope failure"));
      await tick();
      f.render();
      assert.equal(f.writes.length, before);
      assert.equal(f.button("Share post").loading, true);
      assert.equal(f.error(), "");
      assert.deepEqual(f.dismissals, []);
      f.calls[1].resolve({ ok: true });
      await tick();
      f.render();
      assert.equal(f.button("Share post").loading, false);
      assert.deepEqual(f.dismissals, ["dismiss"]);
    });
  }
}

test("old failure copy is scoped to its event and account", async () => {
  const f = fixture();
  f.button("Share post").onPress();
  f.calls[0].resolve({ ok: false });
  await tick();
  f.render();
  assert.equal(f.error(), POST_ERROR);
  f.render({ tourDateId: "event-b" });
  assert.equal(f.error(), "");
  f.button("Share post").onPress();
  f.calls[1].resolve({ ok: false });
  await tick();
  f.render();
  assert.equal(f.error(), POST_ERROR);
  f.render({ user: { id: "account-b" } });
  assert.equal(f.error(), "");
});

test("a missing exact event identity remains disabled and cannot call the publisher", () => {
  const f = fixture({ tourDateId: null });
  assert.equal(f.button("Share post").disabled, true);
  f.button("Share post").onPress();
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.dismissals, []);
});

for (const transition of ["account", "logout", "roundtrip"]) {
  test(`${transition}: private note, seat fields, and consent disappear synchronously from the replacement account`, async () => {
    const f = fixture();
    enterDraft(f);
    const oldNoteChange = f.labelled("Optional note for your Going post").onChangeText;
    const oldSeatChange = f.labelled("Public seat, optional").onChangeText;
    const oldConsent = f.labelled("Share my seat location publicly").onPress;
    f.button("Share post").onPress();
    f.render({ user: transition === "logout" ? null : { id: "account-b", name: "Other member" } });
    if (transition === "roundtrip") f.render({ user: { id: "account-a", name: "Fixture member" } });
    assert.equal(f.labelled("Optional note for your Going post").value, "");
    assert.equal(f.labelled("Share my seat location publicly").accessibilityState.checked, false);
    oldNoteChange("departed account text");
    oldSeatChange("departed seat");
    oldConsent();
    f.render();
    assert.equal(f.labelled("Optional note for your Going post").value, "");
    assert.equal(f.labelled("Share my seat location publicly").accessibilityState.checked, false);
    f.labelled("Share my seat location publicly").onPress();
    f.render();
    for (const label of ["Public section or general admission area", "Public row, optional", "Public seat, optional"]) {
      assert.equal(f.labelled(label).value, "");
    }
    f.labelled("Optional note for your Going post").onChangeText("new account draft");
    f.render();
    oldNoteChange("cannot overwrite the new draft");
    f.render();
    assert.equal(f.labelled("Optional note for your Going post").value, "new account draft");
    f.button("Share post").onPress();
    assert.equal(f.calls[1].post.review, "new account draft");
    assert.equal(f.calls[1].post.attendanceTicket.section, "");
    assert.equal(f.calls[1].post.attendanceTicket.row, "");
    assert.equal(f.calls[1].post.attendanceTicket.seat, "");
    assert.notEqual(f.calls[1].post.id, f.calls[0].post.id);
    f.calls[0].resolve({ ok: true });
    f.calls[1].resolve({ ok: false });
    await tick();
    assert.deepEqual(f.dismissals, []);
  });
}

test("a same-account refresh or event change preserves the draft while event mutations stay separate", async () => {
  const f = fixture();
  enterDraft(f);
  f.button("Share post").onPress();
  f.calls[0].resolve({ ok: false });
  await tick();
  f.render({ user: { id: "account-a", name: "Updated member name" } });
  assert.equal(f.labelled("Optional note for your Going post").value, "  Meet you there!  ");
  f.button("Share post").onPress();
  assert.equal(f.calls[1].post.id, f.calls[0].post.id);
  f.calls[1].resolve({ ok: false });
  await tick();
  f.render({ tourDateId: "event-b" });
  assert.equal(f.labelled("Optional note for your Going post").value, "  Meet you there!  ");
  assert.equal(f.labelled("Share my seat location publicly").accessibilityState.checked, true);
  assert.equal(f.labelled("Public section or general admission area").value, " 118 ");
  assert.equal(f.labelled("Public row, optional").value, " G ");
  assert.equal(f.labelled("Public seat, optional").value, " 9 ");
  f.button("Share post").onPress();
  assert.notEqual(f.calls[2].post.id, f.calls[0].post.id);
  assert.equal(f.calls[2].post.attendanceTicket.tourDateId, "event-b");
  f.calls[2].resolve({ ok: false });
  await tick();
});
