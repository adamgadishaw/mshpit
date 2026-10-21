import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
test('actual HTTP isolates remembered Newsroom authority, own articles, photos and revocation',{timeout:60000},()=>{
 const result=spawnSync(process.execPath,['scripts/verify-newsroom-session-http.mjs'],{cwd:root,encoding:'utf8',timeout:55000,windowsHide:true});
 assert.equal(result.status,0,result.stderr||result.stdout);assert.match(result.stdout,/"passed":34,"failed":0/);
});
