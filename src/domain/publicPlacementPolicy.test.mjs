import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publicDiscoveryRailAllowed, playerAdvertisingAllowed } from "./publicPlacementPolicy.mjs";
test("public discovery is eligible, unknown/private overlays fail closed", () => {
  assert.equal(publicDiscoveryRailAllowed({},"discover"),true);
  assert.equal(publicDiscoveryRailAllowed({artistName:"Example"}),true);
  assert.equal(publicDiscoveryRailAllowed({artistName:"Example",artistPublicSlug:"example"}),true);
  assert.equal(publicDiscoveryRailAllowed({artistPublicSlug:"example"},"you"),false);
  assert.equal(publicDiscoveryRailAllowed({post:{id:"news_fixture"}}),true);
  assert.equal(publicDiscoveryRailAllowed({post:{id:"p_fixture"},editingPost:true}),false);
  assert.equal(publicDiscoveryRailAllowed({cityGuide:{city:"Toronto"}}),true);
  assert.equal(publicDiscoveryRailAllowed({},"you"),false);
  for(const key of ["auth","logging","editingPost","thread","inbox","settings","followList","profileId","admin","photos","reporting","unknownFutureOverlay"]){
    assert.equal(publicDiscoveryRailAllowed({artistName:"Example",[key]:true}),false,key);
  }
});
test("player ads cannot be activated by a verified upload or arbitrary metadata", () => {
  assert.equal(playerAdvertisingAllowed({codecVerified:true,rights:true,enabled:true}),false);
});
test("application unmounts the shared rail host on private overlays", () => {
  const app=readFileSync(new URL("../../App.js",import.meta.url),"utf8");
  assert.match(app,/showRightRail = rightRailLayout.visible && publicDiscoveryRailAllowed\(nav, activeTab\)/);
});
