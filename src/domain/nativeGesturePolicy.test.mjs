import test from 'node:test';
import assert from 'node:assert/strict';
import { releasedSwipe, swipeThreshold, swipeAxis, adjacentSwipeTab } from './nativeGesturePolicy.mjs';
const swipe = overrides => releasedSwipe({dx:100,dy:0,width:380,startX:190,screenWidth:412,...overrides});
test('actions require deliberate horizontal release, never a tiny or diagonal flick',()=>{
 assert.equal(swipe({dx:96}),'positive');assert.equal(swipe({dx:-96}),'negative');
 for(const input of [{dx:40},{dx:94},{dx:100,dy:80},{canceled:true},{touches:2},{dx:NaN},{startX:10},{startX:400}]) assert.equal(swipe(input),null);
});
test('returning below the armed threshold cancels; thresholds adapt within bounds',()=>{
 assert.equal(swipe({dx:130}),'positive');assert.equal(swipe({dx:20}),null);
 assert.equal(swipeThreshold(200),72);assert.equal(swipeThreshold(380),95);assert.equal(swipeThreshold(1000),112);
 assert.equal(swipeAxis(4,20),'vertical');assert.equal(swipeAxis(4,4),'undecided');
});
test('page rail switches only adjacent existing tabs without wrapping',()=>{
 const tabs=['feed','search','discover','you'];
 assert.equal(adjacentSwipeTab('feed','negative',tabs),'search');assert.equal(adjacentSwipeTab('feed','positive',tabs),null);
 assert.equal(adjacentSwipeTab('you','negative',tabs),null);assert.equal(adjacentSwipeTab('you','positive',tabs),'discover');
 assert.equal(adjacentSwipeTab('detail','negative',tabs),null);
});
