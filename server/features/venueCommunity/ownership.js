import { accountIsPublic } from '../../accountVisibility.js';

// Read the shared creator registry; claims are review evidence, never a second
// ownership registry. Creator commands continue to enforce their own policy.
export function verifiedVenueOperator(db, venuePath, at = Date.now()) {
  const row = db.prepare(`SELECT e.owner_id AS user_id,c.reviewed_at AS verified_at FROM creator_entities e
    JOIN venue_claims c ON c.user_id=e.owner_id AND c.venue_path=e.entity_key AND c.status='approved'
    WHERE e.entity_type='venue' AND e.entity_key=? AND e.status='active'
    ORDER BY c.reviewed_at DESC,c.id DESC LIMIT 1`).get(venuePath);
  if (!row) return null;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id);
  return accountIsPublic(user, at) && user.role === 'venue' && user.email_verified_at ? row : null;
}

export function ownsVerifiedVenue(db, userId, venuePath, at = Date.now()) {
  return !!userId && verifiedVenueOperator(db, venuePath, at)?.user_id === userId;
}
