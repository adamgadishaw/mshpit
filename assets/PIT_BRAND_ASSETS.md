# MSHpit community-mark asset record

Prepared: **2026-08-31**

The v2 identity replaces the earlier P-shaped monogram with MSHpit's circular
community mark: two rings of people surrounding an open center. The mark is a
clean geometric vector reconstruction based on the visual reference supplied by
the product owner on 2026-08-31. The compressed JPEG reference itself is not
shipped in the application.

Source artwork:

- `mshpit-community-mark-v2.svg` - the single transparent vector master.

Generated platform assets:

- `pit-community-mark-v2.png` - transparent 1024 x 1024 full mark.
- `pit-community-mark-small-v2.png` - transparent 256 x 256 raster of the
  exact full mark for efficient interface rendering.
- `pit-icon-v2.png` - opaque 1024 x 1024 App Store icon source.
- `pit-splash-icon-v2.png` - transparent 1024 x 1024 splash foreground.
- `pit-android-foreground-v2.png` - transparent adaptive-icon foreground.
- `pit-android-background-v2.png` - solid `#0d0b09` adaptive background.
- `pit-android-monochrome-v2.png` - alpha-only themed-icon mask.
- `pit-favicon-v2.png` - opaque 48 x 48 web favicon.

The vector master and all raster derivatives are reproducible with
`node scripts/generate-brand-assets.mjs`. The social share card is reproducible
with `node scripts/generate-og-image.mjs`. The stable public `/logo.svg` URL uses
the same community geometry so existing indexed pages and structured-data links
do not need to migrate. Every active size uses the same two-ring geometry; there
is no alternate small glyph.

This record documents engineering provenance; it is not trademark clearance.
The product owner supplied and selected the reference and must still confirm
that MSHpit owns or is licensed to use the final mark before a public store
submission. A release-build device check remains required because Expo Go and
development builds do not exactly reproduce native icons or the splash screen.
