# Account access and signup lifecycle

- A normalized email can have at most two accounts. SQLite insert/update triggers enforce this under concurrent writers.
- Signup never updates an existing account. A different password creates a separate unverified account when a slot is available, and opens that new account's restricted setup session. Matching credentials return an explicit existing-account choice, with no session or row created until selected. Creating a second matching-password account requires the explicit second-account action. A full email returns a two-account-limit error, never a misleading confirmation.
- Login performs two password checks. One match signs in; two matches return a minimal chooser without issuing a session. Selecting an account rechecks the password for that exact ID.
- Login rechecks the authenticated password-hash snapshot and email inside the session-creation transaction. A concurrent reset or password change cannot leave a stale old-password login valid.
- Account switching is available in Settings and the account dropdown. Links require the exact supplied password to verify independently against both salted password hashes. Both accounts must be verified before switching. A browser-bound grant permits later swaps without another password. Older sessions connect once; changing either password, email, privilege or moderation state revokes links. Switching rotates the session and preserves the original privileged-session expiry cap. Sharing an email alone never authorizes access.
- Password changes revoke sessions and recovery tokens only for the selected account. Recovery emails identify the account and use separate tokens. Shared inbox access can recover either account.
- New accounts have `onboarding_version=0`. Only Finish setup advances it. Verification does not finish setup. Existing accounts without a version are exempt, never treated as disposable drafts.
- An authenticated unfinished account cancels with its current password. The account-specific hashed cancellation capability remains supported for compatible clients; it never grants login. Duplicate matching-credential signup returns a choice rather than a cancellation capability.
- Cancellation calls the existing transactional account-erasure path and schedules owner-wide upload cleanup. Completion, cancellation and password changes are serialized by SQLite. A completed account cannot be deleted through the signup-cancellation path.
- Closing a tab or losing a connection does not immediately delete the account. Sign in to resume or cancel. All accounts except Owner, including unfinished ones, follow the disclosed 365/730-day inactivity policy; see [account-inactivity.md](account-inactivity.md).
- Photos and banners are part of the signup walkthrough. Email confirmation is required before uploads; the walkthrough includes a confirmation/resend control. Setup can finish before verification without uploading photos.
- Unverified sessions cannot post, message, follow, react, or edit public profile fields. Recovery, export, cancellation/deletion, reports, blocking and strictly private settings remain accessible through narrow checked exceptions. A privacy update cannot piggyback a bio or public field.

## Focused security and UX audit

Fixed false signup success, implicit Owner fallback, unavailable account swapping, unverified public mutations, a stale-password session race, and post-commit activity bookkeeping turning successful writes into failures. Bio tests cover SQL-shaped text as literal content, escaped HTML/structured data, executable URL rejection, upload ownership, and forged role/verification fields. These tests found no bio injection exploit in the existing escaping and ownership controls.

Local browser checks cover 320/390/844/1280px layouts, explicit duplicate signup choice, linked and older-session account switching, avatar/banner upload and refresh, failed-save retry, cancellation, per-account password change, and expired verification recovery. Network calls are mocked in those browser checks. Separate localhost HTTP regressions use real signup, verification, session cookies and protected routes against isolated temporary databases. This is focused code and regression testing, not a production penetration test or a claim that vulnerabilities are impossible.

Existing accounts are neither merged nor manually repaired by this implementation. Production account counts, delivery permissions, and deployment health still require operational verification; no production account was deleted during development.

## Deployment safety

`start-production.mjs` takes the existing consistent pre-migration backup before importing the database. The shared-email migration rebuilds only `users`, retaining every column and ID, indexes, triggers, views, and child foreign keys. It checks row counts and foreign keys before commit and restores foreign-key enforcement on both success and failure. Unexpected duplicate groups fail closed instead of deleting or merging accounts. The locked Owner is resolved by ID, not the first row sharing its email.

Do not roll back to code that assumes one account per email after creating a second account. Restore a reviewed backup only through the established recovery procedure; never replace a live database with an empty file.

Regression coverage: `server/sharedEmailAccounts.test.mjs`, existing auth/onboarding/privacy suites, and mobile web signup, photo upload, cancellation, password chooser and Settings checks.
