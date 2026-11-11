# Remove duplicate activity shortcuts from You

The iOS You profile rendered a second bell/envelope pair below the shared scrolling activity bar. Remove the normal-text and large-text `ProfileOwnerActions` mounts from `ProfileScreen.ios.jsx`, plus its unused import. The higher `NativeAppHeader` controls remain unchanged, including unread labels, badges, guarded actions, and scroll visibility. The profile account menu retains Inbox, Activity, Calendar and Settings. Visitor moderation and other profile actions are unchanged.

This branch starts at `698f03d`, so it includes restored Feed filter swiping, the current activity-bar tabs, and the refresh animation fix. No Feed, gesture, refresh, shared header, Android/web, native-dependency, or backend runtime source changes accompany this correction.

## Verification

- Read the exact Expo SDK 57 reference before editing.
- Actual iOS Profile/media integration, profile presentation, You session rendering, and shared native chrome tests: 70/70 passed.
- Tests cover no lower duplicate at normal and large text, preserved account-menu routes/unread labels and stale-sheet guards, and exactly one higher Messages/Notifications pair with working actions, unread announcements, large-text dots, and scroll hide/reveal behavior.
- The inherited swipe/refresh source is unchanged from the independently reviewed `698f03d` candidate, which passed 294 distinct tests. Those previous results are inherited evidence, not a new full rerun.

Source freeze, export map checks, native fingerprint, signing, and artifact preservation evidence are stored in `.tmp/native-you-dedupe/evidence`. This is a separate JavaScript-only QA repack using the verified native runtime. No phone installation or interaction occurred for this correction; physical acceptance remains outstanding.
