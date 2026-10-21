// Explicit local-test preload; never imported by production application code.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";

const directory = resolve(process.env.PIT_DATA_DIR || ".");
assert.equal(process.env.PIT_AUTH_BROWSER_FIXTURE, "1");
assert.equal(dirname(directory), resolve(tmpdir()));
assert.ok(basename(directory).startsWith("pit-auth-real-browser-"));
assert.equal(process.env.NODE_ENV, "test");
assert.equal(typeof process.send, "function", "Fixture metadata uses parent-only IPC, never logs or HTTP.");

// Block provider traffic before importing any server module. The actual HTTP
// listener, routing, body/security boundary and database remain unmodified.
const denied = () => { process.send?.({ kind: "outbound-blocked" }); throw new Error("Fixture outbound network disabled"); };
globalThis.fetch = async () => denied();
http.request = denied; http.get = denied; https.request = denied; https.get = denied;
net.connect = denied; net.createConnection = denied; tls.connect = denied;
net.Socket.prototype.connect = denied;
// The deploy listener normally binds all interfaces. Restrict only its test
// socket address so synthetic credentials are never reachable over the LAN.
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function fixtureListen(port) {
  assert.equal(arguments.length, 1);
  assert.equal(port, Number(process.env.PORT));
  this.once("listening", () => process.send?.({ kind: "listener-bound", address: this.address().address }));
  return listen.call(this, { port, host: "127.0.0.1" });
};
syncBuiltinESMExports();



assert.equal(process.env.PIT_NEWSROOM_BROWSER_FIXTURE, '1');
const realNow=Date.now;let offset=0;Date.now=()=>realNow()+offset;
const {db,q}=await import('../../server/db.js');
const {createSession,hashPassword,COOKIE}=await import('../../server/auth.js');
const {createNewsDeskEditor}=await import('../../server/features/newsDesk/newsDeskEditor.js');
const {seedNewsroomPhoto}=await import('../../server/features/newsroomSessions/newsroomSessionFixtures.mjs');
await import('../../server/api.js');
const password='Synthetic-newsroom-HTTP-pass1',users={};
for(const [name,role] of [['owner','admin'],['peer','editor'],['publisher','moderator'],['fan','fan']]){
 const id='newsroom_http_'+name;
 q.insertUser.run(id,id+'@example.test',id,id,hashPassword(password),role,'Toronto',null,null,'NH','#123456',Date.now());
 db.prepare("UPDATE users SET email_verified_at=?,age_band='18_plus',onboarding_version=1 WHERE id=?").run(Date.now(),id);
 users[name]={id,email:id+'@example.test',cookie:COOKIE+'='+createSession(id).token};
}
const photos={owner:seedNewsroomPhoto(db,users.owner.id,'owner'),peer:seedNewsroomPhoto(db,users.peer.id,'peer')};
const editor=createNewsDeskEditor({database:db,summarize:null,env:process.env});
const payload={headline:'Radiohead announce new world tour dates',summary:'Radiohead have announced a new world tour with confirmed concert dates.',body:'The band announced the tour on its official website.',category:'tour',sources:[{kind:'article',name:'Radiohead',url:'https://radiohead.com/news/tour'}],photo:{assetId:photos.peer.assetId,source:{name:'Fixture photographer',url:'https://example.test/photo-rights'}}};
const foreign=editor.writeSelfWritten({...payload,actorId:users.peer.id,actorType:'newsroom_browser',actorLabel:'Fixture'});
const ordinary=editor.writeSelfWritten({...payload,actorId:users.owner.id,photo:{assetId:photos.owner.assetId,source:{name:'Fixture photographer',url:'https://example.test/photo-rights'}}});
process.on('message',message=>{
 try{
 let result;
 if(message.operation==='advance'){offset=message.hours*3600000;result=true;}
 else if(message.operation==='restore-role'){db.prepare("UPDATE users SET role='admin' WHERE id=?").run(users.owner.id);result=true;}
 else if(message.operation==='role-loss'){db.prepare("UPDATE users SET role='fan' WHERE id=?").run(users.owner.id);result=true;}
 else if(message.operation==='snapshot')result={paid:db.prepare('SELECT count(*) n FROM news_desk_receipts').get().n,scoped:db.prepare("SELECT count(*) n FROM newsroom_browser_sessions").get().n};
 else throw Error('Unknown fixture operation');
 process.send({kind:'reply',id:message.id,result});
 }catch(error){process.send({kind:'reply',id:message.id,error:error.message});}
});
process.send({kind:'fixture',password,users,photos,foreignDraft:foreign.id,ordinaryDraft:ordinary.id});
