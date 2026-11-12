import { activeAccountSql } from '../../accountVisibility.js';

// One policy for legacy notes, canonical community scores and public excerpts.
// The caller binds @viewer to the authenticated account or null for public reads.
export function venueReviewVisibilitySql() {
  return `r.removed=0 AND ${activeAccountSql('u')}
    AND (u.profile_audience='everyone' OR (@viewer IS NOT NULL AND (u.profile_audience='members' OR u.id=@viewer)))
    AND NOT EXISTS (SELECT 1 FROM reports q WHERE q.target_type='venue_review' AND q.target_id=r.id AND q.status='open')
    AND (@viewer IS NULL OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
      (b.blocker_id=@viewer AND b.blocked_id=r.user_id) OR (b.blocker_id=r.user_id AND b.blocked_id=@viewer)))`;
}
