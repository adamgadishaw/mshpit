import { randomUUID } from "node:crypto";
import { activeAccountSql } from "../../accountVisibility.js";
import { withImmediateWrite } from "../../databaseTransaction.js";
import { canonicalManualCitationUrl } from "./newsEditorialSources.js";
import { ApiError } from "../../errors.js";
import { assertSafeAuthoredText } from "../../contentSafety.js";

export const sourceKinds = ["reporting", "photographs", "video", "music", "data"];
export function registryUrl(value) {
  const url = canonicalManualCitationUrl(value);
  // Public attribution never stores credentials, query tokens or signed URLs.
  if (!url) return null;
  const parsed=new URL(url);
  let pathname;
  try { pathname=decodeURIComponent(parsed.pathname); } catch { return null; }
  if (/(?:^|\/)(?:private|internal|evidence|admin|drafts?)(?:\/|$)/iu.test(pathname)) return null;
  const youtube = ["www.youtube.com","youtube.com"].includes(parsed.hostname) && parsed.pathname==="/watch"
    && [...parsed.searchParams.keys()].length===1 && /^[A-Za-z0-9_-]{11}$/u.test(parsed.searchParams.get("v") || "");
  return !parsed.search || youtube ? url : null;
}
export function ensureSourceRegistrySchema(db) {
  // Additive schema v1. Older application versions can ignore these tables.
  return withImmediateWrite(db, () => db.exec(`CREATE TABLE IF NOT EXISTS news_source_editions (
    slug TEXT PRIMARY KEY,title TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('draft','published','withdrawn')),
    revision INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL
  ); CREATE TABLE IF NOT EXISTS news_source_credits (
    id TEXT PRIMARY KEY, post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('reporting','photographs','video','music','data')),
    name TEXT NOT NULL, url TEXT NOT NULL, credit TEXT NOT NULL DEFAULT '',
    licence TEXT NOT NULL DEFAULT '', edition TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1,
    CHECK(post_id IS NOT NULL OR edition<>'')
  ); CREATE INDEX IF NOT EXISTS idx_news_source_credits_post ON news_source_credits(post_id,position,id);
  CREATE INDEX IF NOT EXISTS idx_news_source_credits_edition ON news_source_credits(edition,post_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_news_source_credit_identity ON news_source_credits(COALESCE(post_id,''),edition,kind,url,name,credit,licence);`));
}
const publicStories = `FROM news_stories s JOIN posts p ON p.id=s.post_id JOIN users u ON u.id=p.user_id
 WHERE s.status='published' AND p.removed=0 AND p.kind='status' AND ${activeAccountSql("u")}
 AND u.profile_audience='everyone'`;
