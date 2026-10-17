import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source=readFileSync(new URL("./nativeReviewMode.js",import.meta.url),"utf8").replace(/\r\n/g,"\n").replace(/^import .*;\n/,'').replaceAll('export ','');
function policy(platform,development,flag){return new Function('Platform','__DEV__','process',source+';return reviewAllowsRequest;')({OS:platform},development,{env:{EXPO_PUBLIC_NATIVE_READ_ONLY_REVIEW:flag}});}
test('opted-in native development review blocks writes but permits owner login and reads',()=>{
 const allows=policy('android',true,'1');
 for(const path of ['/api/health','/api/artists/drake/profile'])assert.equal(allows(path,'GET'),true);
 assert.equal(allows('/api/login','POST'),true);assert.equal(allows('/api/logout','POST'),true);
 for(const path of ['/api/signup','/api/posts','/api/events/batch','/api/analytics/guest-search'])assert.equal(allows(path,'POST'),false);
 assert.equal(allows('/api/posts/1','DELETE'),false);
});
test('web, release and ordinary local development keep existing request behavior',()=>{
 for(const args of [['web',true,'1'],['android',false,'1'],['android',true,'0']])assert.equal(policy(...args)('/api/posts','POST'),true);
});

test('native review permits only the exact read-only feed revalidation POST, never nearby mutation routes',()=>{
 const allows=policy('android',true,'1');assert.equal(allows('/api/feed/revalidate','POST'),true);
 for(const [path,method] of [['/api/feed/revalidate/publish','POST'],['/api/feed/revalidate','PUT'],['/api/feed/revalidate','DELETE'],['/api/posts','POST'],['/api/posts/p_example/like','POST'],['/api/reports','POST'],['/api/me/blocked','POST'],['/api/me','DELETE']])assert.equal(allows(path,method),false,path+' '+method);
});
