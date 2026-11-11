# Content-aware iOS post cards

## Scope and integration

This local candidate starts from the reviewed retained-detail navigation source
`0fd3007`. It is a presentation-only follow-on. It does not install or launch an
app, push or deploy, change the API/database, add dependencies, alter signing,
or authorize the held notification rollout. Integrate the single card commit
onto the selected reviewed navigation branch, then validate that exact combined
source before a separately authorized build or installation.

Android/web continue to use the byte-unchanged `TicketStub.jsx`. iOS resolves
`TicketStub.ios.jsx`; all current callers use extensionless imports. Shared
canonical domain projections and the reviewed `useTicketPresentation` ownership
hook remain authoritative. `usePostCardData.ios.js` is the narrow existing Store
binding; it performs no new read, subscription, state mutation or API request.
The architecture budget and Store hook ratchets are unchanged.

## Layout contract

- A consistent card surface, border, inset and inter-card gap separates text,
  photo and concert posts. Photo statuses no longer weaken their outer border
  or insert decorative registration stripes.
- Author identity comes first. The score belongs beside the concert title,
  rather than competing with the author's name. Narrow widths and large text
  stack the score below the full title without truncation or font shrinking.
- Venue/city and date use a quieter hierarchy. Date-only posts do not start
  with a dangling separator. Reviews and media remain ahead of secondary data.
- One disclosure summarizes the canonical number of acts and songs, with every
  saved act, individual rating, note, linked review, address, attendance count,
  comparison route and setlist still available. Tour spoiler protection remains.
- Disclosure choices are scoped to the post, account, card mode and kind. A
  retained same-post return preserves choices; recycled posts/accounts do not.
  Toggling several choices in one update preserves each choice.
- Campaign cards size to real content. A genuine background gets an artwork
  window; a gradient-only campaign gets no fixed minimum or empty 50-point band.
  Badges and artwork controls wrap. Trusted campaign colors and artwork access
  remain intact.
- An absent overall rating no longer appears as a zero-star review. Available
  factor ratings remain accessible even when the overall score is absent.
- Likes, comments, repost/share, tags, owner actions, reporting, long press, media
  openers and retained/presentation privacy guards retain their existing owners.
  YouTube opening and delayed failure alerts now also check current-card ownership.

## Maintainability

The platform file removes the obsolete web/Android rendering branches and the
stack of overridden styles from the iOS implementation. It uses the existing
canonical helpers rather than a second normalization/data model. Shared behavior
fixes should be checked against both platform renderers; iOS interaction tests
now execute the actual iOS module and data hook, including real React retained
lifecycle fixtures. The default-platform render hashes remain pinned.

`postCardPresentation.ios.mjs` defines the content/stacking policy.
`node scripts/verify-ios-post-card-layout.mjs` optionally compiles the installed
React Native Yoga source for an offline geometry check. It reads production
style values and uses the production stacking decision across 320–768-point
viewports, text scales 1–3, and short/long titles. Its text measurement is
synthetic, with explicit pixel-rounding tolerance; it is not native typography,
VoiceOver, gesture, screenshot or performance certification.

## Validation and remaining acceptance

The final receipt below records only checks actually completed on this source.
Two broader serial-suite attempts were interrupted when executor connectivity
ended their processes; neither is a passing full-suite result. Their incomplete
logs are preserved locally. No background validation process is assumed alive
without checking its process/receipt.

The in-app browser is unavailable, browser inventory was empty, and native Safari
inspection timed out through the connected UI tool. A synthetic HTML preview was
prepared but not visually inspected. No alternate automation route was used.
Physical iOS layout, real text metrics, dark/light themes, VoiceOver order/focus,
large-text reachability, campaign artwork composition and finger-driven actions
remain explicit acceptance work on an authorized isolated fixture.

Before release, inspect short/long reviews, no-review/rating-only posts, online
reviews, festival/co-headliner details, sparse metadata, one/many photos/videos,
text statuses, attendance tickets and campaigns with/without artwork. Open and
close score/details/spoilers repeatedly; navigate away/back, change account or
post, and confirm actions still target only their current post. Do not exercise
synthetic sends/deletes/reports or other mutations against the live-linked app.

### Final local receipt

- Independent review: no demonstrated regression in the final UI/data binding.
- Focused component/domain/lifecycle tests: **57/57** passed.
- Installed native Yoga title/score geometry: **60/60** passed. This tests only
  that sublayout with synthetic text measurement, not complete native cards.
- Syntax: **930 Node files**; architecture: **144/144 Store hooks**, including
  **47/47 state hooks**; no architecture rule or allowance changed.
- Server-only production dependency audit: **0 vulnerabilities**. This does not
  supersede the existing native decoder advisory or audit native dependencies.
- Render Blueprint schema/reference check: passed; no live sync implied.
- iOS and Android Hermes production exports: passed. The three new iOS runtime
  files match the exported iOS source-map content exactly; the default card
  implementation is absent from that iOS export.
- Web production export/budget: **524,206 / 524,288 gzip bytes**, unchanged from
  the reviewed base, with **82 bytes** of headroom.
- Android/web export isolation check: passed. No app iOS implementation leaked
  into either platform. The shared/default card source remains byte-identical.
- Whitespace check: passed.

The complete suite is intentionally left to one fresh aggregate on the final
combined clean navigation/card source, as coordinated with the integration owner.
The interrupted local suite attempts are not counted as passes. No native app
build, physical installation, visual acceptance or release approval is claimed.
