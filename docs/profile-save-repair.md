# Profile editing repair

Base: `b56c58089f5e25e232e10e8ba2ae15458df13a8b` (`origin/master`, independently checked with `git ls-remote` on 2026-11-10). Work was prepared in an isolated clone; the notification release checkout and production profile were not changed.

This is the alternative native integration of primary fix `f6d5339`, prepared against `942e1f3` in a second isolated checkout. Apply either the primary fix to deployed master or this companion to the matching native branch; do not apply both. Screen overlap was resolved by keeping the native close guard import and `requestClose`, `iosEditor.confirmed`/`locked` gates, and all `command.isCurrent()` fences around picker/upload results, errors and cleanup. Native fixture expectations now assert that an unchanged avatar remains in the preview and is omitted from the sparse payload.

## Findings and changes

- The public profile for the reported `mshpit_admin` account has `genres: []`. The personal editor unconditionally required 1–3 genres and disabled both Save controls even for a photo or text edit. The editor now validates genres only when that field changes.
- The editor previously submitted a full snapshot. It now compares against its initial draft and sends only deliberate edits, avoiding stale pins, legacy fields, and unrelated session updates blocking or being overwritten by a photo save. Changing genres still requires 1–3 selections; server ownership, verification, and media validation remain unchanged.
- An explicit empty bio was skipped by the server's optional-field parser. The profile route now honors that edit while leaving the shared parser unchanged.
- Picker/upload errors now remain visible beside the photo controls while retaining the previous image and allowing retry. This also covers failures that occur before a global diagnostic is recorded.

## Validation

All new test data is synthetic; server tests use temporary databases and in-memory object storage. The real editor is rendered with React, with device/network boundaries mocked.

```
node --test src/screens/profileEditDraft.test.mjs server/profileCustomization.test.mjs server/mediaLegacyFinalize.test.mjs src/lib/mediaUpload.lifecycle.test.mjs src/domain/signupProfileStore.test.mjs src/domain/profileImagePolicy.test.mjs server/accountMutationAccess.test.mjs
node scripts/check-syntax.mjs
node scripts/check-architecture.mjs
git diff --check
```

The initial regression set failed seven cases against the untouched base and passed with the fix. Coverage includes empty existing genres, sparse photo/text saves, failed-save draft retention and retry, unrelated session refreshes, explicit bio clearing, edited invalid genres, persistent upload failures, real image finalization and profile readback, and foreign/wrong-purpose/retired media rejection.

Expo SDK 57 index, ImagePicker and ImageManipulator documentation were read before editing. No SDK or native picker API was changed.

## Remaining device verification

The reported iPhone failure to change the photo before Save has not been reproduced on a physical device. Mocked iOS selection/upload succeeds and the confirmed empty-genre Save blocker affects iOS too, but this does not prove the cause of the separate native selection/upload symptom. Capture the installed build identity, whether selection/cropping completes, and its inline error or Diagnostics entry (operation, stable code, server code, status, request ID) without including tokens or photo bytes. A successful save on the real account would mutate production data and was not attempted.
