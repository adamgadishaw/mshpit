# Social, privacy and first-party player review — 2026-09-27

## Scope and release status

Implementation is on `codex/social-privacy-player`, based on `421d723`. This is a source review, isolated database testing and exported-web browser verification, not a penetration test or proof that production is already updated. No production accounts, content, media, billing settings or database rows were changed during these checks. Claude's other worktrees were left untouched.

## User-facing changes

- Artist Follow is visible to members and guests. Guests are asked to sign in. Following artists and following people have separate counts and lists; artist subscriptions feed the existing followed-artist news rules.
- Followers, people following and artists followed support search. People lists also support Verified and Following filters, pagination and retry. Public lists remain subject to both the list owner's audience setting and each returned person's audience/block status.
- Comments and replies have Like/Unlike, counts and notifications. Reposts are actual server-backed distribution signals, not merely a share dialog. Notifications link back to the original post/comment.
- Following has its own paginated server feed, rather than filtering whichever For You cards happened to be loaded. Reposts point to the original post and do not duplicate media or change its publication timestamp.
- For You remains global-first. Version 3 adds a bounded followed-network repost signal and an eligible discovery opportunity every fifth position, without removing ordinary posts. It is deterministic ranking, not a trained ML model; twenty posts cannot establish long-term engagement performance.
- Eligible confirmed accounts receive a cosmetic First Wave badge for the first 1,000 slots; later accounts show Email confirmed. Existing eligible accounts are backfilled by account creation order. These are not identity checks, moderator rights or ownership. First Wave is allocated after required account setup; service/demo accounts and held artist claims are excluded.
- A reusable Mshpit player now handles finalized first-party video in the media viewer. It uses the already-installed Expo video package, with platform playback/seeking/volume/fullscreen controls, web picture-in-picture where supported, playback speed, inline failure recovery and background pausing. The Clips surface shares the measured-playback and browser-start safeguards. YouTube remains a separate provider; no custom ads are injected into it.

## Findings repaired

| Finding | Change |
| --- | --- |
| Analytics retry timer was immediately replaced with another flush, potentially creating a failure/request storm | A per-account backoff deadline survives queue growth and manual flush; account changes reset it; old-account completions are ignored |
| News post identifiers were rejected by measurement while ordinary post identifiers were accepted | A bounded content identifier contract accepts news IDs without widening receipt IDs; IDs are checked against visible stored posts |
| A stale consent snapshot or removed/blocked author could affect analytics | Consent, active-account state and referenced post visibility are checked under the same write transaction; opt-out receives no visibility feedback |
| Seeking could manufacture video progress and preference signals | Unique, visible played intervals produce watched-v1 milestones; seeking, hidden time, loops over the same segment and legacy progress do not train the new video signal |
| Expo web's wrapper discarded the browser play rejection | First-party play observes the HTML media promise in the original user gesture; rejected playback becomes a recoverable inline state |
| Private screens could leave the public discovery/sponsorship host mounted behind them | An explicit public-frame allowlist unmounts it on private and unknown screens |
| A held artist identity could retain official-looking legacy promo treatment or appear in Verified-only lists | Current identity-review status gates campaign projection, comment identity and Verified connection filtering |
| Old Following content could survive revoked access behind an error | Authority errors clear the scoped rows/cursor; transient network errors may preserve already visible content |
| Mutes were applied after recommendation page selection | Muted creators are excluded before candidate pagination and rechecked when consuming an issued snapshot |
| Repeated reactions could spam notices or bump old content | Explicit desired state, one durable actor/target row, transactional updates and one-time notification evidence make retries/toggles idempotent |
| A news repost could enter Following, and returning to For You could promote another story | News is excluded from both Following source queries and the client view; a bounded account-scoped runtime identity permits only one introduction attempt with idempotent retry |

## Privacy and database boundaries

New writes require authentication, current active-account state, verified email for reactions, existing account binding/CSRF controls and rate limits. Comment likes recheck the original post, target comment and ancestor chain. Repost delivery rechecks original author, reposter, blocks, mutes and applicable reposter profile audience. A private profile does not retroactively make its separately published public posts private.

