# Account foundation: security and data-integrity audit

## Executive assessment

This review found reproducible account-boundary and consistency defects, not evidence that every authentication primitive needs replacing. The most important repaired defect was a stale screen action being dispatched under a newly selected account. Other confirmed defects involved partial social writes, relationships that could not be revoked after content became inaccessible, comment submission races, inconsistent password-check work, and incomplete integrity diagnostics.

The review was performed on September 12, 2026, starting from commit `a3e90e35f60d694c615f39a5a1df3883fd8c34be`. It combines repository inspection, negative tests against synthetic accounts, actual localhost HTTP/browser sessions, a read-only local database scan, and primary-source security research. It is not a production penetration test, a compliance certification, or a claim that all vulnerabilities have been found.

No production account, post, credential, or database record was changed by the audit. Existing account IDs, the two-account email policy, optional profile setup, guest discovery, and the owner's inactivity exemption remain intact. Unfinished registrations were not purged. No new authentication provider or paid service was introduced.

The remaining priorities are substantial: versioned stronger password hashing, privileged-account MFA, an explicit policy for pending-account slot abuse, evidence of a production restore drill, and confirmation of storage/CDN revocation behavior. These are open items, not completed safeguards.

## Scope and evidence rules

The reviewed layers are request admission; signup and verification; session issuance and switching; authorization after asynchronous work; client mutation ownership; social relationships and comments; media ownership and publication; database consistency; recovery, deletion, and operations.

- **Fixed:** a failing case was reproduced in an isolated test and the relevant implementation changed.
- **Covered:** existing controls were inspected and exercised by focused regressions. This does not imply exhaustive attack coverage.
- **Open:** a code-level limitation or product tradeoff remains.
- **Unverified:** evidence depends on production configuration or state unavailable during this pass.

Severity describes potential impact and prerequisites, not a CVSS score. Authentication failure, authorization denial, availability failure, and a client render exception are different incidents. A successful check today does not invalidate an earlier outage; conversely, earlier server errors do not establish a present account takeover.

The localhost real-server runner creates its own synthetic SQLite database, uses the actual server entry point and cookies, blocks external network traffic, and removes the temporary fixture afterward. The exported-app browser runner uses mocked API responses. Neither sends attack traffic to production. The persisted local database was opened read-only and only counts were emitted; it is not a verified copy of the current Render database.

## Account and interaction contract

Authorization must depend on the live session and the requested object's relationship to it. A displayed button, user ID, email address, or cached role is not authority. OWASP recommends default-deny permissions and checking access on every request; its API guidance calls for object-level checks wherever an identifier selects a record. [Authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), [API object-level authorization](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/).

| Account state | Read behavior | Write behavior | Recovery and privacy |
| --- | --- | --- | --- |
| Guest or expired session | Public artist, venue, city, show, and shared-review snapshots; no member feed/history API | Social actions require authentication; no replay of a pending like after login | Login, signup, and recovery entry points |
| Signed in, email unverified | Permitted account-bound browsing; visibility filters still apply | Public profile changes, posting, reactions, following, messaging, and new uploads denied | Narrow checked exceptions for verification, export, cancellation/deletion, safety, and private settings |
| Verified member | Member surfaces subject to audience, block, and active-account rules | Only authorized actions on owned or accessible objects | Own settings, password change, export, and deletion |
| Dormant, banned, or suspended | Restricted according to route and account state | No ordinary social publishing; an old cookie cannot bypass restrictions | Rights-preserving routes retain credential/ownership checks |
| Target becomes inaccessible | Hidden target content remains hidden | New interactions denied; remove own existing follow/like without reading target | No access to another account's relationship rows |
| Account changes mid-action | Old private state must not populate replacement account | Reject stale dispatch; ignore late success/rollback from former account | Reopen action in intended account |

The central mutation gate is not the entire authorization system. Its safe-read and account-rights exceptions still rely on route-level authentication and ownership. The expected-account header prevents accidental cross-account intent; it does not replace a session credential or protect a stolen cookie by itself.

## Confirmed repairs

### 1. Preserve the originating account and current preferences

