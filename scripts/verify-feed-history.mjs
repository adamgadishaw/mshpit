// Synthetic, temporary SQLite only. Never starts an HTTP server or provider job.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

process.env.NODE_ENV = "test";
process.env.PIT_ENV = "production";
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "false";
delete process.env.RENDER;
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
const directory = mkdtempSync(join(tmpdir(), "pit-large-feed-"));
process.env.PIT_DATA_DIR = directory;
const { db, q } = await import("../server/db.js");
const { routes } = await import("../server/api.js");
const { clearRecommendationSnapshotsForTests } = await import("../server/recommendationService.js");
const started = performance.now();
const at = Date.now() - 100_000;
const sameAuthor = process.argv[3] === "same-author";
const sizes = { localFollow: sameAuthor ? 2505 : 1250, localOther: sameAuthor ? 0 : 350,
  remoteFollow: sameAuthor ? 0 : 605, remoteOther: sameAuthor ? 0 : 300,
  blocked: 37, muted: 29, removed: 23, banned: 19, suspended: 17, dormant: 13 };
const expected = { "for-you": new Set(), local: new Set(), following: new Set() };
const report = { dataset: sizes, distribution: sameAuthor ? "single-author" : "four-authors-two-cities",
  pageSize: 50, sections: {}, checks: {}, runtime: process.version };
