import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const base = "/api/moderation/news-desk/editor";

test("source registry real HTTP enforces full admin, origin, identity and source-only persistence", { timeout: 120_000 }, async t => {
  const probe = createServer();
  await new Promise(done => probe.listen(0, "127.0.0.1", done));
  const port = probe.address().port;
  await new Promise(done => probe.close(done));
  const origin = `http://127.0.0.1:${port}`;
  const directory = mkdtempSync(join(tmpdir(), "pit-news-category-http-"));
  const environment = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA"]
    .filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(environment, { NODE_ENV: "test", RENDER: "true", PORT: String(port), PUBLIC_ORIGIN: origin,
    PIT_DATA_DIR: directory, PIT_NEWS_CATEGORY_FIXTURE: "1", PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "true",
    NEWS_DESK_ACCOUNT_ID: "category_publisher", MEDIA_PUBLIC_BASE_URL: "https://media.example.test",
    NEWS_DESK_ENABLED: "false", PIT_MEDIA_API_ENABLED: "false", BACKUP_ENABLED: "false", NEWSROOM_BROWSER_SESSIONS_ENABLED: "true",
    EMAIL_CAMPAIGN_RECOVERY_ENABLED: "false", CACHE_WARM_ENABLED: "false", TOURDATE_REFRESH_ENABLED: "false" });
  const child = fork(join(root, "server/index.js"), [], {
    cwd: root, env: environment,
    execArgv: ["--max-old-space-size=192", "--import", pathToFileURL(join(root, "scripts/fixtures/news-category-server-preload.mjs")).href],
    stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true,
  });
  let output = "", outbound = 0, fixture, address, exited = false;
  const pending = new Map();
  child.stdout.on("data", data => { output = (output + data).slice(-10_000); });
  child.stderr.on("data", data => { output = (output + data).slice(-10_000); });
  child.on("message", message => {
    if (message.kind === "fixture") fixture = message;
    if (message.kind === "listener-bound") address = message.address;
    if (message.kind === "outbound-blocked") outbound++;
    if (message.kind === "reply") pending.get(message.id)?.(message);
  });
  const exit = new Promise(done => child.once("exit", () => { exited = true; done(); }));
  t.after(async () => {
    if (!exited) child.kill();
    await exit;
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  });
  const deadline = Date.now() + 25_000;
  while (!fixture || !address) {
    if (exited || Date.now() > deadline) assert.fail(`Fixture server did not start: ${output}`);
    await new Promise(done => setTimeout(done, 25));
  }
  assert.equal(address, "127.0.0.1");
  let sequence = 0;
  const ipc = (operation, postId, value) => new Promise((done, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Fixture IPC timed out: ${operation}`)); }, 10_000);
    pending.set(id, message => { clearTimeout(timer); pending.delete(id); message.error ? reject(new Error(message.error)) : done(message.result); });
    child.send({ id, operation, postId, value });
  });
  const request = async (path, { user = fixture.users.editor, method = "PATCH", body } = {}) => {
    const response = await fetch(origin + path, { method, redirect: "error", signal: AbortSignal.timeout(15_000), headers: {
      Origin: origin, "Content-Type": "application/json",
      ...(user ? { Cookie: user.cookie, "X-Pit-Expected-Account": user.id } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json(), headers: response.headers };
  };
  const story = {
    headline: "Fixture artist releases a new studio album",
    summary: "The album arrives before a world tour, following the artist's earlier chart success.",
    body: "A past single topped the chart and won a Grammy award during a previous world tour. "
      + "The new album brings together the reported music and its documented creative context.",
    category: "release",
    sources: [
      { kind: "article", name: "NME", url: "https://www.nme.com/news/category-fixture" },
      { kind: "article", name: "Stereogum", url: "https://www.stereogum.com/category-fixture" },
      { kind: "article", name: "Pitchfork", url: "https://pitchfork.com/news/category-fixture" },
    ],
    photo: { assetId: "ma_category_photo", name: "Fixture photographer", url: "https://example.test/photo-rights" },
    idempotencyKey: "category-fixture-create-0001",
  };
  const saved = await request(`${base}/drafts/self-written`, { method: "POST", body: story });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.draft.category, "release");
  const published = await request(`${base}/drafts/${saved.data.draft.id}/publish`, { method: "POST", body: {} });
  assert.equal(published.status, 200, JSON.stringify(published.data));
  const postId = published.data.postId;
  const before = await ipc("snapshot",postId);
  const credit = {postId,kind:"video",name:"Synthetic clip creator",url:"https://www.youtube.com/watch?v=abcdefghijk",credit:"Synthetic clip credit",licence:"",edition:"",position:0};
  const path="/api/moderation/source-credits";
  for(const [user,status] of [[null,401],[fixture.users.fan,403],[fixture.users.editor,403],[fixture.users.revoked,409]]) {
    assert.equal((await request(path,{user,method:"PUT",body:credit})).status,status);
  }
  const raw = async headers => fetch(origin+path,{method:"PUT",headers:{"Content-Type":"application/json",Cookie:fixture.users.admin.cookie,"X-Pit-Expected-Account":fixture.users.admin.id,...headers},body:JSON.stringify(credit)});
  assert.equal((await raw({Origin:"https://foreign.example.com"})).status,403);
  assert.equal((await raw({Origin:"null"})).status,403);
  assert.equal((await raw({Origin:origin,"X-Pit-Expected-Account":fixture.users.fan.id})).status,409);
  const remembered=await ipc("source-newsroom-session");
  assert.equal((await request(path,{user:remembered,method:"PUT",body:credit})).status,409,"remembered Newsroom cookie cannot authorize admin mutation");
  assert.equal((await request(path,{user:remembered,method:"GET"})).status,409,"remembered Newsroom cookie cannot authorize admin read");
  const priorSources=await ipc("source-snapshot");
  await ipc("source-revoke-during-audit");
  assert.equal((await request(path,{user:fixture.users.admin,method:"PUT",body:credit})).status,401,"revocation during audit fails the precommit guard");
  await ipc("source-clear-trigger");
  assert.deepEqual(await ipc("source-snapshot"),priorSources,"credit and audit rolled back together");
  const creditSaved=await request(path,{user:fixture.users.admin,method:"PUT",body:credit});
  assert.equal(creditSaved.status,200,JSON.stringify(creditSaved.data));
  assert.equal((await request(path,{user:fixture.users.admin,method:"PUT",body:credit})).status,409,"exact repeated add is rejected");
  const updated=await request(path,{user:fixture.users.admin,method:"PUT",body:{...credit,id:creditSaved.data.source.id,revision:1,credit:"Revised synthetic clip credit"}});
  assert.equal(updated.status,200,JSON.stringify(updated.data));
  assert.equal((await request(path,{user:fixture.users.admin,method:"PUT",body:{...credit,id:creditSaved.data.source.id,revision:1}})).status,409);
  for(const url of ["javascript:alert(1)","https://www.nme.com/internal/secret","https://www.nme.com/%70rivate/secret","https://www.nme.com/clip?token=secret","https://www.youtube.com/watch?v=abcdefghijk&token=secret"]) assert.equal((await request(path,{user:fixture.users.admin,method:"PUT",body:{...credit,url}})).status,400);
  const directoryResponse=await fetch(origin+`/promotion-sources?post=${postId}`);assert.equal(directoryResponse.status,200);
  assert.match(await directoryResponse.text(),/Revised synthetic clip credit/);
  const after=await ipc("snapshot",postId);
  for(const field of ["story","post","media","comments","likes","article","html"]) assert.deepEqual(after[field],before[field],`${field} unchanged`);
  const edition={slug:"synthetic-http-edition",title:"Synthetic standalone edition",status:"draft",revision:0};
  const editionSaved=await request("/api/moderation/source-editions",{user:fixture.users.admin,method:"PUT",body:edition});
  assert.equal(editionSaved.status,200,JSON.stringify(editionSaved.data));
  assert.equal((await request(path,{user:fixture.users.admin,method:"PUT",body:{...credit,postId:"",edition:edition.slug}})).status,200);
  const publicRead=()=>request(`/api/source-credits?edition=${edition.slug}`,{user:null,method:"GET"});
  assert.equal((await publicRead()).data.editions.length,0);
  assert.equal((await request("/api/moderation/source-editions",{user:fixture.users.admin,method:"PUT",body:{...edition,status:"published",revision:1}})).status,200);
  assert.equal((await publicRead()).data.editions[0].credits.length,1);
  if(process.env.PIT_SOURCE_BROWSER==="1") {
    const {verifySourceRegistryBrowser}=await import("../../../scripts/verify-source-registry-browser.mjs");
    await verifySourceRegistryBrowser({origin,cookie:fixture.users.admin.cookie,postId});
  }
  assert.equal((await request("/api/moderation/source-editions",{user:fixture.users.admin,method:"PUT",body:{...edition,status:"withdrawn",revision:2}})).status,200);
  assert.equal((await publicRead()).data.editions.length,0);
  assert.equal(outbound,0);
});
