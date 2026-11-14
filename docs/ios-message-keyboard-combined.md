# Combined iOS keyboard candidate

Integrates the unchanged runtime patch from `407aa2f25e1adedc27bf2499876bc761fb20b4e0` onto `1541fcfd7c98e20ba696637e066de5b423a8b4ba`. The patch applied cleanly. Feed swipe previews, restored tabs, refresh motion, and the single upper You activity bar remain unchanged.

Fresh combined checks passed: 171 keyboard/draft/control/announcement/theme tests; 210 real Feed swipe, selection, refresh, chrome, profile and You continuity tests; 320 message-bubble and 600 composer Yoga cases. The Yoga text measurements are synthetic. Independent keyboard review passed all 171 focused tests.

Prepared using the existing official Expo repack workflow with frozen source and native compatibility checks. This is a JavaScript-only signed QA candidate, not a full native rebuild. No phone or simulator interaction, installation, message access, backend deployment, or production change was performed. Native keyboard animation, interactive dismissal and cancellation, VoiceOver, and glyph rendering remain physical acceptance checks. See the original keyboard patch document for those scenarios.
