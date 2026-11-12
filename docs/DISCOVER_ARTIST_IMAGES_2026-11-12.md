# Discover artist image follow-up — 2026-11-12

Base: installed Build 9 source `646e482a4da448f512768f30398e3b5c9210b598`.
Branch: `fix/artist-discover-images-20261112`.
Isolated checkout: `C:/Users/Adam Gadishaw/Documents/Codex/2026-11-11/task-4/artist-discover-images-20261112`.
The obsolete standalone venue-search base was not used. Other checkouts and the
prior venue artifacts were not changed.

## Finding and reproduction

The bundled Drake record contains an existing Spotify image URL. Profiles read
current stored metadata through `publicArtist` and render `spotifyPhoto` only
with a validated source link, Spotify credit and `original` display policy.
That path deliberately keeps Spotify images out of generic cropped/proxied
`photo` fields.

`discoverService.chartRow` retained that exclusion but only offered a separate
Deezer Discover image as a fallback. Without that optional image, Discover
returned `photo: null` and dropped the already available original-only image.
Both the shared web/Android card and the independent iOS rails read only `photo`.
This was a missing projection/rendering contract, not a need for replacement
imagery or provider lookup on every card.

Two focused tests failed against the unchanged runtime source before the fix:
the local SQLite Drake-shaped record produced a valid profile image model but
null Discover image models; the actual card function produced no image from the
valid original-only fields. The regression uses Drake's existing catalogue image
URL with local fixture identity metadata. It does not assert that a live server
or installed phone was inspected.

## Final behavior

- Discover reuses `publicArtist` and the profile image validator, projecting only
  the five public display fields when a generic/Discover image is absent. No
  metadata blob, refresh internals or extra API/provider calls are exposed.
- Existing generic and Discover-specific Deezer images keep their priority.
  The client validates original-image provenance before selecting that fallback.
  Normalization already preserves these fields; Store cache behavior is unchanged.
- Popular and genre grids on web/Android and the iOS artist/spotlight rails use
  the same artwork selector. Original images are direct, contained, subtly rounded
  and have no rank/badge overlay. Grid rank moves beside the name.
- A separate source control opens the exact supplied Spotify artist URL. It is
  a sibling of artist navigation, avoiding nested links or diverted card presses.
  Artist navigation retains the original canonical row.
- Missing/invalid fields show initials. A failed image falls back to initials;
  an old URL's failure does not poison a different replacement URL. No unrelated
  artist image is borrowed and no fan media is promoted into identity artwork.
- Existing account visibility, moderation and block checks run before projection.
  Tests cover private, blocked and removed member-created identities.
- The supplied Spotify mark is preserved exactly as an SVG asset instead of
  moving its large inline path module into startup JavaScript. A regression
  compares all four paths and its viewBox with the existing mark.
- The shared original-image validator now validates both complete canonical URLs
  together. Its only externally used export remains `spotifyArtistPhotoModel`;
  unused internal URL-helper exports were removed. It keeps the frozen model,
  host/path/HTTPS/credential/port protections and rejects even empty query/hash
  suffixes. No profile renderer or image source was changed.

## Focused validation

| Check | Result |
| --- | --- |
| Before-fix API/card regressions | Both fail for the expected missing-image assertions |
| Focused server/profile/Discover/native/validator/recovery tests | 111 pass, zero fail/skip |
| Exported web browser | Four pass: guest/member at 375/1280 px |
| Browser states | Profile and both popular/genre cards use the same original; missing, invalid, broken, replacement and generic image cases pass; no remote identity resolver calls |
| iOS function-render fixtures | Artist rails and spotlight use direct contained artwork, sibling credit and canonical navigation; existing event, fallback, large-text and browse-return checks pass |
| Web export and startup budget | Pass: 524,282/524,288 gzip bytes; six bytes headroom |
| iOS export | Pass; includes the unchanged supplied logo as an SVG asset |
| Architecture | Pass with unchanged allowances |
| Changed server/browser script syntax and whitespace | Pass |

Browser screenshots use a deliberately plain purple rectangular fixture, not
Drake photography. All image responses are intercepted locally; external requests
are blocked. The mobile Discover result was visually inspected. This checks real
web rendering and native component contracts, not native image decoding on a
device. No phone, simulator, production writes, provider ingestion or deployment.

The broad aggregate suite and dependency audit were not repeated for this focused
follow-up, as requested. No dependencies, native configuration, schema or policy
allowances changed. Final command logs, screenshots, post-stage privacy checks,
exact file hashes, patch and bundle accompany the delivery.

## Integration and ownership

Both `server/discoverService.js` and the client changes are required: the existing
server omits the original-image fields. No migration, catalogue repair or new
image ingestion is needed. Old clients safely ignore the additional fields.

This patch touches neither review detail/Top Take nor RSVP/calendar eligibility,
Store, App navigation or the profile renderer. The only shared profile dependency
is `src/domain/spotifyArtistPhoto.mjs`, covered by the profile and URL-validation
tests. The iOS Discover renderer and its tests are included explicitly in the file
manifest. Preserve the separate owners' follow-ups and both STATUS entries.

Startup headroom is extremely small; the integration owner must rerun the budget
gate on the combined source. This isolated passing result does not certify a
later combined bundle or installed build. Nothing was merged or published.
