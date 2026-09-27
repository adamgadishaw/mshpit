import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ensureMemberBadgeSchema, grantFirstWaveBadge, memberBadgeFor, FIRST_WAVE_LIMIT } from "./memberBadges.js";

const at = 2000000;
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,handle TEXT,pass_hash TEXT,role TEXT DEFAULT 'fan',
      email_verified_at INTEGER DEFAULT 1,onboarding_version INTEGER,created_at INTEGER,
      is_banned INTEGER DEFAULT 0,dormant_at INTEGER,suspended_until INTEGER,verified INTEGER DEFAULT 0);
    CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE artist_profiles(owner_id TEXT,identity_review_status TEXT);
    CREATE TABLE posts(id TEXT PRIMARY KEY,user_id TEXT);
    CREATE TABLE news_stories(post_id TEXT);`);
  const add = (id,over={}) => {
    db.prepare(`INSERT INTO users(id,email,handle,pass_hash,role,email_verified_at,onboarding_version,created_at,is_banned,dormant_at,suspended_until)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id,over.email||`${id}@realmail.com`,over.handle||id,over.password||"scrypt:fixture:fixture",
      over.role||"fan",over.confirmed??1,over.onboarding??null,over.created??100,over.banned??0,over.dormant??null,over.suspended??null);
    return db.prepare("SELECT * FROM users WHERE id=?").get(id);
  };
  return { db,add };
}

test("backfill is bounded, deterministic and recorded once; grants never change role or identity verification", () => {
  const {db,add} = fixture();
  try {
    add("later",{created:200}); add("b",{created:100}); add("a",{created:100,role:"artist"});
    assert.equal(ensureMemberBadgeSchema(db,{at,env:{}}),3);
    assert.deepEqual(db.prepare("SELECT slot,user_id FROM first_wave_grants ORDER BY slot").all().map(r=>[r.slot,r.user_id]),[[1,"a"],[2,"b"],[3,"later"]]);
    add("new");
    assert.equal(ensureMemberBadgeSchema(db,{at,env:{}}),0,"restart must not consume places from a read/startup repeatedly");
    assert.equal(grantFirstWaveBadge(db,"a",{at,env:{}}),1);
    assert.equal(grantFirstWaveBadge(db,"new",{at,env:{}}),4);
    assert.deepEqual(db.prepare("SELECT role,verified FROM users WHERE id='a'").get(),Object.assign(Object.create(null),{role:"artist",verified:0}));
  } finally {db.close();}
});

test("unconfirmed, incomplete, service, demo, dormant, restricted and held identities cannot consume places", () => {
  const {db,add} = fixture();
  try {
    add("unconfirmed",{confirmed:0}); add("incomplete",{onboarding:0}); add("banned",{banned:1});
    add("dormant",{dormant:100}); add("suspended",{suspended:at+1}); add("demo",{email:"demo@example.com"});
    add("placeholder",{password:"disabled"}); add("publisher",{handle:"news_mod"}); add("configured"); add("historic"); add("held",{role:"artist"});
    db.exec("INSERT INTO posts VALUES ('news_1','historic'); INSERT INTO news_stories VALUES ('news_1'); INSERT INTO artist_profiles VALUES ('held','pending')");
    assert.equal(ensureMemberBadgeSchema(db,{at,env:{NEWS_DESK_ACCOUNT_ID:"configured"}}),0);
    for (const row of db.prepare("SELECT * FROM users").all()) {
      assert.equal(grantFirstWaveBadge(db,row.id,{at,env:{NEWS_DESK_ACCOUNT_ID:"configured"}}),null,row.id);
      assert.equal(memberBadgeFor(db,row,{at,env:{NEWS_DESK_ACCOUNT_ID:"configured"}}),null,row.id);
    }
    db.exec("UPDATE users SET onboarding_version=1 WHERE id='incomplete'");
    assert.equal(grantFirstWaveBadge(db,"incomplete",{at,env:{}}),1);
  } finally {db.close();}
});

test("a bound publisher remains ineligible after a handle rename", () => {
  const {db,add} = fixture();
  try {
    add("service"); db.prepare("INSERT INTO app_meta VALUES (?,?)").run("news-desk:publisher-identity:v1",JSON.stringify({userId:"service"}));
    assert.equal(ensureMemberBadgeSchema(db,{at,env:{}}),0);
    assert.equal(grantFirstWaveBadge(db,"service",{at,env:{}}),null);
  } finally {db.close();}
});

test("exactly 1000 lifetime places; deletion erases linkage without recycling or transferring a place", () => {
  const {db,add} = fixture();
  try {
    db.exec("BEGIN"); for(let i=0;i<FIRST_WAVE_LIMIT+2;i++) add(`member${String(i).padStart(4,"0")}`,{created:i+1}); db.exec("COMMIT");
    assert.equal(ensureMemberBadgeSchema(db,{at,env:{}}),1000);
    const next = db.prepare("SELECT * FROM users WHERE id='member1000'").get();
    assert.equal(grantFirstWaveBadge(db,next.id,{at,env:{}}),null);
    assert.equal(memberBadgeFor(db,next,{at,env:{}}),"email-confirmed");
    db.exec("DELETE FROM users WHERE id='member0000'");
    assert.equal(db.prepare("SELECT user_id FROM first_wave_grants WHERE slot=1").get().user_id,null);
    assert.equal(grantFirstWaveBadge(db,next.id,{at,env:{}}),null);
    assert.throws(()=>db.exec("DELETE FROM first_wave_grants WHERE slot=1"),/recycled/);
    assert.throws(()=>db.exec("UPDATE first_wave_grants SET user_id='member1000' WHERE slot=1"),/transferred/);
    assert.throws(()=>db.exec(`INSERT INTO first_wave_grants VALUES (1001,'member1001',${at})`),/CHECK/);
    assert.equal(db.prepare("SELECT count(*) AS n FROM first_wave_grants").get().n,1000);
  } finally {db.close();}
});

test("grant rolls back with surrounding verification and projection never grants on a read", () => {
  const {db,add} = fixture();
  try {
    ensureMemberBadgeSchema(db,{at,env:{}}); const user=add("new");
    assert.equal(memberBadgeFor(db,user,{at,env:{}}),"email-confirmed");
    assert.equal(db.prepare("SELECT count(*) AS n FROM first_wave_grants").get().n,0);
    db.exec("BEGIN IMMEDIATE"); assert.equal(grantFirstWaveBadge(db,user.id,{at,env:{}}),1); db.exec("ROLLBACK");
    assert.equal(db.prepare("SELECT count(*) AS n FROM first_wave_grants").get().n,0);
    assert.equal(grantFirstWaveBadge(db,user.id,{at,env:{}}),1);
    assert.equal(memberBadgeFor(db,user,{at,env:{}}),"first-wave");
    db.exec("UPDATE users SET email_verified_at=0 WHERE id='new'");
    assert.equal(memberBadgeFor(db,user,{at,env:{}}),null,"fresh server state defeats a stale snapshot");
    assert.equal(memberBadgeFor(db,{id:user.id,membershipBadge:"first-wave",verified:true},{at,env:{}}),null);
  } finally {db.close();}
});
