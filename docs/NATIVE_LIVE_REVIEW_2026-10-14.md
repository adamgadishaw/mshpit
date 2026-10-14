# Approved native live-data review — October 14, 2026

The owner explicitly approved switching this Android review to the live API. Runtime verification returned https://www.mshpit.com/api/login with no new login errors. The assistant did not submit credentials or inspect credential fields, bodies, cookies or tokens.

Only the isolated Android dev checkout is configured. Localhost remains the default. The opt-in native development review allows GET/HEAD and user-operated POST /api/login and /api/logout. Other API client writes are rejected before serialization/fetch; analytics queues and guest-search analytics are disabled. Web and release behavior are unchanged. This is a local review guard, not a server access control. Signup and posting are unavailable in this review session.

Live review command (PowerShell):

    Set-Location D:\Development\Apps\mshpit
    $env:EXPO_PUBLIC_API_URL='https://www.mshpit.com'
    $env:MSHPIT_APPROVED_LIVE_API='1'
    npm run mobile:start -- --port 8081 --max-workers 2

Revert to the safe local backend: stop Metro, remove both variables (Remove-Item Env:EXPO_PUBLIC_API_URL and Env:MSHPIT_APPROVED_LIVE_API), run npm run mobile:backend in one terminal and npm run mobile:start in another; retain adb reverse tcp:3000 tcp:3000 and tcp:8081 tcp:8081. Reload the dev app. Never reuse real credentials against the disposable local database.

Focused validation: 9 tests passed (API origin, native review policy, analytics backoff/suppression, guest analytics wiring). Native development runtime reached the canonical live sign-in destination. The assistant did not submit login or any live content write.

Drake investigation: actual Search list control Open artist Drake was tapped. Settled reopen yielded 6 ArtistScreen commits and 7 distinct successful GETs (photos, sets, links, profile, memorial, news, live-summary), each once. A preceding 18-second idle interval had zero commits and zero tracked requests; a later idle snapshot remained zero. No ongoing loop has been reproduced. Metro recorded cold ArtistScreen compilation of 122924ms and NewsViews compilation of 24460ms. This is confirmed first-open delay, not proof that all reported visual glitching is explained. No speculative artist-loop fix applied. Evidence: .tmp/validation/drake-reopen-settled.json and metro-review-final.log.
