import { ApiError } from '../../errors.js';
import { accountIsPublic } from '../../accountVisibility.js';

export const VENUE_ACCOUNT_CONSENT = 'venue-account-v1';

export function assertVenueClaimAccount(db, account, at = Date.now()) {
  if (!accountIsPublic(account, at) || !account.email_verified_at) {
    throw new ApiError(403, 'Confirm your email with an active account before requesting venue access.', 'EMAIL_VERIFICATION_REQUIRED');
  }
  const ownedArtist = db.prepare('SELECT 1 FROM artist_profiles WHERE owner_id=? LIMIT 1').get(account.id);
  const otherPage = db.prepare("SELECT 1 FROM creator_entities WHERE owner_id=? AND (entity_type<>'venue' OR ?='fan') LIMIT 1").get(account.id, account.role);
  if (!['fan', 'venue'].includes(account.role) || String(account.artist_name || '').trim() || ownedArtist || otherPage) {
    throw new ApiError(403, 'Use a separate account dedicated to this venue. This account has another identity or role.', 'FORBIDDEN');
  }
}

export function invalidateVenueAccountSessions(db, accountId) {
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(accountId);
  db.prepare('DELETE FROM newsroom_browser_sessions WHERE user_id=?').run(accountId);
}

export function releaseVenueAccountRole(db, accountId) {
  // Even held/removed pages remain owned identities. Revoking one page must
  // never change another page's access or silently convert a conflicting role.
  const remaining = db.prepare('SELECT 1 FROM creator_entities WHERE owner_id=? LIMIT 1').get(accountId)
    || db.prepare('SELECT 1 FROM artist_profiles WHERE owner_id=? LIMIT 1').get(accountId);
  if (!remaining) db.prepare("UPDATE users SET role='fan',verified=0 WHERE id=? AND role='venue' AND trim(COALESCE(artist_name,''))=''").run(accountId);
  invalidateVenueAccountSessions(db, accountId);
}
