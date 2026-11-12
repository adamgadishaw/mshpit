# iOS native decoder review, November 8, 2026

This is a bounded source and artifact inventory, not a penetration test or general
security certification. No malformed image was decoded, package installed or
changed, native application launched, or production endpoint used.

## Reviewed snapshot

- Signed source: cd06226dc9c3c97fefba3d5bacd8e3629f983bbb.
- Artifact: .tmp/ios-phone-checkpoints/flagship-cd06226/MshpitDev.app.
- Executable SHA256: 55269941b7d0c7de10622eeae976c19813e48d8a3ed5cef119236966810358cc.
- Expo Image 57.0.5 -> SDWebImageAVIFCoder 0.11.1 and libavif/libdav1d 1.0.0
  -> libdav1d 1.2.0, as installed in ios/Podfile.lock.
- Installed dav1d headers identify API major 6. The signed executable's symbol
  table includes SDImageAVIFCoder, avifDecoderCreate, dav1dCodecGetNextImage,
  dav1d_open and dav1d_decode_frame_init. This establishes compiled presence,
  not an observed malicious-input route.
- ExpoImage registers the AVIF coder in
  node_modules/expo-image/ios/ImageModule.swift:355.

## CVE-2024-1580: affected version, reviewed-path mitigation

VideoLAN's 1.4.0 release notes identify the integer-overflow fix. The exact
upstream change makes the tile-start-offset arithmetic unsigned because a pixel
offset can exceed signed-int range:
https://github.com/videolan/dav1d/commit/2b475307dc11be9a1c3cc4358102c76a7f386a51
https://github.com/videolan/dav1d/blob/master/NEWS
https://nvd.nist.gov/vuln/detail/CVE-2024-1580

The installed version is in the affected upstream range, but the reviewed
ExpoImage/libavif path has two relevant constraints:

1. libavif/src/codec_dav1d.c:60-77 sets max_frame_delay=1 for API major >=6.
   Installed dav1d/src/lib.c:102-118 computes frame contexts as the minimum of
   that nonzero delay and worker count. SDWebImageAVIFCoder sets maxThreads=2,
   so this path has two workers but one frame context, not two frame contexts.
2. The affected tile-start-offset calculation in installed
   dav1d/src/decode.c:2990-3001 is inside n_fc > 1. Its setup_tile call at
   :3347-3348 passes zero when that condition is false. Thus this reviewed
   configuration does not enter that particular multi-frame calculation.
3. Independently, libavif's decoder defaults imageSizeLimit to 16384*16384
   (268,435,456 pixels). avifDecoderParse rejects zero or a higher value.
   codec_dav1d forwards the limit and dav1d/src/obu.c:1316-1322 checks frame
   area using int64_t before frame decoding. The coder's static and animated
   paths both use avifDecoderCreate with the same defaults and do not
   override that limit.

These observations support a source-level mitigation for this CVE on the
reviewed AVIF path. They do not prove all native image paths, other decoder bugs,
resource exhaustion, future configuration changes or malformed inputs safe.
No runtime exploitability or non-exploitability certification is claimed.
The dependency remains unpatched; this path-specific mitigation does not close
the package-level advisory.

## Update decision

Do not disable AVIF or force a Pod override merely from the version number.
The public CocoaPods libdav1d page still lists 1.2.0, matching the locally cached
registry inventory; no newer compatible registry update was established:
https://www.cocoapods.org/pods/libdav1d

A future maintained ExpoImage/SDWebImage/native-codec update needs an isolated
compatibility review, pinned source/provenance, rebuild/signature verification
and native static/animated AVIF format, cancellation and memory tests. Upstream
dav1d 1.3.0 also records an ABI break, so a blind binary replacement is not a
supported fix. Recheck this mitigation on any coder, libavif, thread-setting or
decoder change. No dependency or lockfile was changed in this review.

## Evidence fingerprints

- ios/Podfile.lock:
  92840d4857bca029637fba4b70e8025e2988a06496cb98df215f07228fa52d8d
- ios/Pods/libavif/src/codec_dav1d.c:
  58a336a67be236362217cb83d7bbdb42ba27c2243ebccb55008f46e48de90a3b
- ios/Pods/libdav1d/dav1d/src/lib.c:
  b94d888e374bed8c07c7a857c66e34edf78db9ccdfd0aa3f9ad3ae8a7e9646e5
- ios/Pods/libdav1d/dav1d/src/decode.c:
  459d6ec01128a682a8c9e7aa126d6e44b2df7518c8fdd7d42821ed4b11beb3b4
- ios/Pods/libavif/src/read.c:
  327ee7b065263b82c4ac4813abc2d07116e22645406a548ddcbd867227a05ce3

## Audit scope correction

The old npm --omit=dev result covers the server dependency graph. Expo, React
Native and most mobile dependencies are declared as devDependencies here, so
that result cannot clear the native app or CocoaPods. The October advisory
ledger now has a dated November status note: the braces advisory was withdrawn;
node-forge remains a host-toolchain finding with no patched version listed.
No fresh bulk npm audit or repository/dependency-graph upload was performed.
