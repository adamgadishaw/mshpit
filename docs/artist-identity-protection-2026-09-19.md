# Artist identity protection and Instagram Story review

## Product rules

- Signup/email confirmation proves control of an inbox, not an artist identity.
- Existing catalogue pages cannot be taken over through self-service creation.
- Catalogue-matching usernames and misleading name variants require a reviewed claim. Ordinary fans can still use shared personal display names with a distinct personal username.
- Risk checks use bounded indexed local catalogue reads and a reviewed alias registry, not live MusicBrainz/Instagram requests. Common Unicode lookalikes and official/verified variants are risk signals, never ownership resolution.
- Suspicious newly created artist pages are held privately. Their owners retain Artist HQ and profile draft editing, but cannot publish the held artist identity, posts or shows. A check never follows automatically from page creation or a proof submission.
- Ordinary independent artists remain able to create free, explicitly unverified pages. An unknown name absent from the catalogue is not automatically proof of safety: reports and human review remain necessary.

## Instagram Story method

1. In Artist setup/verification, select Instagram Story and enter the established official artist account's handle.
2. Generate the account-, artist- and handle-bound Mshpit challenge. Publish the artist name and displayed code together in a Story from that account.
3. Submit the exact Story URL and context showing how the account is associated with the artist.
4. An administrator independently checks that it is the established official account and directly views the live Story. A screenshot, follower count, profile URL or the supplied code alone does not establish identity.
5. The administrator records the observed code/time and reason, confirms authority to represent the artist, and explicitly grants the check. A held identity also requires an explicit conflict resolution.

Challenges expire after 24 hours and issuance is capped at three per account in a rolling 24-hour window. Retrying a still-active challenge with unchanged details returns the same code. Expired or rejected proof requires a fresh code/Story. Codes are not Instagram login codes; the site never asks for Instagram passwords, downloads Stories or automatically publishes to Instagram.

Instagram review needs a person to see the Story before it disappears. If this cannot be arranged, use the manual official website/social/management evidence method instead. The application does not promise automatic Instagram verification or an Instagram/Meta verification badge.

## Moderation

Pending artist claims display private proof details and risk signals. Identity safety lookup supports holding/releasing existing owned pages without a pending request. Holds revoke the public artist check and quarantine artist-bound feed posts, without deleting uploaded media or transferring ownership. Releasing a hold requires reviewed evidence and does not itself award a check or silently restore previously hidden posts. Decisions are audited; rejection feedback supports a new submission.

Do not resolve a disputed existing owner by blindly approving another claimant: the API refuses that transfer. Investigate separately, retain the audit trail, and do not merge an impersonator's posts/followers into a genuine artist account.

## Data, cost and rollout boundaries

- Small SQLite metadata records only; no paid provider integration, background polling, new hosting service, image/video evidence copy or new production dependency.
- Applicant evidence is self/admin-only and not shared-cacheable. The account export includes that member's evidence metadata, not live challenge codes or reviewer identities. Account deletion cascades through proof records.
- Unsubmitted expired challenges have bounded per-member cleanup; submitted evidence is retained for review/audit alongside artist requests.
- Existing accounts are not mass-renamed or automatically purged. Name screening applies to new/changed identity fields, delayed signup-handle claims and new artist pages; existing suspicious pages can be held manually.
- This is risk-based protection, not exhaustive Unicode detection, universal famous-name recognition or a guarantee against a dishonest human reviewer. Verify the official account independently, especially for popular names and legitimate same-name artists.

## Verification

Regression coverage includes name/handle spoofing, deferred handle claims, forged roles, proof ownership/name/handle binding, expired/revoked/consumed codes, resubmission recovery, admin-only review, public/SEO publication gates, private exports and deletion cleanup. Browser coverage exercises the applicant and moderator flows at mobile and desktop sizes, including failed requests and retry.

Reference: [Meta's description of regular Stories disappearing after 24 hours](https://about.fb.com/news/2020/08/introducing-instagram-reels/). The application independently enforces its own 24-hour challenge expiry.
