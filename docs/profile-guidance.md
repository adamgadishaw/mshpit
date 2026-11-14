# Profile guidance and account form feedback

This extension follows the sparse profile-save fix. It adds suggestions, not a profile-completion access gate.

## Existing requirements

- Signup API: valid display name, email, password, 1–3 music genres, age group, and current terms version. The signup UI also requires a chosen username and affirmative terms agreement; the API treats username as a preference claimed after verification.
- Public profile mutations: existing email-verification and account-state checks still apply. The existing confirmation banner and prompt remain the entry point.
- Optional: city, photo, banner, bio, favorite artists, pronouns, accent, favorite shows, analytics consent, and the welcome guide. `onboardingVersion` records the guide, not profile completeness.

## Behavior

An owner-only, per-view dismissible suggestion card distinguishes missing music choices from optional photo/bio/city. Its action opens the personal editor through the existing verification gate, including for artist accounts. It never writes profile or onboarding state. It returns on a later visit; it is not a persistent dismissal preference. Complete suggested details hide the card. No completion percentage or new requirement is introduced.

The editor explains missing music choices without blocking other edits. Only deliberately changed names/genres are validated. Clearing an existing name now explains the problem instead of silently restoring the old name; untouched blank or invalid legacy names remain omitted from unrelated saves. Invalid changed fields show feedback before Save. Save errors remain visible at the top and retain the draft. Optional fields are labeled.

Safe structured API 4xx errors preserve actionable server advice, such as taken usernames, cooldowns and upload limits. Generic diagnostics copy is used for other known failures; raw exception text and thrown strings fall back to contextual recovery instructions. Picker errors identify the library step without assuming permissions were denied. Server authorization and validation remain authoritative.

Signup's existing Finish step reviews public identity, music and optional city, with edit links that preserve answers. Optional analytics stays unchecked unless explicitly selected. Welcome-guide completion describes closing the guide rather than claiming the profile is complete.

## Checks

The normal Node suite includes domain feedback and real React editor regressions, including zero-genre and legacy-name sparse saves. Existing CI browser jobs run `verify:profile-edit-browser` and the auth browser suite. Profile browser checks use the actual exported website with synthetic image and intercepted API/storage: prompt dismissal causes no mutation, direct editor navigation works, changed invalid names explain Save, an actionable conflict retains the draft, and photo/text survive fixture-backed reload without submitting untouched genres. Signup checks cover review navigation, retained credentials/genres, no premature account creation, and analytics remaining off. These are not production or physical-device tests.

Website implementation is based on the tested `be9decc` profile chain. The native variant must preserve command/task ownership and editor close/lock guards from `f6cc159`; apply the appropriate variant, not both. Final website integration must use actual master after the coordinated notification rollout. This work does not deploy, push, install, or alter live accounts.
