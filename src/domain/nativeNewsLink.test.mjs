import test from "node:test";
import assert from "node:assert/strict";
import { nativeNewsLinkFrame } from "./nativeNewsLink.mjs";
import { navigationFrameForAccount } from "./memberAccess.mjs";
test("owned native news links cross the free-account boundary",()=>{
 for(const url of ['mshpit-dev://news','mshpit://news','https://www.mshpit.com/news','https://mshpit.com/news']){const frame=nativeNewsLinkFrame(url);assert.deepEqual(frame,{news:true});assert.deepEqual(navigationFrameForAccount(frame,null,'android'),{auth:true,authReturn:{news:true}});assert.equal(navigationFrameForAccount(frame,'member','ios'),frame);}
 assert.deepEqual(nativeNewsLinkFrame('mshpit-dev://news/live/example'),{news:true,liveSlug:'example'});
});
test("unowned URLs, credentials, non-news and dev-client links are ignored",()=>{
 for(const url of ['https://evil.example/news','http://www.mshpit.com/news','https://user:password@www.mshpit.com/news','mshpit-dev://expo-development-client/?url=http://127.0.0.1:8081','mshpit://artist/drake','invalid'])assert.equal(nativeNewsLinkFrame(url),null);
});
