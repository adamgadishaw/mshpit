import test from "node:test";
import assert from "node:assert/strict";
import { createNativeVenueCatalogResolver } from "./nativeVenueCatalogIndex.mjs";
import { resolveVenueCatalogKey } from "./venueIdentity.mjs";
test('native index preserves canonical precedence, aliases, typography and collision rejection',()=>{
 const catalogs=[['budweiser stage','other room'],["buddy's place"],['The Fillmore Detroit','Fillmore Charlotte'],['foo-bar','foo bar'],['Fillmore','The Fillmore'],['Room','room'],['meo arena','history','The O2 Arena']];
 const values=['RBC Amphitheatre','Altice Arena','History Toronto',"Buddy’s Place",'Fillmore Detroit','Foo.Bar','Fillmore','Room','O2 London','missing',null];
 for(const keys of catalogs){const resolve=createNativeVenueCatalogResolver(keys);for(const value of values){assert.equal(resolve(value),resolveVenueCatalogKey(value,keys));assert.equal(resolve(value),resolveVenueCatalogKey(value,keys));}}
});
test('new catalog snapshots invalidate prior hits and misses and retain duplicate-key rejection',()=>{
 const before=createNativeVenueCatalogResolver(['room']);assert.equal(before('New Room'),null);assert.equal(before('Room'),'room');
 const after=createNativeVenueCatalogResolver(['new room','room','room']);assert.equal(after('New Room'),'new room');assert.equal(after('Room'),null);
});