Reaction tables use compound unique keys, foreign-key cascades and indexed reads. Toggle rows remain after Unlike/Undo repost to prevent duplicate notifications and artificial timestamp bumps. Account deletion cascades reaction data; own-data export includes it. A deleted First Wave account's slot retains no account reference and is not recycled or transferred. Badge allocation is transactional and capped by database constraints at 1,000.

First Wave is account-based, not proof of a unique human: inbox access and the site's existing signup protections do not eliminate multi-account abuse. Staff-reviewed artist identity remains a distinct check.

## Player and advertising boundary

No ad SDK, third-party advertising request, paid player subscription or new server was added. Ads remain hard-disabled; arbitrary media metadata cannot enable them. Technical upload verification proves neither music copyright ownership nor permission to monetize concert footage. The existing video verifier is not disabled by this change.

The first-party player is not a licensed on-demand commercial music catalogue and does not promise background native playback. Existing storage, delivery bandwidth and video processing still cost money; a free playback library does not make those free.

Before enabling ads, separately implement and review: server-authorized inventory/campaigns, jurisdiction-appropriate consent and withdrawal, rights records, ad-provider approval, accessible ad failure/skip controls, deduplicated billing-grade measurement and retention/deletion rules. Product watched-v1 telemetry is client-controlled engagement data, not anti-fraud evidence or billable ad impressions.

References: [Expo 57 video API](https://docs.expo.dev/versions/v57.0.0/sdk/video/), [Google IMA HTML5 integration](https://developers.google.com/interactive-media-ads/docs/sdks/html5/client-side/get-started), [YouTube developer policies](https://developers.google.com/youtube/terms/developer-policies).

## Performance, costs and remaining work

- No extra background agents, paid AI calls, media copies or recurring services were introduced.
- Repost projection uses two batched queries per 100 selected feed cards instead of per-card lookups.
- Following starts from followed-user edges, uses indexes, filters cursor bounds early and deduplicates original identity across pages. Its aggregation still grows with actual network history: an isolated synthetic 100-followee / 100,000-post / 50,000-repost fixture took roughly 337–381 ms. That is not a production measurement. Before that scale, move activity ordering into an indexed materialized delivery model and benchmark write/read tradeoffs.
- Connections return only list identity fields, not every account's artist subscriptions.
- Video remains lazy/on-demand. The production bundle is checked against the existing 512 KiB initial gzip budget, without raising it.
- Backup/restore readiness, a live Render resource audit, commercial rights clearance, ad-provider approval and physical iPhone testing are not established by these local tests. They must not be represented as completed.
- Email confirmation is not identity verification; the badge and explanatory privacy copy deliberately keep them distinct.

## Verification and rollout

Focused tests cover permission revocation, two-way blocks, private audiences, held artist claims, account switching, notification deduplication, cursor identity, database deletion/export, 1,000-slot allocation, seek/hidden playback and offline backoff. Browser fixtures run the real exported app at phone and desktop widths with synthetic media/accounts and all outbound traffic blocked.

Verified locally: 5,641 tests passed, zero failed, one skipped. Production export and its unchanged bundle gate passed at 511.8/512.0 KiB initial gzip; this is very little remaining startup budget. Syntax passed for 742 Node files. Architecture and Blueprint checks passed, and the production dependency audit reported zero known vulnerabilities. This is evidence from the tested snapshot, not a guarantee of security.

The same full suite also passed under the hosted Render flags (5,641 passed, zero failed, one skipped). All 14 final browser cases passed: player 2, connections 4, social reactions 2, news 4 and upload/retry 2. New browser suites are included in CI. These are isolated Chromium mobile-viewports and desktop cases, not physical iPhone Safari.

Use the normal protected-branch pull request and CI route. Do not bypass branch protection or describe a branch push as a live deployment. Migrations are additive; keep a verified backup before rollout and verify production health, sample public/member feeds and account-scoped behavior afterward.