export function sourceRegistry(db) {
  const isPublished = postId => db.prepare(`SELECT s.post_id ${publicStories} AND s.post_id=?`).get(postId);
  function list({ q = "", post = "", edition = "", kind = "", page = 1 } = {}, { staff = false } = {}) {
    q = String(q).trim().slice(0, 160); post = String(post).slice(0, 100); edition = String(edition).slice(0, 80);
    page = Math.max(1, Math.min(10000, Math.trunc(Number(page)) || 1));
    const pattern = `%${q.replace(/[\\%_]/gu, "\\$&")}%`;
    kind=sourceKinds.includes(kind)?kind:"";
    const params = [post, post, edition, edition, Number(staff), q, pattern, pattern, Number(staff), pattern,kind,kind,Number(staff),kind];
    const where = ` AND (?='' OR s.post_id=?) AND (?='' OR EXISTS(SELECT 1 FROM news_source_credits c JOIN news_source_editions e ON e.slug=c.edition WHERE c.post_id=s.post_id AND c.edition=? AND (? OR e.status='published')))
      AND (?='' OR s.headline LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM news_source_credits c WHERE c.post_id=s.post_id AND c.name LIKE ? ESCAPE '\\'
        AND (? OR c.edition='' OR EXISTS(SELECT 1 FROM news_source_editions e WHERE e.slug=c.edition AND e.status='published')))
      OR EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(s.sources) THEN s.sources ELSE '[]' END) j WHERE json_extract(CASE WHEN j.type='object' THEN j.value ELSE '{}' END,'$.name') LIKE ? ESCAPE '\\'))
      AND (?='' OR EXISTS(SELECT 1 FROM news_source_credits c WHERE c.post_id=s.post_id AND c.kind=? AND (? OR c.edition='' OR EXISTS(SELECT 1 FROM news_source_editions e WHERE e.slug=c.edition AND e.status='published')))
      OR EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(s.sources) THEN s.sources ELSE '[]' END) j WHERE CASE json_extract(CASE WHEN j.type='object' THEN j.value ELSE '{}' END,'$.kind') WHEN 'photo' THEN 'photographs' ELSE 'reporting' END=?))`;
    const rows = db.prepare(`SELECT s.post_id,s.headline,s.sources ${publicStories} ${where}
      ORDER BY s.created_at DESC,s.id DESC LIMIT 21 OFFSET ?`).all(...params, (page - 1) * 20);
    const hasMore = rows.length > 20;
    const articles = rows.slice(0,20).map(row => {
      let historical;
      try { historical = JSON.parse(row.sources); } catch { historical = []; }
      if (!Array.isArray(historical)) historical = [];
      const stored = db.prepare(`SELECT * FROM news_source_credits WHERE post_id=? AND (?='' OR edition=?) AND (? OR edition='' OR EXISTS(SELECT 1 FROM news_source_editions e WHERE e.slug=edition AND e.status='published')) ORDER BY position,id LIMIT 100`).all(row.post_id,edition,edition,Number(staff));
      const credits = stored.map(c => ({ ...c, provenance: "registry" }));
      const identity = c => JSON.stringify([c.kind,c.url,c.name,c.credit || "",c.licence || ""]);
      const seen = new Map(credits.map(c=>[identity(c),c]));
      for (const source of historical.slice(0,100)) {
        const url = registryUrl(source?.url);
        if (!url || ![undefined,"article","photo"].includes(source.kind)) continue;
        const sourceKind = source.kind === "photo" ? "photographs" : "reporting";
        const projected={ kind: sourceKind, url, name: String(source.name || new URL(url).hostname).slice(0,200),
          credit: String(source.credit || "").slice(0,1000), licence: "", provenance: "published article" };
        const key=identity(projected);
        if(seen.has(key)) { if(seen.get(key).id) seen.get(key).provenance="published article + registry";continue; }
        seen.set(key,projected);credits.push(projected);
      }
      return { postId: row.post_id, headline: row.headline, credits: credits.filter(c => !kind || c.kind === kind) };
    });
    const editions = !post ? db.prepare(`SELECT * FROM news_source_editions WHERE (? OR status='published') AND (?='' OR slug=?)
      AND (?='' OR title LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM news_source_credits c WHERE c.post_id IS NULL AND c.edition=slug AND c.name LIKE ? ESCAPE '\\'))
      AND (?='' OR EXISTS(SELECT 1 FROM news_source_credits c WHERE c.post_id IS NULL AND c.edition=slug AND c.kind=?)) ORDER BY created_at DESC,slug LIMIT 21 OFFSET ?`)
      .all(Number(staff),edition,edition,q,pattern,pattern,pattern,kind,kind,(page-1)*20).map(e => ({...e,credits:db.prepare("SELECT * FROM news_source_credits WHERE post_id IS NULL AND edition=? ORDER BY position,id LIMIT 100").all(e.slug).filter(c=>!kind || c.kind===kind)})) : [];
    return { articles, editions:editions.slice(0,20), hasMore:hasMore || editions.length>20, page, q, post, edition, kind };
  }
  function save(input, authorize, audit) {
    const allowed = ["id","postId","kind","name","url","credit","licence","edition","position","revision"];
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(k => !allowed.includes(k))) throw new ApiError(400,"Check the source fields.","VALIDATION_FAILED");
    const text = (key, max, required = false) => {
      const value = input[key] ?? "";
      if (typeof value !== "string" || value.length > max || (required && !value.trim()) || /[\u0000-\u001f\u007f]/u.test(value)) throw new ApiError(400,`Check ${key}.`,"VALIDATION_FAILED");
      assertSafeAuthoredText(value, { field: key }); return value.trim();
    };
    const postId = text("postId",100), name = text("name",200,true), credit = text("credit",1000), licence = text("licence",1000), edition = text("edition",80);
    const url = registryUrl(input.url);
    if ((input.id !== undefined && (typeof input.id!=="string" || !input.id || input.id.length>100 || !Number.isSafeInteger(input.revision) || input.revision<1))) throw new ApiError(400,"Reload the source before editing.","VALIDATION_FAILED");
    if (!url || !sourceKinds.includes(input.kind) || (edition && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(edition)) || !Number.isInteger(input.position) || Math.abs(input.position)>10000) throw new ApiError(400,"Use a public HTTPS source link without query parameters, a source kind and a valid edition slug/order.","VALIDATION_FAILED");
    return withImmediateWrite(db, () => {
      authorize();
      if (postId && !isPublished(postId)) throw new ApiError(404,"Choose an available public article.","NOT_FOUND");
      if ((!postId && !edition) || (edition && !db.prepare("SELECT slug FROM news_source_editions WHERE slug=?").get(edition))) throw new ApiError(404,"Create or choose an edition first.","NOT_FOUND");
      const prior = input.id ? db.prepare("SELECT * FROM news_source_credits WHERE id=? AND COALESCE(post_id,'')=?").get(input.id,postId) : null;
      if (input.id && !prior) throw new ApiError(404,"Source unavailable.","NOT_FOUND");
      if (prior && prior.revision !== input.revision) throw new ApiError(409,"This credit changed. Reload before editing.","CONFLICT");
      const duplicate = db.prepare("SELECT id FROM news_source_credits WHERE COALESCE(post_id,'')=? AND edition=? AND kind=? AND url=? AND name=? AND credit=? AND licence=?").get(postId,edition,input.kind,url,name,credit,licence);
      if (duplicate && duplicate.id !== prior?.id) throw new ApiError(409,"That source is already listed for this article and kind.","CONFLICT");
      if (!prior && db.prepare("SELECT count(*) n FROM news_source_credits WHERE COALESCE(post_id,'')=? AND (?<>'' OR edition=?)").get(postId,postId,edition).n>=100) throw new ApiError(400,"This article or edition has reached its 100-credit limit.","VALIDATION_FAILED");
      const next = { id: prior?.id || randomUUID(), post_id:postId || null, kind:input.kind, name,url,credit,licence,edition,position:input.position,revision:(prior?.revision || 0)+1 };
      db.prepare(`INSERT INTO news_source_credits(id,post_id,kind,name,url,credit,licence,edition,position,revision)
        VALUES (@id,@post_id,@kind,@name,@url,@credit,@licence,@edition,@position,@revision)
        ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,name=excluded.name,url=excluded.url,credit=excluded.credit,licence=excluded.licence,edition=excluded.edition,position=excluded.position,revision=excluded.revision`).run(next);
      audit(prior,next); authorize(); return next;
    });
  }
  function saveEdition(input,authorize,audit) {
    if (!input || Object.keys(input).some(k=>!["slug","title","status","revision"].includes(k)) || typeof input.slug!=="string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(input.slug) || input.slug.length>80 || typeof input.title!=="string" || !input.title.trim() || input.title.length>200 || !Number.isSafeInteger(input.revision) || input.revision<0 || !["draft","published","withdrawn"].includes(input.status)) throw new ApiError(400,"Check the edition name, link and visibility.","VALIDATION_FAILED");
    assertSafeAuthoredText(input.title,{field:"edition title"});
    return withImmediateWrite(db,()=>{
      authorize();const prior=db.prepare("SELECT * FROM news_source_editions WHERE slug=?").get(input.slug);
      if ((prior?.revision || 0)!==input.revision) throw new ApiError(409,"Edition changed. Reload before saving.","CONFLICT");
      const next={slug:input.slug,title:input.title.trim(),status:input.status,revision:(prior?.revision || 0)+1,created_at:prior?.created_at || Date.now()};
      db.prepare(`INSERT INTO news_source_editions VALUES(@slug,@title,@status,@revision,@created_at) ON CONFLICT(slug) DO UPDATE SET title=excluded.title,status=excluded.status,revision=excluded.revision`).run(next);
      audit(prior,next);authorize();return next;
    });
  }
  return { list, save, saveEdition };
}

