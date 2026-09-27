# News desk publication and integrity policy

The default policy is defined in `newsEditorial.js`.

- Publish near 08:00, 11:00, 14:00, 17:00 and 20:00 in `America/Toronto`. Each slot has a 30-minute scheduler grace window, ending exclusively at :30. There is no later catch-up or breaking-news bypass.
- Allow up to two publications per slot and ten per local day. Previously published stories still consume their allowance after withdrawal. Restarts may fill only the remaining capacity of an open slot; they never reset it. A second story in the same slot does not wait two hours. Recheck the slot, publishing account and unused evidence inside the database transaction after model work completes.
- Prefer evidence from at least three independent publisher groups. Only reports actually selected by the editor count; never substitute the original cluster for insufficient selected evidence. Shared owners count once, using the local source registry rather than model-supplied ownership.
- The default `empty_day` fallback permits one two-publisher story only if nothing has been published that local day. It may run after normal candidates are declined, but only within the same three-call pass limit and remaining monetary budget. It does not fill every empty slot. Death and legal reporting always require three independent groups.
- Copy must remain neutral, attributed and factual, without speculation or unverified allegations. These constraints and evidence-count checks reduce risk; model output is not a guarantee of factual accuracy. The owner can withdraw a story for review.

## Operational bounds

Grouping reads at most 1,200 open reports from the previous 48 hours per pass. Prompts include at most six reports, preferring different owners, and article enrichment fetches at most four leads. A durable feed cursor advances before each network wait so aborts and restarts do not starve later outlets. An aborted pass cannot start a paid request after article enrichment.

Two stories is a maximum, not a quota. The existing worker still processes candidates serially, makes at most three paid attempts per pass, and has a 180-second pass deadline. Insufficient evidence, declines, timeouts, closed slots or exhausted reservation headroom can result in fewer stories. This change adds no worker, service or parallel model fan-out.

Default application admission allowances are `NEWS_DESK_DAILY_USD=0.75`, `NEWS_DESK_MONTHLY_USD=15` and `ANTHROPIC_MONTHLY_USD=20`. Catalogue research remains separately limited to $0.30/day and $4/month and shares the $20 monthly ceiling. Explicit smaller runtime environment allowances (including zero) are honored. Spending days/months use UTC; publication days and slots use Toronto time, including daylight-saving changes. At some evening slots those calendar dates differ.

Each model request reserves a conservative price estimate atomically against the feature's daily/monthly limits and the shared Claude monthly allowance. Successful requests settle against validated usage. Explicit HTTP rejection settles to zero; lost replies, server failures and unusable billing receipts keep their reservation. Input-byte estimates and application reservations are not a provider invoice cap: configure provider-side spending controls as well.

`render.yaml` declares the production allowances as synced values. A Blueprint sync can overwrite a dashboard-only lower allowance: persist any desired reduction in the Blueprint and verify the effective settings after synchronization. Changes take effect only after the relevant deployment/Blueprint configuration is applied; changing the Anthropic account limit alone does not change this application's limits. These are AI allowances, not the total website bill, and a higher daily allowance does not override the monthly allowance.

## Publisher identity

Automated publication is bound to an immutable account ID in `app_meta` (`news-desk:publisher-identity:v1`), never to the current holder of `@news_mod`. Existing installations migrate from exactly one historical `news_stories` → `posts` author, including withdrawn stories. Rename, handle reclamation, account deletion and restarts never transfer that binding.

For a new installation with no news history, explicitly set `NEWS_DESK_ACCOUNT_ID` to the reviewed publisher's internal user ID in trusted server configuration. Do not use a handle or add this setting blindly on an established installation. Multiple historical authors, invalid binding evidence or configuration conflicting with the durable identity stop publishing with a sanitized review message; they never silently choose a replacement. An intended account transfer requires operator review of that durable binding and history, not only an environment edit. No live setting is changed by this patch.

Before feed work, before paid publication work and inside the publication transaction, the publisher must still exist and be active: not banned, dormant or currently suspended. Paused identity checks do not start model calls.

## Public and signed-in readers

News items retain their original post author. Bilateral blocks use that stored author, not whoever currently has the news account handle. Signed-in lists and images are private and uncached. A preview rechecks visibility and rendered content after awaiting the renderer; a block, removal, suspension or visible-content change causes rejection rather than delivery of a stale card.

## Downloadable and link-preview photos

Both the portrait download and landscape SEO preview use the same current artwork resolver. It considers at most three exact stored artist identities, using only registered, rights-reviewed catalogue photos with a matching MusicBrainz identity and complete credits. It never exports a scraped article photo, arbitrary provider thumbnail or private member upload. Artist-photo captions describe context, not proof of the reported event; licensed credits remain visible and embedded in the PNG.

The current export-safe artist inventory is small. When no eligible artist photo is available, a clearly labelled illustrative concert photograph is bundled locally (`public/images/news/README.md` records the CC0 source and digest). The 123,830-byte asset is reused across stories without paid image calls, remote lookups or per-story disk copies. Only that fixed bundled asset is admitted; callers cannot request arbitrary local files.

After rendering, both routes recheck the story and image selection, including identity changes or removed artwork. Temporary text/image fallbacks use short in-memory caching and are not publicly HTTP-cached, allowing a recovered artist image to return. Missing artwork never authorizes an unchecked substitute; bounded renderer limits still apply.

Focused regression command: `node --test server/features/newsDesk/newsDesk.test.mjs server/features/newsDesk/newsPublisherIdentity.test.mjs server/features/newsDesk/newsDeskJob.test.mjs`.
