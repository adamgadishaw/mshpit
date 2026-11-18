import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
test('actual HTTP isolates remembered Newsroom authority, own articles, photos and revocation',{timeout:60000},()=>{
 const result=spawnSync(process.execPath,['scripts/verify-newsroom-session-http.mjs'],{cwd:root,encoding:'utf8',timeout:55000,windowsHide:true});
 assert.equal(result.status,0,result.stderr||result.stdout);assert.match(result.stdout,/"passed":39,"failed":0/);
 const checks=result.stdout.split(/\r?\n/u).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
 assert.equal(checks.filter(check=>check.passed===true).length,39);
 for(const name of [
  'full sign-in in another tab revokes the previous Newsroom credential',
  'shared full sign-in is discoverable but cannot substitute for Newsroom enablement',
  'explicit fresh-password reenablement survives repeated confirmations'
 ])assert.ok(checks.some(check=>check.name===name&&check.passed===true),'Missing successful check: '+name);
});