export function sourceRegistryRoutes({ database, requireAdmin, rateLimit, now = Date.now }) {
  ensureSourceRegistrySchema(database);
  const registry = sourceRegistry(database);
  const writer = ctx => {
    const actor=requireAdmin(ctx);ctx.setHeader?.("Cache-Control","private, no-store");
    if (!actor.email_verified_at) throw new ApiError(403,"Confirm your email before adding sources.","EMAIL_VERIFICATION_REQUIRED");
    return actor;
  };
  const record = (ctx,actor,prior,next) => database.prepare(`INSERT INTO moderation_actions(id,actor_id,action,target_type,target_id,reason,prior_state,next_state,request_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),actor.id,"source_credit_saved",next.slug?"news_source_edition":"news_source_credit",next.id || next.slug,"Attribution correction",JSON.stringify(prior || {}),JSON.stringify(next),ctx.requestId || null,now());
  return {
    "GET /api/source-credits": ctx => { rateLimit(ctx,"source-credits",120,600000); ctx.setHeader?.("Cache-Control","no-store"); return registry.list(ctx.query); },
    "GET /api/moderation/source-credits": ctx => { writer(ctx);rateLimit(ctx,"source-credit-admin-read",120,600000);return registry.list(ctx.query,{staff:true}); },
    "PUT /api/moderation/source-editions": ctx => {
      const actor=writer(ctx);rateLimit(ctx,"source-credit-write",60,600000);
      return {edition:registry.saveEdition(ctx.body,()=>{ctx.signal?.throwIfAborted();if(writer(ctx).id!==actor.id) throw new ApiError(409,"Account changed. Reload.","CONFLICT");},(prior,next)=>record(ctx,actor,prior,next))};
    },
    "PUT /api/moderation/source-credits": ctx => {
      const actor = writer(ctx);
      rateLimit(ctx,"source-credit-write",60,600000);
      return { source: registry.save(ctx.body, () => {
        ctx.signal?.throwIfAborted();
        if (writer(ctx).id !== actor.id) throw new ApiError(409,"Account changed. Reload.","CONFLICT");
      }, (prior,next) => record(ctx,actor,prior,next)) };
    },
  };
}
