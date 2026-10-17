import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { parse } from '@babel/parser';
const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const nativeSource=readFileSync(new URL('../../node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/ReactAccessibilityDelegate.kt',import.meta.url),'utf8');
const roles=new Set(nativeSource.match(/enum class AccessibilityRole \{([\s\S]+?);/)[1].match(/\b[A-Z][A-Z]+\b/g).map(v=>v.toLowerCase()));
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):/\.(jsx|js|tsx)$/.test(e.name)&&!e.name.includes('.web.')&&!e.name.includes('.test.')?[join(dir,e.name)]:[])}
function attributes(file){const result=[],ast=parse(readFileSync(file,'utf8'),{sourceType:'module',plugins:['jsx','typescript']});const visit=n=>{if(!n||typeof n!=='object')return;if(n.type==='JSXAttribute'&&n.name?.name==='accessibilityRole')result.push(n);for(const v of Object.values(n))if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v)};visit(ast);return result}
test('static accessibilityRole values in shared/mobile JSX are supported by the installed Android runtime',()=>{
 const invalid=[];for(const f of files(sourceRoot))for(const n of attributes(f))if(n.value?.type==='StringLiteral'&&!roles.has(n.value.value.toLowerCase()))invalid.push(`${relative(sourceRoot,f)}:${n.loc.start.line} ${n.value.value}`);
 assert.deepEqual(invalid,[], 'Android throws when a shared View receives an unsupported accessibility role');
});
test('composer/admin announcements retain web semantics while native children remain readable',()=>{
 for(const file of ['screens/LogScreen.jsx','features/artistAccess/ArtistAccessPanel.jsx','features/jobs/JobsPanel.jsx']){
  const roles=attributes(join(sourceRoot,file)).map(n=>n.value?.expression).filter(e=>e?.type==='ConditionalExpression'&&['status','note'].includes(e.consequent?.value));
  assert.ok(roles.length,file+' must retain its web announcement role');
  for(const e of roles){assert.equal(e.alternate.type,'Identifier');assert.equal(e.alternate.name,'undefined');assert.equal(e.test.operator,'===');assert.equal(e.test.right.value,'web');assert.equal(e.test.left.object.name,'Platform');assert.equal(e.test.left.property.name,'OS')}
 }
});
