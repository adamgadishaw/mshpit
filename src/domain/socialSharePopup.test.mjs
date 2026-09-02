import assert from "node:assert/strict";
import test from "node:test";

import { openHttpsSharePopup } from "./socialSharePopup.mjs";

test("share popup opens blank, severs its opener, then navigates to HTTPS", () => {
  const actions = [];
  const popup = {
    _opener: "mshpit",
    get opener() { return this._opener; },
    set opener(value) {
      actions.push(["opener", value]);
      this._opener = value;
    },
    location: {
      replace(url) {
        actions.push(["navigate", url]);
      },
    },
  };

  const result = openHttpsSharePopup("https://twitter.com/intent/tweet?text=Mshpit", {
    openWindow(initialUrl, target, features) {
      actions.push(["open", initialUrl, target, features]);
      return popup;
    },
  });

  assert.deepEqual(result, { mode: "external" });
  assert.deepEqual(actions, [
    ["open", "", "_blank", undefined],
    ["opener", null],
    ["navigate", "https://twitter.com/intent/tweet?text=Mshpit"],
  ]);
});

test("share popup rejects unsafe URLs before opening a window", () => {
  let opens = 0;
  const openWindow = () => {
    opens += 1;
    return {};
  };
  for (const url of [
    "http://twitter.com/intent/tweet",
    "javascript:alert(1)",
    "//twitter.com/intent/tweet",
    "https://name:secret@twitter.com/intent/tweet",
  ]) {
    assert.throws(() => openHttpsSharePopup(url, { openWindow }), /UNSAFE_SHARE_URL/);
  }
  assert.equal(opens, 0);
});

test("share popup reports a genuinely blocked window", () => {
  assert.throws(
    () => openHttpsSharePopup("https://www.facebook.com/sharer/sharer.php", { openWindow: () => null }),
    /POPUP_BLOCKED/,
  );
});

test("share popup closes a blank window when safe navigation cannot start", () => {
  let closed = 0;
  const popup = {
    opener: "mshpit",
    location: {},
    close() { closed += 1; },
  };
  assert.throws(
    () => openHttpsSharePopup("https://twitter.com/intent/tweet", { openWindow: () => popup }),
    /POPUP_NAVIGATION_UNAVAILABLE/,
  );
  assert.equal(popup.opener, null);
  assert.equal(closed, 1);
});
