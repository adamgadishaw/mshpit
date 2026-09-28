# News cadence and photo cards — 2026-09-27

## Approved behavior

- Up to two sufficiently supported stories in each existing Toronto slot:
  08:00, 11:00, 14:00, 17:00 and 20:00, with the existing 30-minute grace.
- Ten publications maximum per local day. Withdrawn stories still count;
  restart or concurrent passes cannot reopen consumed capacity.
- No off-slot catch-up or forced filler. Three independent publisher groups
  remain preferred; the existing empty-day two-publisher fallback remains
  limited to one story and cannot cover death/legal reporting.
- At most three paid attempts per serial pass, with the existing 180-second
  deadline. Paid declines, late completions and uncertain calls remain charged.
- News admission allowances: $0.75/day and $15/month; shared Claude ceiling:
  $20/month. Catalogue remains $0.30/day and $4/month. Money calendars use UTC,
  while publishing slots use America/Toronto. Provider limits are separate.

## Photos without per-story storage growth

Portrait downloads and 1200x630 link previews share an exact-identity artwork
resolver. It checks at most three stored artist keys and their current MBIDs.
Only rights-reviewed, first-party-mirrored catalogue photos with matching
registered attribution enter exports. No RSS, Spotify/Deezer thumbnail or
private member image is substituted. The current artist export inventory
contains only one artist; this change does not claim to fill that catalogue.

Other stories use a clearly labelled illustrative live-music photograph,
bundled once (123,830 bytes). Its public-domain source, author and digest are
recorded in `public/images/news/README.md`. The local loader accepts only its
fixed identifier and hash-pinned bytes: it cannot read arbitrary paths or
fetch a user URL. There are no paid image calls, new worker, database migration
or per-story file copies.

Both routes recheck story visibility and the selected image after rendering.
Temporary fallbacks expire after five seconds in the existing bounded cache
and do not enter shared HTTP caches. Generic image captions cannot masquerade
as a photo of the reported event. Long headlines ellipsize within safe areas.

## Verification and rollout

Regression coverage includes two-per-slot/day limits, concurrent publication
and decline claims, paid receipt preservation, slot closure, DST and month
boundaries, image revocation, fixed-file access, cancellation, PNG dimensions,
attribution, fallback recovery and attendance-image restrictions. Actual
portrait/landscape PNGs were visually inspected with sample news copy.

Production web export passes with unchanged initial JavaScript (511.8 KiB
gzip) and includes the photo. Full default and hosted-settings suites pass;
the render schema, architecture and syntax gates also pass.

These changes belong to `codex/social-privacy-player` / PR #13. A local test
or branch push is not evidence of production activation: merge/deploy and
Blueprint synchronization must be verified. Synced Blueprint values can
replace dashboard-only lower limits; persist reductions in `render.yaml`.
