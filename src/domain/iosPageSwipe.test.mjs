import assert from "node:assert/strict";
import test from "node:test";
import { releasedPageSwipe } from "./iosPageSwipe.mjs";
const base = { dx: -120, dy: 2, width: 400, startX: 250, screenWidth: 400 };
test("page release uses distance or intentional same-direction flick", () => {
 assert.equal(releasedPageSwipe(base), "negative");
 assert.equal(releasedPageSwipe({...base,dx:-50,velocityX:-800}),"negative");
 for (const change of [{dx:-20,velocityX:-1200},{dx:-50},{velocityX:800},{dy:100},{startX:10},{touches:2},{canceled:true},{canNext:false},{dx:120,canPrevious:false}]) assert.equal(releasedPageSwipe({...base,...change}),null);
});
