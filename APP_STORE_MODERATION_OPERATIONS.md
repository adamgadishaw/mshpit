# PIT moderation operations draft

Prepared: **2026-08-14**. This is an operational launch gate, not a claim that
the mailbox is staffed or that a response-time promise is already in effect.
The owner must name the responsible people and approve the time windows before
external TestFlight review.

## Product controls

PIT provides first-line text screening at the server write boundary, reporting,
blocking, an authenticated staff queue, content removal/restoration, report
dismissal, and account restriction controls. The deterministic text screen is
deliberately conservative: it catches high-confidence threats, exploitation,
unsafe schemes, and mechanical spam without pretending to understand every
song lyric or quoted report. User reports and trained review remain the backstop.

Reportable surfaces include public posts and attached media, comments, public
profiles, artist profiles and updates, direct messages, fan-club messages,
show-lounge messages, and venue reviews. Private context is minimized: staff see
only the exact reported direct message or verified attachment, never an entire
thread or unrelated gallery.

## Required launch ownership

Before external TestFlight review, record these outside the repository:

- Primary moderator and backup moderator.
- Monitored owner of `support@mshpit.com`.
- Legal/safety escalation contact and local emergency protocol.
- Daily coverage window and weekend/holiday coverage.
- The approved response targets below, or their owner-approved replacements.

Recommended initial targets for a small launch:

| Priority | Examples | Initial review target |
| --- | --- | --- |
| Urgent | Credible threat, child sexual exploitation, imminent physical danger, doxxing | As soon as seen; target under 4 hours during coverage |
| High | Targeted harassment, non-consensual sexual content, impersonation, repeated evasion | Under 24 hours |
| Standard | Spam, misleading metadata, ordinary policy disputes | Under 72 hours |

Do not advertise these windows until staff coverage can actually meet them.

## Queue procedure

1. Open the normalized moderation queue; work oldest urgent reports first.
2. Review only the bounded target context supplied by the queue.
3. For an exact-media report, inspect only that verified attachment. For a
   direct-message report, inspect only the reported message plus participants.
4. Remove violating content or dismiss the report with a concise reason. Removing
   a post, venue review, or artist profile permanently detaches its attached
   PIT-hosted media and queues those objects for deletion. Restoring later can
   restore the text row only; it cannot restore deleted attachments. Removing a
   direct message tombstones only that exact message for both participants and
   clears its notification preview. Its body remains restricted server-side as
   adjudication evidence until normal account deletion. A staff restore may make
   the message visible again, but never sends a new notification.
5. Use suspension or ban controls for repeated or severe account-level abuse.
6. Keep reasons factual. Do not paste harmful content, passwords, private
   addresses, or unnecessary personal data into moderation notes.
7. Escalate credible imminent harm through the approved safety protocol. Do not
   promise that PIT itself is an emergency service.
8. Direct account-access, privacy, and appeal questions to the monitored support
   channel. Record the report ID, not a copy of private content.

Desired-state actions are safe to retry after a lost response. Retrying media
removal does not create duplicate deletion work, and retrying a direct-message
tombstone does not add another audit event or touch another message. If the
console shows stale/conflicting state, refresh before taking a different action.

## Child-safety and illegal-content handling

Do not download, forward, or duplicate suspected child sexual abuse material.
Restrict access, preserve the minimum report/account identifiers needed for the
approved legal process, and follow the reporting duties that apply to the PIT
operator's jurisdiction. Counsel must approve the final procedure and retention
rules before public launch.

## Daily checks

- No urgent report remains unseen past the approved coverage window.
- Queue counts and missing-context counts are reviewed.
- Failed support delivery and backend health alerts are checked.
- Media-deletion dead letters and backup health are reviewed without exposing
  object keys or user content in public health responses.
- Moderator access is removed immediately when a staff role ends.

## Submission evidence

App Review notes should provide a stable demo account and exact steps to reach a
report action, block an account, and open the moderation queue. Do not submit
real private messages, real abusive media, or production moderator credentials
as review fixtures.
