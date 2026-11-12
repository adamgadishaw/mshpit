import { ApiError } from '../../errors.js';
import { createPublicVenueReviewService } from '../seo/publicVenueReviews.js';
import { venueReviewVisibilitySql } from '../seo/venueReviewVisibility.js';
import { activeAccountSql, accountIsPublic } from '../../accountVisibility.js';
import { publicVenueFanPhotos } from '../../venueGallery.js';
import { verifiedVenueOperator } from './ownership.js';
import { setCreatorEntityOwnership } from '../creatorPosts/creatorEntityOwnership.js';
import { manualIdentityReviewEvidence } from '../artistAccounts/artistVerification.js';
import { assertVenueClaimAccount, invalidateVenueAccountSessions, releaseVenueAccountRole, VENUE_ACCOUNT_CONSENT } from './accountPolicy.js';
import { canonicalVenueCreatorTarget } from './creatorTarget.js';

const invalid = message => new ApiError(400, message, 'VALIDATION_FAILED');
const conflict = () => new ApiError(409, 'This page changed. Refresh before continuing.', 'CONFLICT');
function httpsReference(value) {
  if (typeof value !== 'string' || value.length > 500) throw invalid('Add a public HTTPS evidence link.');
  let url;
  try { url = new URL(value); } catch { throw invalid('Add a public HTTPS evidence link.'); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) throw invalid('Add a public HTTPS evidence link.');
  return url.href;
}
function pageCursor(value, scope) {
  if (!value) return null;
  if (typeof value !== 'string' || value.length > 900 || !/^[\w-]+$/.test(value)) throw invalid('Choose a valid page.');
  let row;
  try { row = JSON.parse(Buffer.from(value, 'base64url').toString()); } catch { throw invalid('Choose a valid page.'); }
  if (row.scope !== scope || !Number.isSafeInteger(row.at) || typeof row.id !== 'string' || row.id.length > 150) throw invalid('Choose a valid page.');
  return row;
}
const nextCursor = (rows, scope) => rows.length > 20 ? Buffer.from(JSON.stringify({ scope, at: rows[19].created_at, id: rows[19].id })).toString('base64url') : null;

