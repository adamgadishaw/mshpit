import assert from 'node:assert/strict';
import test from 'node:test';
import { artistPerformanceRating } from './profileScoring.mjs';

test('profile performance uses only numeric artist evidence and never overall or room', () => {
 assert.equal(artistPerformanceRating({performance:5,venue:1},null),5);
 assert.equal(artistPerformanceRating({performance:0,setlist:4},null),4);
 assert.equal(artistPerformanceRating({performance:null,setlist:0},5),null);
 assert.equal(artistPerformanceRating({experience:5},5),null);
 for(const value of [null,0,undefined,true,'5',-1,0.25,6,NaN]) assert.equal(artistPerformanceRating({performance:value},null),null);
 assert.equal(artistPerformanceRating({performance:0.5,setlist:5},null),2.75);
 assert.equal(artistPerformanceRating({performance:0.5},null),0.5);
 assert.equal(artistPerformanceRating({},0.5),0.5);
 assert.equal(artistPerformanceRating({},4),4);
 assert.equal(artistPerformanceRating({},null),null);
 assert.equal(artistPerformanceRating({performance:5,setlist:3},1),4);
});
