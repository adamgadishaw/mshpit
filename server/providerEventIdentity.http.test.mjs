import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

test("real event redirects are temporary and uncached, and withdrawal restores the active URL", { timeout: 45_000 }, async (t) => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const directory = mkdtempSync(join(tmpdir(), "pit-provider-identity-http-"));
  const preload = join(directory, "preload.mjs");
  writeFileSync(preload, `
    import fs from 'node:fs'; import http from 'node:http'; import https from 'node:https';
    import net from 'node:net'; import tls from 'node:tls'; import { syncBuiltinESMExports } from 'node:module';
    const deny=()=>{throw new Error('Fixture denies outbound networking')};
    globalThis.fetch=async()=>deny(); http.request=deny; http.get=deny; https.request=deny; https.get=deny;
    net.connect=deny; net.createConnection=deny; tls.connect=deny; net.Socket.prototype.connect=deny;
    const shell=${JSON.stringify(join(root, "dist", "index.html"))};
    const exists=fs.existsSync, read=fs.readFileSync;
    fs.existsSync=(path)=>String(path)===shell || String(path)===${JSON.stringify(join(root, "dist"))} || exists(path);
    fs.readFileSync=(path,...args)=>String(path)===shell ? '<html><head><title>Fixture</title></head><body><div id="root"></div></body></html>' : read(path,...args);
    const listen=net.Server.prototype.listen;
    net.Server.prototype.listen=function(){
      this.once('listening',()=>process.send({kind:'listening',port:this.address().port}));
      return listen.call(this,{port:0,host:'127.0.0.1'});
    };
    syncBuiltinESMExports();
    const {db}=await import(${JSON.stringify(pathToFileURL(join(root, "server", "db.js")).href)});
    for(const id of ['http-provider-a','http-provider-z']) db.prepare(
      "INSERT INTO tour_dates(id,artist,venue,place,date,source,ticket_url,event_name,event_status,start_date_time,start_local_time,venue_city,venue_country_code,venue_address_line1,music_evidence,billed_artists,updated_at) VALUES (?,'HTTP Band','HTTP Hall','Toronto, Canada','2036-06-14','ticketmaster','https://www.ticketmaster.ca/event/http-sale','HTTP Band','onsale','2036-06-14T20:00:00Z','20:00:00','Toronto','CA','1 Test Street','provider:music',?,1)"
    ).run(id,JSON.stringify(['HTTP Band']));
    process.on('message',message=>{if(message.kind==='withdraw'){
      db.prepare("UPDATE tour_dates SET provider_active=0 WHERE id='http-provider-a'").run();
      process.send({kind:'withdrawn'});
    }});
  `);
  const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA"]
    .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  Object.assign(env, { NODE_ENV: "test", PORT: "0", PUBLIC_ORIGIN: "https://www.example.com", PIT_DATA_DIR: directory,
    ADMIN_PASSWORD: "synthetic-unused-fixture-password",
    PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "true", ERROR_ALERTS_ENABLED: "false", NEWS_DESK_ENABLED: "false",
    PIT_MEDIA_API_ENABLED: "false", BACKUP_ENABLED: "false", EMAIL_CAMPAIGN_RECOVERY_ENABLED: "false",
    CACHE_WARM_ENABLED: "false", TOURDATE_REFRESH_ENABLED: "false" });
  const child = fork(join(root, "server/index.js"), [], { cwd: root, env,
    execArgv: ["--max-old-space-size=192", "--import", pathToFileURL(preload).href],
    stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  let output = "";
  child.stdout.on("data", (data) => { output = (output + data).slice(-8_000); });
  child.stderr.on("data", (data) => { output = (output + data).slice(-8_000); });
  t.after(async () => {
    if (child.exitCode == null) { const closed = new Promise((done) => child.once("close", done)); child.kill(); await closed; }
    rmSync(directory, { recursive: true, force: true });
  });
  const message = (kind) => new Promise((done, reject) => {
    const onMessage = (value) => { if (value.kind === kind) { cleanup(); done(value); } };
    const onExit = () => { cleanup(); reject(new Error(output)); };
    const cleanup = () => { child.off("message", onMessage); child.off("exit", onExit); };
    child.on("message", onMessage); child.once("exit", onExit);
  });
  const { port } = await message("listening");
  const url = `http://127.0.0.1:${port}/event/http-provider-z`;
  let redirect;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    redirect = await fetch(url, { redirect: "manual" });
    if (redirect.status !== 503) break;
    await redirect.text();
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.equal(redirect.status, 302, output);
  assert.equal(redirect.headers.get("location"), "/event/http-provider-a");
  assert.equal(redirect.headers.get("cache-control"), "no-store");
  const withdrawn = message("withdrawn"); child.send({ kind: "withdraw" }); await withdrawn;
  const restored = await fetch(url, { redirect: "manual" });
  assert.equal(restored.status, 200);
  assert.match(await restored.text(), /http-provider-z/u);
});