try {
  const addUser = (id, city) => {
    q.insertUser.run(id, `${id}@example.test`, id, id, "hash", "fan", city, null, null, "LH", "#123456", at);
    return q.userById.get(id);
  };
  const viewer = addUser("large_viewer", "Toronto");
  const insert = db.prepare("INSERT INTO posts(id,user_id,artist,venue,overall,created_at,removed) VALUES(?,?,?,'Fixture Venue',4,?,?)");
  db.exec("BEGIN");
  for (const [group, count] of Object.entries(sizes)) {
    const author = addUser(`large_${group}`, group.startsWith("remote") ? "Montreal" : "Toronto");
    if (group.endsWith("Follow") || !["localOther", "remoteOther"].includes(group)) {
      db.prepare("INSERT INTO follows(follower_id,followee_id) VALUES(?,?)").run(viewer.id, author.id);
    }
    if (group === "blocked") db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)").run(author.id, viewer.id, at);
    if (group === "muted") db.prepare("INSERT INTO account_mutes(muter_id,muted_id,created_at) VALUES(?,?,?)").run(viewer.id, author.id, at);
    if (group === "banned") db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(author.id);
    if (group === "suspended") db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now()+3600_000, author.id);
    if (group === "dormant") db.prepare("UPDATE users SET dormant_at=? WHERE id=?").run(at, author.id);
    for (let index=0; index<count; index++) {
      const id=`p_large_${group}_${String(index).padStart(5,"0")}`;
      // Repeated timestamps exercise the unique tie-breaker on every page.
      insert.run(id, author.id, "Synthetic Artist", at-Math.floor(index/3), group === "removed" ? 1 : 0);
      if (!["localFollow","localOther","remoteFollow","remoteOther"].includes(group)) continue;
      expected["for-you"].add(id);
      if (group.startsWith("local")) expected.local.add(id);
      if (group.endsWith("Follow")) expected.following.add(id);
    }
  }
  db.exec("COMMIT");
  report.seedMs = performance.now()-started;
  const read = (section, cursor=null) => {
    const route = section === "for-you" ? "GET /api/feed/for-you" : "GET /api/feed";
    return routes[route]({user:q.userById.get(viewer.id),ip:"synthetic-large-history",query:{limit:"50",
      ...(section === "for-you" ? {} : {mode:section}),
      ...(cursor ? {[section === "for-you" ? "cursor" : "before"]:cursor} : {})}});
  };
  for (const section of Object.keys(expected)) {
    clearRecommendationSnapshotsForTests();
    const seen=new Set(), cursors=new Set(), timings=[];
    let cursor=null, firstCursor=null, firstNextIds=null, previous=null, refreshId=null, refreshAuthor=null, snapshotAt=null;
    do {
      assert.ok(performance.now()-started < 240_000, "synthetic traversal exceeded its four-minute bounded work budget");
      const before=performance.now();
      const page=read(section,cursor);
      timings.push(performance.now()-before);
      if(section==="for-you") {
        if(snapshotAt===null) snapshotAt=page.algorithm.snapshotAt;
        assert.equal(page.algorithm.snapshotAt,snapshotAt,"ranking snapshot cannot change during traversal");
      }
      const chronological=section!=="for-you" || (cursor && JSON.parse(Buffer.from(cursor,"base64url").toString("utf8")).before != null);
      assert.ok(page.posts.length>0 || !page.nextCursor,"empty page cannot falsely advertise more eligible rows");
      for(const post of page.posts) {
        assert.ok(expected[section].has(post.id),`${section}: ineligible ${post.id}`);
        assert.ok(!seen.has(post.id),`${section}: duplicate ${post.id}`);
        seen.add(post.id);
        if(chronological && previous) {
          const timestamp=section==="following" ? post.followingActivityAt : post.createdAt;
          assert.ok(previous.at>timestamp || (previous.at===timestamp && previous.id>post.id),"stable tuple ordering");
        }
        previous={id:post.id,at:section==="following" ? post.followingActivityAt : post.createdAt};
      }
      if(timings.length===1) {
        firstCursor=page.nextCursor;
        refreshAuthor=addUser(`large_refresh_${section}`,"Toronto");
        db.prepare("INSERT INTO follows(follower_id,followee_id) VALUES(?,?)").run(viewer.id,refreshAuthor.id);
        refreshId=`p_large_refresh_${section}`;
        insert.run(refreshId,refreshAuthor.id,"Synthetic Artist",Date.now()+1,0);
      }
      if(timings.length===2) firstNextIds=page.posts.map(post=>post.id);
      cursor=page.nextCursor;
      if(cursor) {assert.ok(!cursors.has(cursor),"cursor must advance");cursors.add(cursor);}
      assert.ok(timings.length<=100,"bounded page count");
      console.log(JSON.stringify({section,pages:timings.length,seen:seen.size,lastPageMs:timings.at(-1)}));
    } while(cursor);
    assert.deepEqual(seen,expected[section],`${section}: complete eligible coverage; no false exhaustion`);
    assert.deepEqual(read(section,firstCursor).posts.map(post=>post.id),firstNextIds,"replaying a cursor is stable");
    assert.ok(!seen.has(refreshId),"new head arrival cannot enter an existing cursor traversal");
    assert.ok(read(section).posts.some(post=>post.id===refreshId),"explicit refresh exposes new eligible head arrival");
    db.prepare("DELETE FROM users WHERE id=?").run(refreshAuthor.id);
    const sorted=[...timings].sort((a,b)=>a-b);
    report.sections[section]={eligible:expected[section].size,received:seen.size,pages:timings.length,
      totalPageMs:timings.reduce((a,b)=>a+b,0),firstPageMs:timings[0],medianPageMs:sorted[Math.floor(sorted.length/2)],
      p95PageMs:sorted[Math.ceil(sorted.length*.95)-1],maxPageMs:sorted.at(-1),pageMs:timings};
  }
  report.checks={completeCoverage:true,noDuplicates:true,noFalseExhaustion:true,stableCursorReplay:true,tupleOrdering:true,
    eligibilityExclusions:["blocked-by-author","muted","removed","banned","suspended","dormant"],
    newHeadIsolation:true,explicitRefreshSeesNewArrival:true,immutableRankingSnapshot:true,forYouTailTupleOrdering:true,
    refreshIsolation:"server head isolation here plus separate deferred client refresh/account tests; no production HTTP/network timing claimed"};
  report.elapsedMs=performance.now()-started;
  if(process.argv[2]) writeFileSync(resolve(process.argv[2]),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({passed:true,...report,sections:Object.fromEntries(Object.entries(report.sections).map(([key,{pageMs,...value}])=>[key,value]))}));
} finally {
  db.close();
  rmSync(directory,{recursive:true,force:true});
}
