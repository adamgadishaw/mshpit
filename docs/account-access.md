# Account access and signup lifecycle

- A normalized email can have at most two accounts. SQLite insert/update triggers enforce this under concurrent writers.
- Public duplicate signup remains neutral and never updates an existing account. A second account is created explicitly in Settings using an authenticated, verified account and its current password.
- Login performs two password checks. One match signs in; two matches return a minimal chooser without issuing a session. Selecting an account rechecks the password for that exact ID.
- Password changes revoke sessions and recovery tokens only for the selected account. Recovery emails identify the account and use separate tokens. Shared inbox access can recover either account.
- New accounts have `onboarding_version=0`. Only Finish setup advances it. Verification does not finish setup. Existing accounts without a version are exempt, never treated as disposable drafts.
- Cancel signup from the initiating form uses a random, hashed cancellation capability. Duplicate-signup responses contain an indistinguishable inert capability. It never grants login. An authenticated unfinished account can also cancel with its current password.
- Cancellation calls the existing transactional account-erasure path and schedules owner-wide upload cleanup. Completion, cancellation and password changes are serialized by SQLite. A completed account cannot be deleted through the signup-cancellation path.
- Closing a tab or losing a connection does not delete or expire the account. Cancellation credentials are not persisted in browser storage. If the initiating form is lost, sign in to resume or cancel.
- Photos and banners are part of the signup walkthrough. Email confirmation is required before uploads; the walkthrough includes a confirmation/resend control. Setup can finish before verification without uploading photos.

## Deployment safety

`start-production.mjs` takes the existing consistent pre-migration backup before importing the database. The shared-email migration rebuilds only `users`, retaining every column and ID, indexes, triggers, views, and child foreign keys. It checks row counts and foreign keys before commit and restores foreign-key enforcement on both success and failure. Unexpected duplicate groups fail closed instead of deleting or merging accounts. The locked Owner is resolved by ID, not the first row sharing its email.

Do not roll back to code that assumes one account per email after creating a second account. Restore a reviewed backup only through the established recovery procedure; never replace a live database with an empty file.

Regression coverage: `server/sharedEmailAccounts.test.mjs`, existing auth/onboarding/privacy suites, and mobile web signup, photo upload, cancellation, password chooser and Settings checks.
