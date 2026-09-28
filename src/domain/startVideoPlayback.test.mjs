import test from "node:test";
import assert from "node:assert/strict";
import { startVideoPlayback } from "./startVideoPlayback.mjs";
test("web invokes the element synchronously within the gesture and observes its rejection",async()=>{
  for(const name of ["NotAllowedError","NotSupportedError"]){
    let invoked=false;
    const failure=Object.assign(new Error(name),{name});
    const promise=startVideoPlayback({web:true,element:{play(){invoked=true;return Promise.reject(failure);}},player:{play(){throw Error("Unsafe wrapper called");}}});
    assert.equal(invoked,true);await assert.rejects(promise,error=>error===failure);
  }
});
test("native succeeds without DOM APIs and sync failures are returned as rejections",async()=>{
  let played=false;await startVideoPlayback({player:{play(){played=true;}}});assert.equal(played,true);
  await assert.rejects(startVideoPlayback({player:{play(){throw Error("decoder");}}}),/decoder/);
  await assert.rejects(startVideoPlayback({web:true}),/not ready/);
});