Some callbacks read the latest global session when invoked even though the screen was rendered for a previous account. Others checked identity only after HTTP dispatch, too late to prevent mutation under the replacement cookie.

Affected member paths now use the existing rendered-account/epoch guard before dispatch, send an explicit expected account, and fence late success and rollback. Coverage includes private settings, profile edits, export, comments, post-tag removal, attendance, ratings, chat/read state, fan-club membership, venue reviews, appearance, and artist-owner actions. Switching A to B and back to A does not authorize callbacks from the first A session.

Preference responses contain an entire account projection. Merging it allowed unrelated privacy saves to overwrite one another with stale values. Preference adoption now updates only the requested field after validating identity and epoch. Independent review also reproduced the same problem in generic profile-save success and rollback. Those paths now merge or restore only their changed fields and related metadata, preserving independently confirmed privacy, avatar, and banner changes. Two writes to the same field still lack general server revision/CAS semantics.

Music metadata updates previously carried older snapshots of unrelated settings. The client now submits changed music keys only. The server merges editable keys into the latest stored extras inside the write transaction, preserving consent/privacy records, pending signup handles, and omitted music fields; explicit clears remain supported. Rating responses and rollback also check the initiating epoch, preventing old aggregate data from returning after an A/B/A account switch even if a request ticket number is reused.

A further regression reproduced an unconfirmed local vote reappearing as a real rating after that round trip. Production account changes now clear optimistic rating maps, and device-local aggregate fallback is restricted to demo mode. Production ratings come from confirmed server aggregates.

The tests extract actual Store callbacks and exercise stale entry and deferred responses; they are not merely source-text assertions. Evidence: `src/domain/clientMutationOwnership.test.mjs`, `src/store.js`, and the privacy/tag/chat request helpers.

### 2. Make comment submission predictable

React pending state alone did not synchronously exclude a second Enter/tap before the next render. A submission lock now covers that interval. Failure preserves the draft and displays a retry message. Success clears only the submitted draft, not new text typed while waiting. Account/post keys isolate the composer, and late responses cannot clear another screen's draft.

Optimistic comment, venue-review, and artist-post IDs use the existing mutation-ID generator instead of timestamp-only IDs. This prevents same-millisecond local collisions. It is not server-side exactly-once delivery after a lost response. Evidence: `src/screens/PostScreen.jsx`, `App.js`, `src/screens/guestPostMediaActions.test.mjs`, and executable Store tests.

### 3. Permit revocation without leaking hidden content

Unfollowing previously required the target profile to remain visible. Removing a like required the post and author to remain available. Members could become trapped in a relationship after a privacy or moderation change.

Removal now deletes only the caller's relationship and returns the requested false state. The same response covers missing and inaccessible targets without profile data, content, or aggregate counts. Adds still perform target visibility and block checks. Repeated removal cannot affect another account's row. Evidence: follow/like routes in `server/api.js` and `server/socialRevocation.test.mjs`.

### 4. Commit social actions and notifications atomically

Follow, like, and comment creation previously wrote the primary row before notification rows. A notification failure could return an error while leaving the social action committed. Retrying a comment could then publish duplicates.

Those writes now share a transaction, including both comment recipients when a reply notifies different post and parent-comment authors. Fault-injection tests abort notification insertion and verify rollback of the primary row and earlier notifications. A subsequent successful retry must produce one intended set of records.

This covers database failure inside the request, not uncertainty after a successful commit with a lost response. No automatic retry was added to a non-idempotent comment command.

### 5. Equalize missing-account password work

Login/signup already performed two password checks. The linked-account helper performed expensive work only for found rows, giving connect and related password/recovery paths a sibling-account timing signal.

It now performs two slots using the existing real dummy-scrypt verifier for missing accounts. Only actual matching rows are returned. Regressions check zero, one, and two candidates. This reduces a specific signal; database timing, scheduling, and deliberate capacity responses are not constant-time. Generic responses and consistent work reduce enumeration risk, not eliminate it. [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).

### 6. Reject invalid request envelopes before route logic

