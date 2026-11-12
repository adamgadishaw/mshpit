# iOS photo upload failure after device feedback

## Reproduced cause

The source at the reported installed revision `bcd30cb` and the integration base both inspect upload MIME signatures with `firstMediaBytes` in `src/lib/mediaUpload.js`. That helper prefers `body.slice(0, 96)` over the native `File.open()` path. This happens after picker/normalization and before `/api/media/presign`.

The installed Expo 57 `expo-file-system/src/File.ts` implements `slice()` as `new Blob([this.bytesSync().slice(start, end)], ...)`: it reads the entire file into JS, then constructs a Blob from a Uint8Array. The installed React Native 0.86 `Libraries/Blob/BlobManager.js` explicitly throws for ArrayBuffer and ArrayBufferView parts. React Native installs that Blob globally; this app has no replacement Blob polyfill. Expo's own winter fetch helper also documents this native Blob limitation.

`mediaUpload.nativeRead.test.mjs` executes the installed Expo slice method body and the installed React Native binary-part guard, with isolated file/transport seams. Before the fix, native MIME inspection and the complete upload path throw the actual `Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported` error before requesting any ticket. Browser Blob preparation succeeds, explaining why browser upload coverage did not reveal it.

This is a reproduced client defect on the reported revision, independent of account identity and selected-photo quality. There is no captured device exception from Adam's specific attempt, so it is not a claim that every possible account, iCloud, or storage failure on the phone has been excluded.

## Changes

- Prefer the native read-only file handle (`open("r")`), read at most 96 bytes, close in `finally`. The original file stays untouched and the transport still receives the streaming Expo File.
- Preserve browser Blob inspection and the shared default/web exported API contract.
- Capture local file opening/signature-reading errors as `PIT-UPLOAD-008`, with instructions to open/download the original in Photos or Files and choose it again. Approved crop normalization failures use the same local-preparation category. Unsupported media still has its separate validation category; account/API errors are not remapped.
- Local preparation diagnostics do not claim a storage PUT occurred. Stored diagnostics and inline errors omit private device paths, raw native exceptions, and credentials.
- Make generic transfer-failure text actionable. The iOS banner crop preserves safe API/account guidance and its current crop on failure rather than replacing every error with a generic retry sentence.
- Preserve private staging, server sanitizer/finalizer, descriptor matching, initiating account identity, abort/deadline behavior, cache cleanup, and draft-only assignment until profile Save.

## Verification

68 focused tests pass using Node 24:

```sh
node --test src/lib/mediaUpload.nativeRead.test.mjs \
  src/lib/mediaUpload.test.mjs src/lib/mediaUpload.security.test.mjs \
  src/lib/mediaUpload.lifecycle.test.mjs src/lib/mediaUpload.deferred.test.mjs \
  src/lib/errorCatalog.test.mjs src/lib/diagnosticsPrivacy.test.mjs \
  src/components/profileBannerCropIOS.test.mjs
```

The new fixture verifies bounded read-only access, short files, handle closure on error, no full-file Blob allocation, signature-based MIME detection, browser behavior, owner-bound presign/transfer/finalize success, cleanup, pre-ticket local failures, account restrictions before transfer, and network failure before finalization. Crop component tests cover actionable account/local errors, privacy, and retained retry controls. Existing editor fixture tests confirm failed/cancelled upload preserves the prior photo and successful upload is persisted only on Save.

Read before edits: [Expo 57 SDK](https://docs.expo.dev/versions/v57.0.0/), [ImagePicker](https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/), [ImageManipulator](https://docs.expo.dev/versions/v57.0.0/sdk/imagemanipulator/), and [FileSystem](https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/), including `File.open`, read-only mode, `FileHandle.readBytes`, `close`, and the upload task contract. The filesystem Markdown endpoint was used because the browser fetch failed.

No phone access, installation, signing/dependency changes, deployment, live profile writes, or commits. Actual Photos/HEIC processing, network storage transfer, and final profile appearance still need a device smoke check on a rebuilt candidate.
