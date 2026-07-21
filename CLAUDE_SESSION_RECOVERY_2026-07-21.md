# Claude session recovery - July 21, 2026

This note preserves project requests recovered after a Claude conversation disappeared from the UI. It intentionally contains no API keys, personal account data, or full console dumps.

## Recovery result

- The project code is safe. At the time of recovery, local `master` and `origin/master` both pointed to commit `c64a5fe`, and the working tree was clean.
- The supplied Claude export ZIP is valid, but it only contains five conversations through July 12 and memory summaries through July 13. It does not contain the vanished July 18-21 Claude Code conversation.
- The recent conversation survived in Claude Code's local JSONL history. The latest relevant transcript contains 11 typed user prompts from July 18 through July 20 Toronto time, with records continuing through `2026-07-21T00:08:10.903Z` UTC.
- The final saved prompt ends with a blank item `19.`. No text after that number exists in the local transcript, so item 19 cannot be reconstructed.
- Anything typed after the final timestamp but never accepted or written by Claude is not recoverable from either source.

## Source locations

- User-supplied export: `C:\Users\Adam Gadishaw\Downloads\data-b3fdcef5-bed7-4e50-8daf-be291601c034-1784660263-7d06c378-batch-0000.zip`
- Recent local Claude Code transcript: `C:\Users\Adam Gadishaw\.claude\projects\D--Websites-Concert-Website\50794ac7-0df0-482d-96d7-4f81c82707ce.jsonl`

Do not publish or attach the raw JSONL file. One prompt contains a YouTube API key and browser console output. Rotate that key if it is still active.

## Recent prompt timeline recovered from local history

1. July 18: correct YouTube/song sourcing; fix badly cropped media; support ordinary status posts; make post media behave more like Facebook.
2. July 18: simplify and polish the posting flow; allow tagged/linked YouTube material to use the player; repair incomplete discographies; handle artists with identical names.
3. July 19: continue the interrupted playlist work from a pasted Codex transcript.
4. July 19: continue working.
5. July 19: wrong YouTube selections for Nelly Furtado, Tory Lanez, and Korn; investigate growing performance lag.
6. July 19: a duplicate of the preceding wrong-song/performance report.
7. July 19: remaining previews, wrong/reaction videos, and Korn access failure.
8. July 19: YouTube API/console diagnostic material. The credential and noisy console dump are deliberately omitted here.
9. July 19: "im still getting bare previews".
10. July 20: the same preview report repeated.
11. July 20: the complete numbered owner backlog reproduced below.

## Final recovered owner backlog

1. Determine how YouTube iframe/API limits can remain sustainable with a large user base.
2. Artist genre selection should follow Spotify's designation rather than only Deezer because a Spotify key is already available.
3. The selected theme currently stays on the computer after logout; prevent one account/device choice from leaking into a new session incorrectly.
4. Email is not set up; document the steps after creating the Resend account.
5. Allow starting a new conversation from the Messages tab instead of requiring a visit to the recipient's profile.
6. Autoplay appears to choose the same songs repeatedly.
7. Too many songs still use previews.
8. Add replies to comments.
9. Remove the Clips section from the current interface while retaining its framework for later work.
10. Improve venue and artist preselection; venue preselection is currently absent and artist preselection is incomplete.
11. Embed YouTube links in posts. Replace the overly narrow "attach a song" concept with music-related attachments that can include reviews, breakdowns, lessons, and other relevant videos.
12. Expand song flagging: include playback faults and incorrect-song reports; admins should be able to choose a correct candidate, while regular users can report and suggest a replacement link or candidate.
13. Improve the mobile player experience with larger touch targets, a sliding menu, and easier built-in navigation while the player is active.
14. Allow every user to delete their own comments.
15. Add a proper site-wide activity record and a dedicated analytics area with per-user inspection, user-growth analysis, product-usage tracking, and search/post keyword trends, subject to appropriate privacy and authorization controls.
16. Four previously requested themes are still missing.
17. The desktop song progress bar is broken and appears only as a tiny dot.
18. Users should be able to publish playlists as attractive, on-brand feed posts.
19. Blank in the saved transcript.

## Older material recovered from the export ZIP

The export contains 13 human prompts across five conversations:

- Concert logging app design and monetization
- Getting a map key
- Spotify developer website requirements for a local app
- Render versus Vercel and early deployment help
- Spotify clearance alternatives

It also contains older verbatim versions of `Pit.jsx`, `BRIEF.md`, and `CLAUDE.md`, plus a Pit memory summary. These files are historically useful but older than the current repository, so they must not overwrite the current versions. The export's final conversation message is from July 12; every saved human prompt has an assistant response, and there is no queued or hidden unsent prompt.

## Safe continuation point

Use `HANDOFF.md` and current Git history as the implementation record. Use this file as the recovered requirements record. Before resuming feature work, verify the deployed behavior against the numbered backlog and implement it in small, tested batches. Do not assume that a request appearing here was completed merely because it was discussed in the lost conversation.