The JSON reader accepted root nulls, arrays, strings, booleans, and numbers. Object-command handlers could then encounter property errors or default-toggle behavior. The reader now requires a non-null root object and returns a controlled 400 for other roots. Nested arrays/nulls and truly bodyless requests retain their supported contracts.

Real HTTP tests verify invalid bodies cannot change a follow, cross-site requests are rejected, guests cannot write, and a wrong expected account fails closed. Profile mass-assignment tests attempt to change ID, role, email verification, and password-hash fields and verify authority is unchanged. Public city labels remain available, but email, private account flags, secret hashes, and saved coordinates do not become public fields.

### 7. Improve integrity diagnostics without exposing account records

The checker now includes declared foreign keys, structural checks, both ends of social relationships, reply/post consistency, tag authorship, media ownership, source/variant ledger ownership, and linked-session owner/expiry/email boundaries. Counts above twenty are explicitly capped. Absent legacy tables and explicitly optional columns are skipped, not passed; unexpected schema/query failures display as errors. Ledger checks detect cross-owner mismatches, not every missing historical ledger entry. Email grouping matches trimmed, case-insensitive account constraints. No individual records are logged.

SQLite `quick_check` does not verify unique constraints or index/table correspondence. Physical checks also do not replace the separate foreign-key check. A full `integrity_check` belongs in isolated or appropriately scheduled restore validation. [SQLite PRAGMA reference](https://www.sqlite.org/pragma.html).

Evidence: `scripts/integrity-check.mjs` and corrupted-fixture regressions. The script registers application SQLite functions for expression indexes without importing the application or running migrations.

## Existing foundation verified during the sweep

### Signup, shared emails, and verification

Signup inserts an account; it does not upsert over an existing profile. Matching credentials return an explicit account choice. Another matching-password account requires the explicit second-account flow. Different passwords remain distinct accounts subject to the two-account limit and independent verification. Database triggers serialize capacity enforcement rather than trusting a pre-insert count.

Email equality does not establish control of another account. Switching requires exact password proof against independently salted hashes, verified accounts, and a browser-session-bound grant. Changes to credentials, privileges, or eligibility invalidate the link. Verification tokens bind a specific account/address; opening a verification GET does not itself confirm or log in an account.

Normalization must be consistent across lookup, uniqueness, recovery, and linking. Provider-specific rewriting such as removing dots from arbitrary email local parts can merge identities incorrectly; no broad rewrite is introduced here. [OWASP email verification guidance](https://cheatsheetseries.owasp.org/cheatsheets/Email_Validation_and_Verification_Cheat_Sheet.html).

Optional profile setup remains separate from verification. Finishing setup preserves the profile; closing the screen is not consent to erase it. Explicit cancellation remains account-bound and cannot target a completed or different account. The audit preserves the established lifecycle instead of treating all incomplete registrations as disposable.

### Session persistence and revocation

Sessions are opaque: 32 random bytes are carried by the cookie, with only their SHA-256 digest stored in SQLite. Passwords have per-user random salts and scrypt-derived hashes. HTTP password work is asynchronous and bounded; expensive verification is not performed inside the social-write transaction.

Session resolution checks the current account and expiry, not a cached client role. Staff lifetime is capped separately. Login rechecks the password-hash snapshot before session issuance, so a concurrent password change cannot authorize an old-password login. Logout revokes its session, switching rotates it, and password recovery/change invalidate prior sessions for the selected account.

OWASP's session guidance supports unpredictable identifiers, protected cookies, rotation at authentication boundaries, and server-side expiry/revocation. This architecture can provide those properties without introducing JWT access/refresh tokens. Another token system would not by itself fix stale callbacks or missing object checks. [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

### Authorization around asynchronous work

The request layer resolves a fresh session after reading the body and checks the expected account. Operations awaiting password work or storage must recheck authority before committing. Existing regressions exercise revocation, expiry, bans, and identity changes during this work. UI gates alone would not pass those tests.

Browser unsafe requests are checked against allowed origins and fetch metadata. A sibling origin is not trusted merely because it is same-site. JSON content-type, bounded bodies, and request deadlines add admission controls. Native clients without browser headers remain subject to session and object checks. OWASP likewise distinguishes same-site from same-origin and warns that cookie attributes alone are not complete CSRF protection. [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

### Media and public projections

The media sweep exercised foreign asset/variant IDs, owner-bound upload idempotency, finalize-time session changes, cancellation after publication, path/redirect rejection, exact-key cleanup, late upload resurrection barriers, and private export projections. These used synthetic databases and mocked storage, not the live bucket.

Publication relies on server-validated ownership and sanitized derivatives. Filenames and claimed MIME types alone are not trusted. This follows OWASP's layered upload guidance: authentication, allowlists, size limits, content inspection, safe names, and storage separation. SSRF guidance also warns that redirects can bypass initial URL validation. [File upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html), [SSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

Public profiles are allowlisted projections, not raw rows. A city label is intentional; saved coordinates are private. Export is a different owner-only projection with reauthentication. The tests preserve that distinction rather than indiscriminately removing useful public information.

## Threat register and remaining failure points

| ID | Priority | Status | Threat or failure point | Evidence or next action |
| --- | --- | --- | --- | --- |
| A01 | High | Fixed | Stale screen acts under another selected account | Identity/epoch before dispatch and completion; explicit expected account |
| A02 | Medium | Fixed | Profile/privacy saves overwrite unrelated settings | Field-scoped success/rollback plus fresh-record metadata merge |
| A03 | Medium | Fixed | Late comment response clears another draft; rapid double-send | Synchronous lock, draft comparison, account/post key |
| A04 | Medium | Fixed | Hidden target prevents removing own relationship | Owner-only revoke with generic response |
| A05 | Medium | Fixed | Notification failure leaves action behind an error | Follow/like/comment transaction fault tests |
| A06 | Medium | Fixed | Password-work count leaks hidden sibling presence | Two-slot dummy verification; not a constant-time claim |
| A07 | Medium | Fixed | Non-object JSON reaches command handlers | Controlled 400; malformed-body HTTP tests |
| A08 | High if present | Improved detection | Orphan, owner mismatch, or invalid linked grant escapes audit | Expanded checker; actual production state unverified |
| A09 | High | Covered | Reset replay or old-password race issues a session | Single-use token/CAS, fresh credential snapshot, cookie replay tests |
| A10 | High | Covered | Shared email unlocks different-password account | Independent password proofs, verified eligibility, fresh grants |
| A11 | High | Covered | Mass assignment of authority via profile edits | Typed authority fields/projection; real HTTP negative test |
| A12 | High | Covered | Revoked/expired session finalizes media | Recheck before commit; media race tests |
| A13 | High | Covered | Foreign asset publication/deletion or guessed private ID | Owner/object/key validation; media/export regressions |
| A14 | High | Open | Offline guessing after password-hash disclosure | Versioned, benchmarked work-factor migration needed |
| A15 | High | Open | Password-only privileged-account compromise | No MFA/passkey implementation found; design enrollment and recovery |
| A16 | Medium | Open policy | Known email's pending-account slots occupied | Mailbox-proven capacity recovery needs explicit design |
| A17 | Medium | Open | Lost successful response duplicates comment on retry | UI double-send fixed; no server comment idempotency key added |
| A18 | Medium | Open | Old staff callback acts as replacement staff account | All moderation utilities not comprehensively fenced |
| A19 | Medium | Unverified | Copied public media survives privacy/block change | Actual CDN delete/cache behavior needs provider verification |
| A20 | Medium | Known lifetime | Issued private signed URL survives logout briefly | Fresh issuance denied; prior GET capability can last up to 300 seconds |
| A21 | Medium | Open policy | Deleted comment text/excerpt remains stored | Soft deletion retained; irreversible deletion needs retention/linkage design |
| A22 | Medium | Open | Process restart resets in-memory abuse counters | Bounded password queue exists; persistent/shared throttling needed when scaling |
| A23 | High operational | Unverified | Backup cannot restore complete production state | Offsite restore, indexes, relationships, and media ownership drill |
| A24 | High operational | Unverified | Origin/disk outage interrupts account-dependent features | Separate availability work; localhost tests do not establish uptime |
| A25 | Medium | Open | Older clients omit expected-account binding | Server ownership still mandatory; measured client-version migration |
| A26 | Medium | Open | Same preference updated twice with responses reordered | No general server revision/CAS semantics added in this patch |

### Password modernization

Current scrypt calls omit explicit parameters. Node 24 documents defaults `N=16384, r=8, p=1`. OWASP recommends stronger configurations, including `N=131072, r=8, p=1` or listed memory/parallelism tradeoffs. The current defaults therefore merit hardening, despite salts and non-plaintext storage. [Node crypto reference](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback), [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

Do not reinterpret existing hashes with new parameters: that would break existing passwords. Store a version/work factor, retain old verification, migrate after successful proof, and benchmark memory, CPU, and queue saturation at the deployed limit. Previous memory incidents make an unmeasured cost increase inappropriate.

Creation currently permits eight-character passwords with letter/digit requirements. NIST SP 800-63B-4 specifies fifteen characters for single-factor passwords, recommends support for at least sixty-four, rejects arbitrary composition rules, and calls for common/compromised-password checks. This is a design benchmark, not a claim of federal obligation or certification. Improve new/change-password validation without rejecting valid existing credentials at login. [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html).

### Pre-created accounts and shared-mailbox boundaries

Pre-hijacking research shows why later email proof is insufficient if an attacker's earlier session or recovery capability survives. Microsoft Research describes unexpired-session, identity-merging, and pending-email-change variants. Applied here, verification must bind the intended account and recovery must invalidate old access; an email string is not an identity proof. [Paverd, Microsoft Research, May 23, 2022](https://www.microsoft.com/en-us/msrc/blog/2022/05/pre-hijacking-attacks/).

Existing recovery revocation is tested and accounts are not merged merely by email. However, unverified registrations may occupy slots before the mailbox owner acts. With a deliberate limit of two and no immediate unfinished-account expiry, this can deny signup capacity. It does not itself expose the real account's data. A mailbox-proven pending-registration recovery flow should not delete completed accounts or expose account details before proof. Do not solve this by silently overwriting users or expiring their work against the established policy.

Recovery tokens must be account-bound, unpredictable, expiring, single-use, and kept out of logs. OWASP recommends generic responses and ordinarily returning to login after reset. Mshpit currently issues a new session after reset; this behavior was retained and tested for atomic consumption and prior-session revocation. It remains more complex than reset-then-login. [OWASP forgot-password guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

### Storage, deletion, and operational integrity

Application permissions cannot retract a downloaded photo or every previously issued bearer URL. Public delivery, private source storage, and short capability lifetimes are different controls. Verify actual provider policy before claiming a block or profile privacy setting revokes historical media access.

Soft-deleting a comment hides it from ordinary reads but retains row text and may leave excerpts in notifications. Moderator reversibility and author erasure are different requirements. Define the retention contract, link notifications to source comments where needed, and test exports, deletion, backups, and restoration together. This audit did not erase stored comments or silently change retention.

Integrity and recoverability also differ. A readable database with no detected relationship errors may still have missing records, old backups, or inaccessible media. SQLite's online backup API produces a consistent snapshot while accounting for concurrent writes. Use a consistent backup path, not a copy of only the live database that disregards its write-ahead log. Restore separately and validate application invariants as well as schema. [SQLite backup documentation](https://www.sqlite.org/backup.html).

The persisted local scan examined 37 checks: 34 executed with zero findings and three skipped because linked-account tables were absent. File size and timestamp remained unchanged. This is not an all-clear for production data, its current migrations, or all possible logical inconsistencies.

Logs should describe failures without passwords, live/reset tokens, complete session identifiers, private profile contents, or unnecessary personal records. OWASP identifies these as sensitive logging material and recommends sanitization and restricted access. Counts-only integrity output follows this principle. [OWASP logging guidance](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).

## Verification and release evidence

Focused tests reproduced repaired cases before the patches and passed afterward. Coverage includes auth/onboarding, media ownership/revocation, social notification fault injection, malformed HTTP envelopes, stale Store callbacks, and private-draft transitions. Counts from overlapping focused suites must not be added together as unique tests.

- Final full repository gate: 4,447 tests passed, zero failed; dependency, syntax, architecture, and production web-build gates passed.
- Rebuilt exported-app browser matrix: 50/50 mobile and desktop cases passed.
- Actual localhost server/browser matrix: 12/12 checks passed against the final rebuilt bundle, `index-54fd89160d94e2da035fd42047a0a489.js`, and real server listener.
- Hosted-configuration test matrix: the same 4,447 tests passed with production/Render background flags, zero failed. This is a second configuration run, not 4,447 additional unique tests.
- Read-only persisted local database: 34 executed checks, zero findings, three skipped; production state unverified.
- Runtime dependency advisory check: zero reported vulnerabilities at checked versions; not proof dependencies are defect-free.

The exported initial JavaScript measured 501.4 KiB gzip against a 512 KiB gate. Architecture limits were not relaxed; the unexplained-catch allowance decreased by one. Before release, eight bounded public production health/catalog probes also passed. Those probes did not inspect private accounts or replace a production database/storage audit.

Reproducible commands:

```text
npm run check
node scripts/verify-auth-browser.mjs
node scripts/verify-auth-real-server.mjs
node scripts/integrity-check.mjs PATH_TO_PRIVATE_SNAPSHOT.db --json
```

Browser runners need the configured Playwright module path on this workstation. The full gate covers tests, runtime dependency advisories, syntax, architecture budgets, and web export. Parallel localhost authenticated reads at 5, 10, 50, and 100 clients verify isolation/correctness; their timings are not a production capacity benchmark.

## Next work, in order

1. Confirm the pushed revision's CI/deployment state and inspect sanitized production error categories. Do not repeatedly deploy just to see whether symptoms disappear.
2. Obtain a consistent production snapshot through the controlled backup procedure. Run this checker, then full SQLite integrity and restore smoke tests in isolation. Resolve skipped checks explicitly.
3. Implement versioned password-cost migration and modern creation validation with measured resource limits. Preserve old-password compatibility and exact-password shared-account semantics.
4. Add MFA/passkeys for owner/moderation accounts with reauthenticated enrollment, recovery codes, revocation, and audited lost-device recovery.
5. Extend account/epoch guards to remaining moderation utilities. Add server-backed comment idempotency with owner-scoped keys and mismatched-payload rejection.
6. Decide pending-registration capacity recovery and author-deletion retention explicitly; test linked accounts, notifications, exports, and media cleanup together.
7. Verify private bucket policy, issued-URL lifetime, public CDN purge behavior, and offsite restore evidence. Keep host/disk outages in the availability track instead of attributing all errors to authentication.

## Primary references

Accessed for this review on September 12, 2026. OWASP cheat sheets are living guidance; NIST revision 4 and Node 24 are version-specific. The 2022 pre-hijacking research is not a finding about this application.

- OWASP: [Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), and [Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) cheat sheets.
- OWASP API Security Top 10, 2023: [Broken Object Level Authorization](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/).
- OWASP: [CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [Email Validation and Verification](https://cheatsheetseries.owasp.org/cheatsheets/Email_Validation_and_Verification_Cheat_Sheet.html), and [Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) cheat sheets.
- OWASP: [Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
- NIST: [SP 800-63B-4, Authentication and Authenticator Management](https://pages.nist.gov/800-63-4/sp800-63b.html).
- Node.js: [Version 24 crypto documentation](https://nodejs.org/docs/latest-v24.x/api/crypto.html).
- Andrew Paverd, Microsoft Research: [Pre-hijacking attacks](https://www.microsoft.com/en-us/msrc/blog/2022/05/pre-hijacking-attacks/), May 23, 2022.
- OWASP: [File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html), [SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html), and [Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) cheat sheets.
- SQLite: [PRAGMA reference](https://www.sqlite.org/pragma.html) and [Online Backup API](https://www.sqlite.org/backup.html).
- Expo: [SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/), consulted for the installed framework before changes.
