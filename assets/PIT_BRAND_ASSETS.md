# PIT app icon asset record

Prepared: **2026-08-14**

These versioned files replace the Expo starter artwork in the native and web
configuration:

- `pit-icon-v1.png` - opaque 1024 x 1024 App Store icon source.
- `pit-splash-icon-v1.png` - transparent 1024 x 1024 splash foreground.
- `pit-android-foreground-v1.png` - transparent adaptive-icon foreground.
- `pit-android-background-v1.png` - solid `#0d0b09` adaptive background.
- `pit-android-monochrome-v1.png` - alpha-only themed-icon mask.
- `pit-favicon-v1.png` - 48 x 48 web favicon.

The source mark was generated specifically for PIT with OpenAI image generation
and then resized/converted locally. It does not incorporate a supplied
third-party logo or stock photograph. The selected prompt was:

> Make an ultra-simple geometric PIT icon: one bold gold P-shaped monogram
> where the bowl is a circular concert pit and a single diagonal negative-space
> spotlight cuts through it. Use only two or three flat shapes. Use a full-bleed
> opaque near-black background and warm PIT gold. Keep it centered, legible at
> 32 px, and safely padded for iOS masks. Do not add text, people, instruments,
> rounded corners, borders, mockups, or watermarks.

This record is engineering provenance, not trademark clearance. The owner must
approve the mark and confirm the PIT name/mark before the first public store
submission. A release-build device check is still required because Expo Go and
development builds do not exactly reproduce the native splash screen.
