import test from "node:test";
import assert from "node:assert/strict";
import { nativeVenueCoordinates } from "./nativeVenueCoordinates.mjs";
import { canonicalVenueKey } from "./venueIdentity.mjs";
test('coordinate index preserves rated-first, first-valid coordinates and explicit aliases',()=>{
 const index=nativeVenueCoordinates([{venue:'RBC Amphitheatre',lat:null,lng:null},{venue:'Budweiser Stage',lat:43,lng:-79},{venue:'Budweiser Stage',lat:44,lng:-80}],[{venue:'RBC Amphitheatre',lat:45,lng:-81},{venue:'Other',lat:1,lng:2}],canonicalVenueKey);assert.deepEqual(index.get('budweiser stage'),{lat:43,lng:-79});assert.deepEqual(index.get('other'),{lat:1,lng:2});assert.equal(index.size,2);
});
