# News desk publication and integrity policy

The default policy is defined in `newsEditorial.js`.

- Publish near 08:00, 11:00, 14:00, 17:00 and 20:00 in `America/Toronto`. Each slot has a 30-minute scheduler grace window, ending exclusively at :30. There is no later catch-up or breaking-news bypass.
- Allow at most one publication per slot and five per local day. Previously published stories still consume their allowance after withdrawal. Recheck the slot and publishing account inside the database transaction after model work completes.
- Prefer evidence from at least three independent publisher groups. Only reports actually selected by the editor count; never substitute the original cluster for insufficient selected evidence. Shared owners count once, using the local source registry rather than model-supplied ownership.
- The default `empty_day` fallback permits one two-publisher story only if nothing has been published that local day. It may run after normal candidates are declined, but only within the same three-call pass limit and remaining monetary budget. It does not fill every empty slot. Death and legal reporting always require three independent groups.
- Copy must remain neutral, attributed and factual, without speculation or unverified allegations. These constraints and evidence-count checks reduce risk; model output is not a guarantee of factual accuracy. The owner can withdraw a story for review.

## Operational bounds

Grouping reads at most 1,200 open reports from the previous 48 hours per pass. Prompts include at most six reports, preferring different owners, and article enrichment fetches at most four leads. A durable feed cursor advances before each network wait so aborts and restarts do not starve later outlets. An aborted pass cannot start a paid request after article enrichment.

Each model request reserves a conservative price estimate atomically against the feature's daily/monthly limits and the shared Claude monthly allowance. Successful requests settle against validated usage. Explicit HTTP rejection settles to zero; lost replies, server failures and unusable billing receipts keep their reservation. Input-byte estimates and application reservations are not a provider invoice cap: configure provider-side spending controls as well.

## Publisher identity

Automated publication is bound to an immutable account ID in `app_meta` (`news-desk:publisher-identity:v1`), never to the current holder of `@news_mod`. Existing installations migrate from exactly one historical `news_stories` → `posts` author, including withdrawn stories. Rename, handle reclamation, account deletion and restarts never transfer that binding.

For a new installation with no news history, explicitly set `NEWS_DESK_ACCOUNT_ID` to the reviewed publisher's internal user ID in trusted server configuration. Do not use a handle or add this setting blindly on an established installation. Multiple historical authors, invalid binding evidence or configuration conflicting with the durable identity stop publishing with a sanitized review message; they never silently choose a replacement. An intended account transfer requires operator review of that durable binding and history, not only an environment edit. No live setting is changed by this patch.

Before feed work, before paid publication work and inside the publication transaction, the publisher must still exist and be active: not banned, dormant or currently suspended. Paused identity checks do not start model calls.

## Public and signed-in readers

News items retain their original post author. Bilateral blocks use that stored author, not whoever currently has the news account handle. Signed-in lists and images are private and uncached. A preview rechecks visibility and rendered content after awaiting the renderer; a block, removal, suspension or visible-content change causes rejection rather than delivery of a stale card.

Focused regression command: `node --test server/features/newsDesk/newsDesk.test.mjs server/features/newsDesk/newsPublisherIdentity.test.mjs server/features/newsDesk/newsDeskJob.test.mjs`.
