import { createHash, randomUUID } from 'node:crypto';
import { getSession, createNewsroomSession, destroySession, newsroomSessionsEnabled, NEWSROOM_SESSION_MAX_MS } from '../../auth.js';
import { readBrowserNewsDraft, NewsEditorError } from '../newsDesk/newsDeskEditor.js';

const hash = token => createHash('sha256').update(token).digest('hex');
export function newsroomSessionRoutes({ database, editor, ApiError, requireEditor, verifyPassword, atomicWrite, rateLimit, mediaRoutes, now = Date.now }) {
  database.exec(`CREATE TABLE IF NOT EXISTS newsroom_browser_media (
    asset_id TEXT PRIMARY KEY REFERENCES media_assets(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_newsroom_browser_media_owner ON newsroom_browser_media(owner_id,created_at);`);
  database.exec(`CREATE TABLE IF NOT EXISTS newsroom_browser_photo_uses (
    request_hash TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_newsroom_browser_photo_uses_owner ON newsroom_browser_photo_uses(owner_id,created_at);`);
  const body = (ctx, keys) => {
    if (!ctx.body || typeof ctx.body !== 'object' || Array.isArray(ctx.body)
      || Object.keys(ctx.body).some(k => !keys.includes(k))) throw new ApiError(400, 'Unexpected Newsroom request fields.', 'VALIDATION_FAILED');
    return ctx.body;
  };
  const actor = ctx => {
    const session = getSession(ctx.token, { scope: 'newsroom' });
    if (ctx.sessionScope !== 'newsroom' || !session || typeof ctx.assertCurrentSession !== 'function') {
      throw new ApiError(401, 'Sign in again to enable remembered Newsroom access.', 'AUTH_REQUIRED');
    }
    const user = ctx.assertCurrentSession();
    if (user.id !== session.user_id) throw new ApiError(403, 'The Newsroom account changed.', 'FORBIDDEN');
    ctx.setHeader?.('Cache-Control', 'private, no-store');
    return user;
  };
  const ownDraft = (ctx, id) => {
    const user = actor(ctx), draft = readBrowserNewsDraft(database, { ownerId:user.id, draftId:id, at:now() });
    if (!draft) throw new ApiError(404, 'That self-written draft was not found.', 'NOT_FOUND');
    return draft;
  };
  const ownMedia = (ctx, id) => {
    const user=actor(ctx);
    if (!database.prepare('SELECT 1 FROM newsroom_browser_media WHERE asset_id=? AND owner_id=?').get(id,user.id)) {
      throw new ApiError(404, 'That Newsroom photo was not found.', 'NOT_FOUND');
    }
    return user;
  };
  const audit = (ctx,user,action,id) => {
    actor(ctx); // Runs inside the editor's save/publish transaction before commit.
    database.prepare(`INSERT INTO moderation_actions
      (id,actor_id,action,target_type,target_id,reason,prior_state,next_state,request_id,created_at)
      VALUES (?,?,?,?,?,'Remembered Newsroom browser','{}','{}',?,?)`)
      .run(randomUUID(),user.id,action,'news_draft',id,ctx.requestId || null,now());
  };
  const run = async work => {
    try {return await work();} catch(error) {
      if (!(error instanceof NewsEditorError)) throw error;
      switch (error.code) {
        case 'VALIDATION_FAILED': throw new ApiError(400,error.message,'VALIDATION_FAILED');
        case 'NOT_FOUND': throw new ApiError(404,error.message,'NOT_FOUND');
        case 'CONFLICT': throw new ApiError(409,error.message,'CONFLICT');
        case 'ACTION_REQUIRED': throw new ApiError(422,error.message,'ACTION_REQUIRED');
        case 'RATE_LIMITED': throw new ApiError(429,error.message,'RATE_LIMITED');
        case 'PROVIDER_UNAVAILABLE': throw new ApiError(502,error.message,'PROVIDER_UNAVAILABLE',error.cause);
        default: throw new ApiError(500,'The article request could not complete.','INTERNAL_ERROR',error);
      }
    }
  };
  return {
    // Only a valid ordinary staff session PLUS fresh password proof may opt in.
    // A remembered Newsroom cookie cannot reach or renew this issuance boundary.
    'POST /api/me/newsroom-session': async ctx => {
      if (!newsroomSessionsEnabled()) throw new ApiError(404,'Remembered Newsroom is not enabled.','NOT_FOUND');
      const user=requireEditor(ctx), input=body(ctx,['currentPassword']);
      rateLimit(ctx,'newsroom-browser-enable',5,3_600_000);
      const full=getSession(ctx.token), fresh=database.prepare('SELECT * FROM users WHERE id=?').get(user.id);
      if (!fresh?.email_verified_at) throw new ApiError(403,'Confirm your email before remembering Newsroom.','EMAIL_VERIFICATION_REQUIRED');
      if (!full || full.user_id!==user.id || typeof input.currentPassword!=='string' || input.currentPassword.length>100
        || !await verifyPassword(input.currentPassword,fresh.pass_hash)) throw new ApiError(401,'Confirm your password to remember this Newsroom.','AUTH_INVALID');
      const issued=atomicWrite(()=>{
        const current=requireEditor(ctx);
        const live=database.prepare('SELECT * FROM users WHERE id=?').get(user.id);
        if (!getSession(ctx.token) || current.id!==user.id || live.pass_hash!==fresh.pass_hash || live.role!==fresh.role) {
          throw new ApiError(401,'Your authentication changed. Sign in again.','AUTH_REQUIRED');
        }
        ctx.signal?.throwIfAborted();
        return createNewsroomSession(user.id);
      });
      ctx.setNewsroomSession(issued);
      ctx.setHeader?.('Cache-Control','private, no-store');
      return {enabled:true,expiresAt:issued.expiresAt,absoluteExpiresAt:now()+NEWSROOM_SESSION_MAX_MS};
    },
    'GET /api/newsroom-session/status': ctx => {
      if (!newsroomSessionsEnabled()) throw new ApiError(404,'Remembered Newsroom is not enabled.','NOT_FOUND');
      const user=actor(ctx), row=getSession(ctx.token,{scope:'newsroom'});
      return {account:{id:user.id,name:user.name},scope:'self-written-newsroom',expiresAt:row.expires_at,absoluteExpiresAt:row.created_at+NEWSROOM_SESSION_MAX_MS};
    },
    'POST /api/newsroom-session/logout': ctx => {destroySession(ctx.token);ctx.clearNewsroomSession();return {ok:true};},
    'POST /api/newsroom-session/logout-all': ctx => {
      const user=actor(ctx);
      const removed=database.prepare("DELETE FROM newsroom_browser_sessions WHERE user_id=?").run(user.id).changes;
      ctx.clearNewsroomSession();return {ok:true,revoked:removed};
    },
    'GET /api/newsroom-session/drafts': ctx => {
      const user=actor(ctx);
      rateLimit(ctx,'newsroom-browser-read',120,600_000);
      const rows=database.prepare(`SELECT id FROM news_drafts WHERE created_by=? AND origin='self_written'
        AND created_actor_type='newsroom_browser' AND created_grant_id IS NULL AND status IN ('draft','published')
        ORDER BY created_at DESC,id DESC LIMIT 20`).all(user.id);
      return {drafts:rows.map(row=>readBrowserNewsDraft(database,{ownerId:user.id,draftId:row.id,at:now()}))};
    },
    'GET /api/newsroom-session/drafts/:id': ctx => ({draft:ownDraft(ctx,ctx.params.id)}),
    'POST /api/newsroom-session/drafts': ctx => run(()=>{
      const user=actor(ctx);
      rateLimit(ctx,'newsroom-browser-write',20,3_600_000);
      const input=body(ctx,['headline','summary','body','category','sources','photo','idempotencyKey']);
      if (typeof input.idempotencyKey!=='string' || !/^[A-Za-z0-9._:-]{8,64}$/u.test(input.idempotencyKey)) {
        throw new ApiError(400,'A stable article save key is required.','VALIDATION_FAILED');
      }
      ownMedia(ctx,input.photo?.assetId);
      const draft=editor.writeSelfWritten({...input,actorId:user.id,actorType:'newsroom_browser',actorLabel:'Remembered Newsroom browser',
        grantId:null,idempotencyKey:'newsroom-browser:'+input.idempotencyKey,onSaved:saved=>audit(ctx,user,'newsroom_browser_draft_saved',saved.id)});
      ownDraft(ctx,draft.id);
      return {draft};
    }),
    'POST /api/newsroom-session/drafts/:id/publish': ctx => run(()=>{
      const user=actor(ctx), draft=ownDraft(ctx,ctx.params.id), input=body(ctx,['expectedRevision']);
      rateLimit(ctx,'newsroom-browser-publish',20,3_600_000);
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision!==draft.revision) throw new ApiError(409,'Refresh the article preview before publishing.','CONFLICT');
      ownMedia(ctx,draft.photo?.assetId);
      return editor.publish(draft.id,{expectedRevision:input.expectedRevision,onPublished:published=>audit(ctx,user,'newsroom_browser_published',published.draft.id)});
    }),
    'POST /api/newsroom-session/drafts/:id/discard': ctx => run(()=>{
      const user=actor(ctx),draft=ownDraft(ctx,ctx.params.id);body(ctx,[]);
      rateLimit(ctx,'newsroom-browser-discard',30,3_600_000);
      return {draft:editor.discard(draft.id,{onDiscarded:saved=>audit(ctx,user,'newsroom_browser_discarded',saved.id)})};
    }),
    'POST /api/newsroom-session/media': async ctx => {
      const user=actor(ctx), input=body(ctx,['clientAssetId','contentType','fileSize','name']);
      if (!['image/jpeg','image/png','image/webp'].includes(input.contentType) || !Number.isSafeInteger(input.fileSize)
        || input.fileSize<1 || input.fileSize>10*1024*1024 || typeof input.clientAssetId!=='string'
        || !/^[A-Za-z0-9._:-]{1,64}$/u.test(input.clientAssetId)) throw new ApiError(400,'Choose a JPEG, PNG or WebP photo of at most 10 MiB.','VALIDATION_FAILED');
      rateLimit(ctx,'newsroom-browser-photo',6,3_600_000);
      // Serialize the bound ticket reservation. Existing media quotas/circuit
      // breakers also apply; no user-supplied purpose, URL, object key or variant.
      const clientAssetId='newsroom:'+hash(ctx.token).slice(0,16)+':'+input.clientAssetId;
      atomicWrite(()=>{
        actor(ctx);
        database.prepare('DELETE FROM newsroom_browser_photo_uses WHERE created_at<?').run(now()-14*86_400_000);
        const requestHash=hash(clientAssetId);
        if (!database.prepare('SELECT 1 FROM newsroom_browser_photo_uses WHERE request_hash=?').get(requestHash)) {
          const count=database.prepare('SELECT count(*) n FROM newsroom_browser_photo_uses WHERE owner_id=? AND created_at>?').get(user.id,now()-86_400_000).n;
          if (count>=12) throw new ApiError(429,'This Newsroom has reached its photo allowance for today.','RATE_LIMITED');
          database.prepare('INSERT INTO newsroom_browser_photo_uses VALUES (?,?,?)').run(requestHash,user.id,now());
        }
      });
      const result=await mediaRoutes()['POST /api/media/assets']({...ctx,body:{...input,clientAssetId,purpose:'post'}});
      atomicWrite(()=>{actor(ctx);database.prepare('INSERT OR IGNORE INTO newsroom_browser_media(asset_id,owner_id,created_at) VALUES (?,?,?)').run(result.asset.id,user.id,now());});
      return result;
    },
    'GET /api/newsroom-session/media/:id': ctx => {ownMedia(ctx,ctx.params.id);return mediaRoutes()['GET /api/media/assets/:id'](ctx);},
    'POST /api/newsroom-session/media/:id/finalize': async ctx => {
      ownMedia(ctx,ctx.params.id);const input=body(ctx,['orientation','altText']);
      const result=await mediaRoutes()['POST /api/media/assets/:id/finalize']({...ctx,body:{...input,deliveryMode:'server'}});
      actor(ctx);return result;
    },
  };
}
