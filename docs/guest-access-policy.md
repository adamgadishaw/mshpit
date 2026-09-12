# Guest snapshots and member access

Guests can discover the product without loading the member feed. Public artist,
venue, city, show and shared-review pages remain readable and indexable. Public
profile reads keep their existing audience and block filtering. Searching venues
and viewing their location does not require an account.

The full feed, video feed and the personal You screen require a signed-in account.
These API endpoints enforce that boundary independently of the client:

| Endpoint | Guest result | Signed-in behavior |
| --- | --- | --- |
| GET /api/feed | 401 AUTH_REQUIRED | Chronological member feed |
| GET /api/feed/for-you | 401 AUTH_REQUIRED | Account-bound ranked feed |
| GET /api/clips | 401 AUTH_REQUIRED | Member video feed |
| POST /api/feed/revalidate | 401 AUTH_REQUIRED | Bounded read of cached feed IDs |
| GET /api/users/:id/posts | 401 AUTH_REQUIRED | Audience-filtered member profile feed |
| GET /api/users/:id/concert-history | 401 AUTH_REQUIRED | Audience-filtered concert history and map |

All six use private, no-store cache headers and recheck session authority at
handler dispatch. Expired or revoked sessions receive 401 rather than a null-user
exception. Revalidation is read-only and remains available to signed-in users
waiting for email verification. It cannot create impressions or preferences.
Its tombstones use the same active-author predicate as fresh feed reads, including
dormancy, bans and current suspensions, so cached cards do not outlive visibility.

GET /api/me deliberately returns user: null to guests: it is the session-detection
endpoint, not the personal profile screen. Other self-data endpoints retain their
existing authentication guards. The landing hero uses its bounded public media
projection and discovery sidebar, never the feed endpoints.
Anonymous artist-profile responses retain the public biography and artwork but
return an empty posts list without querying the artist update feed. Signed-in
updates retain the existing publishing, owner, block and legacy-artist rules.
This does not change public artwork or SEO document projections.

Posting, likes, comments, follows, ratings, RSVPs, media uploads and profile edits
require accounts. The central mutation gate separately requires email verification
for public/social writes, and each route keeps its ownership and moderation checks.
The client shows an account prompt; it must not replay a pending interaction after
login or navigate through a parent artist-card press handler.

The guest-access contract tests exercise the real registered handlers. They cover
guest rejection before payload processing, unchanged database state, no provider
calls, successful public snapshots, member responses, live-session revocation and
cache policy. The read benchmark defaults to guest snapshots; personalized and
legacy feed modes require a validated local session. Use the isolated multi-user
stress harness for concurrent signed-in capacity tests.

## Client navigation

`memberAccess.mjs` controls the shell's account-only tabs and overlay frames.
Feed and You taps open sign-in without replaying a social action. A guest's saved
Feed/You selection renders Discover instead; restored account overlays render
sign-in before their effects can mount. Search, venue locations, artist details,
show dates, city guides, and individual shared reviews remain available.

Artist Community and venue Reviews tabs prompt for sign-in. Member profiles
show their public identity and biography to guests, with an account prompt in
place of posts, photos, rewards, and concert history. A signed-in member's You
shortcut opens the existing profile Concert history section; it does not create
a second map or a second dashboard history request.

Client feed readers stop before transport when identity is unconfirmed or absent.
Every feed page is bound to its expected account. A 401/403 never triggers the
chronological fallback; that fallback remains reserved for availability failures.

Run `npm test`, `node scripts/verify-auth-browser.mjs`,
`node scripts/verify-auth-real-server.mjs`, and
`node scripts/verify-concert-history-browser.mjs` after access-policy changes.
Browser runners use isolated loopback fixtures, never production credentials.
