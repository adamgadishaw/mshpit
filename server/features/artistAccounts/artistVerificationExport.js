// Portable self-only evidence metadata. One-time codes and reviewer identities
// are intentionally not copied into a durable account download.
export function exportArtistVerification(database, userId) {
  return {
    verificationChallenges: database.prepare(`SELECT id,artist_name,instagram_handle,created_at,expires_at,status
      FROM artist_verification_challenges WHERE user_id=? ORDER BY created_at DESC,id`).all(userId)
      .map(row => ({ id: row.id, artistName: row.artist_name, instagramHandle: row.instagram_handle,
        createdAt: row.created_at, expiresAt: row.expires_at, status: row.status })),
    verificationEvidence: database.prepare(`SELECT e.request_id,e.method,e.story_url,e.reviewed_url,e.reviewed_at,e.observed_at
      FROM artist_request_evidence e JOIN artist_requests r ON r.id=e.request_id
      WHERE r.user_id=? ORDER BY r.created_at DESC,r.id`).all(userId)
      .map(row => ({ requestId: row.request_id, method: row.method, storyUrl: row.story_url,
        reviewedUrl: row.reviewed_url, reviewedAt: row.reviewed_at, observedAt: row.observed_at })),
    identityReviews: database.prepare(`SELECT artist_key,identity_review_status,identity_review_reason,identity_reviewed_at,identity_review_evidence_url
      FROM artist_profiles WHERE owner_id=? ORDER BY artist_key`).all(userId)
      .map(row => ({ artistKey: row.artist_key, status: row.identity_review_status,
        reason: row.identity_review_reason, reviewedAt: row.identity_reviewed_at, evidenceUrl: row.identity_review_evidence_url })),
  };
}
