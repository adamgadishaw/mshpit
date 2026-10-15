import test from "node:test";
import assert from "node:assert/strict";
import { createPlaybackMeasurement } from "./playbackMeasurement.mjs";
const sample = (tracker, time, overrides = {}) => tracker.sample({currentTime:time,duration:100,at:time*1000,playing:true,visible:true,...overrides});
test("seeking and hidden/background jumps never manufacture watched milestones", () => {
  const tracker = createPlaybackMeasurement();
  assert.deepEqual(sample(tracker,0), []);
  assert.deepEqual(sample(tracker,75,{at:1000}), []);
  assert.deepEqual(sample(tracker,99,{at:2000}), []);
  assert.deepEqual(sample(tracker,100,{at:3000,ended:true}), []);
  assert.equal(tracker.metrics().coveredSeconds,1);
  tracker.interrupt();
  sample(tracker,0,{at:4000}); sample(tracker,50,{at:54000});
  sample(tracker,51,{at:55000,visible:false}); sample(tracker,52,{at:56000});
  assert.equal(tracker.metrics().coveredSeconds,1);
});
test("continuous playback earns deduplicated coverage including honest completion", () => {
  const tracker = createPlaybackMeasurement(), events=[];
  for(let second=0;second<=100;second++) events.push(...sample(tracker,second,{ended:second===100}));
  assert.deepEqual(events,["25","50","75","100"]);
  assert.equal(tracker.metrics().coveredSeconds,100);
  assert.equal(tracker.metrics().watchedSeconds,100);
  assert.deepEqual(sample(tracker,100,{at:101000,ended:true}),[]);
});
test("replaying the same segment does not become full-video coverage", () => {
  const tracker=createPlaybackMeasurement(); let at=0;
  for(let loop=0;loop<10;loop++) for(let time=0;time<=10;time++) sample(tracker,time,{at:at++*1000});
  assert.equal(tracker.metrics().coveredSeconds,10);
  assert.equal(tracker.metrics().watchedSeconds,100);
});
test("pause, invalid input and backward clocks interrupt measurement", () => {
  const tracker=createPlaybackMeasurement(); sample(tracker,0);sample(tracker,1);
  sample(tracker,2,{playing:false});sample(tracker,3);sample(tracker,4,{at:2000});
  sample(tracker,5,{duration:NaN});sample(tracker,6);
  assert.equal(tracker.metrics().coveredSeconds,1);
});
test("supported faster playback measures content coverage separately from elapsed time", () => {
  const tracker=createPlaybackMeasurement(); const events=[];
  for(let time=0;time<=100;time+=2)events.push(...sample(tracker,time,{at:time*500,playbackRate:2,ended:time===100}));
  assert.deepEqual(events,["25","50","75","100"]);
  assert.equal(tracker.metrics().coveredSeconds,100);assert.equal(tracker.metrics().watchedSeconds,50);
});
