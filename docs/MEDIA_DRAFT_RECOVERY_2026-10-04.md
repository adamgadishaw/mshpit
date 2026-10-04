# Same-grant draft recovery

Review branch: `codex/media-draft-recovery-20261004`, based on released master
`a74c0028f1dccefee1fd661e4f8f1799fe684e04`.

The Owner approved extending existing and future `news:write` grants with one
exact read so an interrupted workflow can recover an already-saved draft.

## Contract

`GET /api/media/v1/news/drafts/:id` uses the existing bearer authentication and
feature switch. It requires an active, unexpired, unrevoked `news:write` grant
and the existing current-account checks. Authority is rechecked before return.

The row must have `status=draft`, `origin=self_written`, matching `created_by`
and an exact non-null `created_grant_id`, with no published post ID. All missing
or ineligible records return the same 404. There is no list or update route.

The response is `{ draft, requestId }` through the normal HTTP dispatcher. Draft
fields are `id`, `status`, `origin`, `headline`, `summary`, `body`, `category`,
`sources`, `photo`, `revision`, `expired` and `createdAt`. Photo metadata reuses
the existing owned, ready-media verification and returns only its public render
URL and attribution; unavailable media has a null URL. Internal report/result
fields, writer/grant details and private storage locations are not returned.

Successful responses use `Cache-Control: private, no-store`; errors retain the
shared `no-store` envelope. Reads have a 60-per-minute route admission limit and
do not create receipts or audit writes, publish, refresh a draft's lifetime,
fetch providers or alter the existing create/publish retry contract. An expired
draft can be recovered with `expired=true`; existing publication expiry remains.

The caller needs the saved draft ID. If the create response was lost before its
ID was recorded, replay the original create body and idempotency key within the
existing receipt window. This endpoint deliberately cannot discover drafts.

## Validation and release

Focused unit and real HTTP coverage checks exact owner/grant isolation, legacy
and published exclusions, missing/scope/expiry/revocation failures, current
account restrictions, response projection, photo safety, no list/update routes,
disabled exposure, read-only database effects and unchanged receipt replay.

- All 38 focused Media API unit/HTTP and Newsroom editor tests passed.
- Architecture, syntax (823 Node files) and diff checks passed. Independent review found
  no blocking issues and passed all 27 Media API tests plus the three final
  recovery regressions after the end-of-read authorization check.

Full cloud CI remains required before release. No production request, paid provider call,
grant issuance, feature activation, merge or deployment is part of this patch.
No schema migration or dependency change is required.