export function venueCommunityRoutes({ db, readSnapshot, resolveReviewKeys = null, requireUser, requireAdmin, limit, atomicWrite, uid, now, clean, assertSafeAuthoredText, moderationRecord }) {
  const scores = createPublicVenueReviewService(db, { resolveReviewKeys });
  const resolve = path => {
    if (typeof path !== 'string' || !/^\/venue\/[a-z0-9-]{1,240}$/.test(path)) throw invalid('Choose a venue page.');
    const snapshot = readSnapshot(path);
    if (!snapshot) throw new ApiError(404, 'This venue is unavailable.', 'NOT_FOUND');
    return snapshot;
  };
  const member = ctx => {
    const actor = requireUser(ctx);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(actor.id);
    if (!accountIsPublic(user, now())) throw new ApiError(403, 'This account cannot contribute right now.', 'FORBIDDEN');
    return user;
  };
  const noStore = ctx => ctx.setHeader?.('Cache-Control', 'no-store');
  const admin = ctx => {
    const actor = requireAdmin(ctx), current = db.prepare('SELECT * FROM users WHERE id=?').get(actor.id);
    if (!accountIsPublic(current, now()) || current.role !== 'admin') throw new ApiError(403, 'Administrator access is required.', 'FORBIDDEN');
    return current;
  };
  const entity = path => db.prepare("SELECT owner_id,status FROM creator_entities WHERE entity_type='venue' AND entity_key=?").get(path);
  const statuses = ['pending', 'approved', 'rejected', 'revoked', 'cancelled', 'all'];
  const claims = (ctx, accountId = null) => {
    noStore(ctx);
    const status = ctx.query?.status || 'pending';
    if (!statuses.includes(status)) throw invalid('Choose a claim status.');
    const scope = JSON.stringify(['venue-claims', accountId, status]);
    const cursor = pageCursor(ctx.query?.after, scope);
    const rows = db.prepare(`SELECT c.*,u.name,u.role AS account_role,e.owner_id AS current_owner_id,e.status AS page_status
      FROM venue_claims c JOIN users u ON u.id=c.user_id
      LEFT JOIN creator_entities e ON e.entity_type='venue' AND e.entity_key=c.venue_path
      WHERE (@status='all' OR c.status=@status) AND (@account IS NULL OR c.user_id=@account)
      ${cursor ? 'AND (c.created_at<@at OR (c.created_at=@at AND c.id<@id))' : ''}
      ORDER BY c.created_at DESC,c.id DESC LIMIT 21`).all({ status, account: accountId, ...(cursor ? { at: cursor.at, id: cursor.id } : {}) });
    return { claims: rows.slice(0, 20).map(row => accountId ? {
      id: row.id, venue_path: row.venue_path, venue_name: row.venue_name, status: row.status,
      website: row.website, note: row.note, created_at: row.created_at, reviewed_at: row.reviewed_at,
      conversion_consent: row.conversion_consent,
    } : row), nextCursor: nextCursor(rows, scope) };
  };
  const community = (ctx, snapshot) => {
    noStore(ctx);
    const path = snapshot.path, viewer = ctx.user?.id || null;
    const args = { path, viewer };
    const where = `r.venue_key=@path AND ${venueReviewVisibilitySql()}`;
    const stats = scores.read({ venueKey: snapshot.venue.name, canonicalPath: path, viewerId: viewer, limit: 0 }).stats;
    const rating = { count: stats.ratingCount, average: stats.averageRating };
    const cursor = pageCursor(ctx.query?.after, path);
    const rows = db.prepare(`SELECT r.id,r.user_id,r.rating,r.text,r.created_at,u.name FROM venue_reviews r JOIN users u ON u.id=r.user_id
      WHERE ${where} ${cursor ? 'AND (r.created_at<@at OR (r.created_at=@at AND r.id<@id))' : ''}
      ORDER BY r.created_at DESC,r.id DESC LIMIT 21`).all({ ...args, ...(cursor ? { at: cursor.at, id: cursor.id } : {}) });
    const owner = verifiedVenueOperator(db, path, now());
    const claim = viewer ? db.prepare('SELECT id,status,conversion_consent,website,note FROM venue_claims WHERE venue_path=? AND user_id=? ORDER BY created_at DESC,id DESC LIMIT 1').get(path, viewer) : null;
    const creator = canonicalVenueCreatorTarget(readSnapshot, path), registered = entity(path);
    const mine = viewer ? db.prepare('SELECT id,rating,text FROM venue_reviews WHERE venue_key=? AND user_id=? AND removed=0').get(path, viewer) : null;
    return { path, ownership: owner ? 'verified' : 'community', isOperator: !!viewer && owner?.user_id === viewer,
      creatorEntity: creator && (!registered || registered.status === 'active') ? creator : null,
      claim: claim || null, myReview: mine || null, rating, stats, nextCursor: nextCursor(rows, path),
      reviews: rows.slice(0, 20).map(r => ({ id: r.id, userId: r.user_id, name: r.name, rating: r.rating, text: r.text, createdAt: r.created_at })) };
  };
  return {
    'GET /api/venue-community': ctx => {
      limit(ctx, 'venue-community-read', 120, 600000);
      return community(ctx, resolve(ctx.query?.path));
    },
    'GET /api/venue-community/covers': ctx => {
      limit(ctx, 'venue-community-covers', 90, 600000); noStore(ctx);
      const paths = typeof ctx.query?.paths === 'string' ? ctx.query.paths.split(',') : [];
      if (!paths.length || paths.length > 12) throw invalid('Choose up to twelve venues.');
      return { covers: [...new Set(paths)].map(path => {
        let snapshot;
        try { snapshot = resolve(path); } catch (error) { if (error.status === 404) return { path, photo: null }; throw error; }
        const photo = publicVenueFanPhotos(db, { venueKey: snapshot.venue.name, viewerId: ctx.user?.id,
          strictVenue: { path: snapshot.path, place: snapshot.venue.place }, limit: 1 })[0] || null;
        return { path, photo };
      }) };
    },
    'PUT /api/venue-community/rating': ctx => {
      const user = member(ctx); limit(ctx, 'venue-community-rate', 30, 3600000);
      const snapshot = resolve(ctx.body?.path), rating = ctx.body?.rating;
      if (typeof rating !== 'number' || !Number.isFinite(rating) || rating < 0.5 || rating > 5 || !Number.isInteger(rating * 2)) throw invalid('Choose a rating from 0.5 to 5 stars.');
      const text = clean(ctx.body?.text, { max: 2000, newlines: true }) || '';
      assertSafeAuthoredText(text, { field: 'venue review' });
      atomicWrite(() => {
        ctx.assertCurrentSession?.();
        const prior = db.prepare('SELECT id FROM venue_reviews WHERE venue_key=? AND user_id=? AND removed=0').get(snapshot.path, user.id);
        if (prior && db.prepare("SELECT 1 FROM reports WHERE target_type='venue_review' AND target_id=? AND status='open'").get(prior.id)) throw conflict();
        if (prior) db.prepare('UPDATE venue_reviews SET rating=?,text=?,updated_at=? WHERE id=?').run(rating, text, now(), prior.id);
        else db.prepare("INSERT INTO venue_reviews(id,venue_key,user_id,rating,text,created_at) VALUES(?,?,?,?,?,?)").run(uid('vr'), snapshot.path, user.id, rating, text, now());
      });
      return community({ ...ctx, query: {} }, snapshot);
    },
    'DELETE /api/venue-community/rating': ctx => {
      const user = member(ctx); limit(ctx, 'venue-community-rate', 30, 3600000);
      const snapshot = resolve(ctx.body?.path);
      atomicWrite(() => { ctx.assertCurrentSession?.(); db.prepare('DELETE FROM venue_reviews WHERE venue_key=? AND user_id=?').run(snapshot.path, user.id); });
      return community({ ...ctx, query: {} }, snapshot);
    },
    'POST /api/venue-community/claims': ctx => {
      const user = member(ctx); limit(ctx, 'venue-claim', 5, 3600000);
      assertVenueClaimAccount(db, user, now());
      if (ctx.body?.accountConversionAcknowledged !== true) throw invalid('Confirm that approval changes this account to a venue account and signs it out.');
      const snapshot = resolve(ctx.body?.path);
      // Name-only public pages cannot establish an operator's physical venue.
      if (!canonicalVenueCreatorTarget(readSnapshot, snapshot.path)) throw invalid('This venue needs a supported catalogue identity before it can be claimed.');
      const website = httpsReference(ctx.body?.website), note = clean(ctx.body?.note, { max: 2000, newlines: true });
      if (!note || note.length < 20) throw invalid('Explain your role and how staff can verify your authority.');
      assertSafeAuthoredText(note, { field: 'venue claim' });
      atomicWrite(() => {
        ctx.assertCurrentSession?.();
        const current = member(ctx); assertVenueClaimAccount(db, current, now());
        const registered = entity(snapshot.path);
        if (registered?.owner_id || (registered && registered.status !== 'active')) throw conflict();
        const pending = db.prepare("SELECT id,conversion_consent FROM venue_claims WHERE venue_path=? AND user_id=? AND status='pending'").get(snapshot.path, current.id);
        if (!pending) {
          db.prepare('INSERT INTO venue_claims(id,venue_path,venue_name,user_id,website,note,created_at,conversion_consent,conversion_consent_at,account_role_at_request) VALUES(?,?,?,?,?,?,?,?,?,?)')
            .run(uid('vc'), snapshot.path, snapshot.venue.name, current.id, website, note, now(), VENUE_ACCOUNT_CONSENT, now(), current.role);
        } else if (pending.conversion_consent !== VENUE_ACCOUNT_CONSENT) {
          db.prepare('UPDATE venue_claims SET website=?,note=?,conversion_consent=?,conversion_consent_at=?,account_role_at_request=? WHERE id=?')
            .run(website, note, VENUE_ACCOUNT_CONSENT, now(), current.role, pending.id);
        }
      });
      return community({ ...ctx, query: {} }, snapshot);
    },
    'DELETE /api/venue-community/claims/:id': ctx => {
      const user = member(ctx);
      atomicWrite(() => { ctx.assertCurrentSession?.(); db.prepare("UPDATE venue_claims SET status='cancelled' WHERE id=? AND user_id=? AND status='pending'").run(ctx.params.id, user.id); });
      return { ok: true };
    },
    'GET /api/admin/venue-claims': ctx => {
      admin(ctx); limit(ctx, 'venue-claims-admin', 120, 600000);
      return claims(ctx);
    },
    'GET /api/me/venue-claims': ctx => {
      const user = member(ctx); limit(ctx, 'venue-claims-own', 120, 600000);
      return claims(ctx, user.id);
    },
    'POST /api/admin/venue-claims/:id/review': ctx => {
      admin(ctx); limit(ctx, 'venue-claim-review', 60, 3600000);
      const decision = ctx.body?.decision;
      if (!['approved', 'rejected', 'revoked'].includes(decision)) throw invalid('Choose a review decision.');
      const note = clean(ctx.body?.note, { max: 2000, newlines: true });
      if (!note || note.length < 20) throw invalid('Record the reason for this decision.');
      assertSafeAuthoredText(note, { field: 'venue verification review' });
      const method = ctx.body?.method;
      const evidence = decision === 'approved' ? manualIdentityReviewEvidence({ reason: note, reviewedUrl: ctx.body?.reference,
        officialAccountConfirmed: ctx.body?.officialEvidenceConfirmed, ownershipConfirmed: ctx.body?.authorityConfirmed }) : null;
      const reference = evidence?.reviewedUrl || null;
      if (decision === 'approved' && (!['official_contact', 'domain_challenge'].includes(method) || ctx.body?.conversionConfirmed !== true || ctx.body?.expectedOwnerId !== null)) throw invalid('Confirm the venue account conversion and current unclaimed page after verifying the evidence.');
      atomicWrite(() => {
        ctx.assertCurrentSession?.();
        const staff = admin(ctx);
        const claim = db.prepare('SELECT * FROM venue_claims WHERE id=?').get(ctx.params.id);
        if (!claim) throw new ApiError(404, 'This claim is unavailable.', 'NOT_FOUND');
        if (claim.user_id === staff.id) throw new ApiError(403, 'Another administrator must review your claim.', 'FORBIDDEN');
        if (claim.status === decision) {
          if (decision !== 'approved' || verifiedVenueOperator(db, claim.venue_path, now())?.user_id === claim.user_id) return;
          throw conflict();
        }
        if (claim.status !== (decision === 'revoked' ? 'approved' : 'pending')) throw conflict();
        if (decision === 'approved') {
          const applicant = db.prepare('SELECT * FROM users WHERE id=?').get(claim.user_id);
          assertVenueClaimAccount(db, applicant, now());
          if (claim.conversion_consent !== VENUE_ACCOUNT_CONSENT || !claim.conversion_consent_at) throw conflict();
          const snapshot = resolve(claim.venue_path);
          if (snapshot.path !== claim.venue_path || !snapshot.venue.source || !snapshot.venue.providerVenueId) throw conflict();
          const registered = entity(claim.venue_path);
          if (registered && registered.status !== 'active') throw conflict();
          db.prepare("UPDATE users SET role='venue',verified=1 WHERE id=?").run(applicant.id);
          setCreatorEntityOwnership(db, { entityType: 'venue', entityKey: claim.venue_path, name: snapshot.venue.name,
            ownerId: claim.user_id, expectedOwnerId: null });
          invalidateVenueAccountSessions(db, applicant.id);
        } else if (decision === 'revoked') {
          if (ctx.body?.revocationConfirmed !== true || ctx.body?.expectedOwnerId !== claim.user_id) throw invalid('Confirm the current venue operator before removing access.');
          setCreatorEntityOwnership(db, { entityType: 'venue', entityKey: claim.venue_path, name: claim.venue_name,
            ownerId: null, expectedOwnerId: claim.user_id, status: entity(claim.venue_path)?.status || 'active' });
          releaseVenueAccountRole(db, claim.user_id);
        }
        db.prepare('UPDATE venue_claims SET status=?,reviewed_at=?,reviewer_id=?,review_method=?,review_reference=?,review_note=? WHERE id=?')
          .run(decision, now(), staff.id, decision === 'approved' ? method : null, reference, note, claim.id);
        moderationRecord(ctx, `venue_claim_${decision}`, 'venue_claim', claim.id, note,
          { status: claim.status, method: claim.review_method, reference: claim.review_reference, roleAtRequest: claim.account_role_at_request },
          { status: decision, method: decision === 'approved' ? method : null, reference,
            role: db.prepare('SELECT role FROM users WHERE id=?').get(claim.user_id)?.role, consent: claim.conversion_consent });
      });
      return { ok: true };
    },
  };
}
