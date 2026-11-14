# Inbox classification follow-up — November 10, 2026

Runtime source: `641730901a588905de5e34a7a45ce4bf19bac658`, a local descendant
of the verified refresh/moderation integration. No push, merge, deployment,
installation, or phone interaction occurred during this follow-up.

## Fix

The server's Inbox badge accepted conversations using all retained outgoing
history, while the client classified them from a limited cached preview. A reply
outside that preview could therefore count toward Inbox unread while appearing
under Requests. Thread responses now provide authoritative `hasReplied` proof;
the client retains it alongside its existing account-private read cursor.
Explicit false withdraws old proof. Confirmed sends retire older Inbox reads;
pending/failed sends cannot accept a request. Account changes and demo numeric
read markers retain their existing protections.

Platform guards keep unused native-only navigation helpers out of web startup.
Native behavior, hook order, the two-pass minifier and bundle ceiling are unchanged.

## Verification

- Exact final Inbox/client/server focused run: 189 passed, zero failed.
- Six-file backend candidate focused run: 126 passed, zero failed.
- Navigation/platform suites: 86 passed; actual App callback checks passed on
  iOS, Android and web. Independent code review cleared the final implementation.
- Both worktrees pass architecture/whitespace checks with unchanged ceilings.
- Production iOS, Android and web exports passed. Web initial gzip is
  523,181 / 524,288 bytes, leaving 1,107 bytes. Android and all 82 web source maps
  passed iOS-source isolation with zero issues.
- Xcode Release compilation succeeded. All 801 mapped application sources match
  the checkout; the 2,851-file source snapshot remained unchanged during builds.
  The full aggregate suite was not repeated for this focused follow-up; the prior
  integration's full-run result and targeted corrections remain separately recorded.

## Final signed artifact

Use only `.tmp/ios-phone-checkpoints/refresh-moderation-6417309-ready/MshpitDev.app`
for the proposed installation. The earlier `e56c224` checkpoint was preserved and
its full 52-file manifest rechecked unchanged. Other `6417309` checkpoint folders
are intermediate packaging evidence, superseded by `6417309-ready`.

The ready app contains 52 files / 59,110,568 bytes, identity `com.mshpit.app.dev`,
version 1.0.0 / build 1, minimum iOS 16.4. The existing profile expires
2026-11-14T23:50:01Z. Strict deep signature verification passed in the host context
for both the final product and preserved copy. The 11 privacy manifests, profile
and final Info.plist match the previously verified Release app.

Xcode's existing Expo strip phase ran before plist generation and left two
Expo development-network keys in the raw app, including after one incremental
retry. Finalization ran that same generated strip script after the build, followed
by the exact Xcode signing command with the same identity and entitlements.
Only Info.plist, executable signature and CodeResources changed; main.jsbundle
and all other files were unchanged. No source, native project, dependency or
provisioning change was required. Future rebuilds must verify this packaging
order again. The script, before/after hashes, build logs and signatures are in
`6417309-ready/evidence/` beside its manifest and receipt.

Native main.jsbundle SHA-256:
`a613002bfabe35ed64a2e1ac5661973f78ff5ff16d4f86c3421fd51c5016a421`.
Native source-map SHA-256:
`445a9fceb77e2810aa70f46ee911ea82a8ba78afbbf4e1145cef36586e713bc4`.

## Six-file backend review candidate and approval hold

The separate `mshpit-notification-backend` worktree remains on production base
`b56c58089f5e25e232e10e8ba2ae15458df13a8b` with exactly six uncommitted candidate
files (the existing dependency symlink is excluded). The review, exact replayed
patch, individual hashes and test evidence are preserved under
`.tmp/notification-backend-review-6417309/`.

Final candidate fingerprint:
`dcf97fec7a2764f1f5702ee11e10a67973d23203d9b4f8c2a3bc58df40ea3efa`.
This supersedes the earlier candidate fingerprint. It adds no schema, dependency,
environment or deployment-configuration change. The reply-proof query uses the
existing owner-scoped covering index and returns a Boolean only on visible threads.

Deployment and installation await Adam's approval already requested by the parent.
The paired client requires the backend contract on every serving instance first:
verify authenticated notification GET returns `notification-ids-v1` and integer
`inboxUnread`, and thread summaries return boolean `hasReplied`. Public health
alone is insufficient. Do not mutate production read markers merely to verify it.

The previously inspected Render service is `srv-d94036cvikkc73b7v5qg`; rollback
reference is `dep-dbnoeuoae00c73900vk0`. Those are prior read-only observations,
not a fresh production check in this follow-up. This disk-backed service can have
an interruption during deploy/startup backup. Rollback needs no schema reversal
but restores old notification behavior and requires paired-client readiness to
be reconsidered. Physical-device visuals, gestures, accessibility and login
acceptance remain untested by this automated/local build work.
