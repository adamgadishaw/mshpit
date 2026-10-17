import test from "node:test";
import assert from "node:assert/strict";
import { nativeNearbyVenues } from "./nativeNearbyVenues.mjs";
test('native Nearby filters distance before counting and preserves released upcoming counts',()=>{
 let calls=0;const venues=[{name:'Room',coord:{distance:10}},{name:'Far',coord:{distance:200}},{name:'No coordinates'}];const events=[{venue:'room',releaseAt:1,upcoming:true},{venue:'Room',releaseAt:2,upcoming:true},{venue:'Room',releaseAt:20,upcoming:true},{venue:'room',releaseAt:1,upcoming:false},{venue:'Far',releaseAt:1,upcoming:true}];
 const result=nativeNearbyVenues(venues,events,{center:{},maxKm:75,now:10,distance:(_,c)=>c.distance,canonicalKey:n=>{calls++;return n.toLowerCase();},isUpcoming:e=>e.upcoming});assert.deepEqual(result,[{name:'Room',coord:{distance:10},distanceKm:10,upcoming:2}]);assert.equal(calls,3);
});
