# Pit App Store listing draft

Prepared: **2026-08-14**. This is working copy for App Store Connect, not a
published claim. Anything marked **Owner input** must be confirmed before it is
entered in Apple's systems.

## Product identity

- **App name:** Pit (subject to App Store availability and trademark review)
- **Subtitle:** Your life's musical journey
- **Primary category:** Music
- **Secondary category:** Social Networking
- **Bundle ID:** `com.mshpit.app` (confirm before the first signed build)
- **Marketing URL:** `https://www.mshpit.com/`
- **Privacy URL:** `https://www.mshpit.com/privacy`
- **Support URL:** `https://www.mshpit.com/support`
- **Account deletion URL:** `https://www.mshpit.com/account-deletion`

## Promotional text

Remember every show, find rooms worth visiting, and discover live music through
the people who were actually there.

## Description

Pit is a home for your life in live music.

Log the concerts you attend, rate the performance and the room, save photos and
memories, and build a history that stays with you. Follow people whose taste you
trust, explore artists and venues, see upcoming shows, and discover what the
community is listening to.

With Pit you can:

- Keep a personal concert history with ratings, notes, setlists, and photos.
- Discover artists, venues, and upcoming events near you and around the world.
- Follow friends and fans whose live-music taste matches yours.
- Join artist fan clubs and show lounges.
- Build playlists and use the in-app music player while you explore.
- Control recommendations with clear feedback such as Not for me.
- Report content, block accounts, and manage your privacy and analytics choices.

Pit is an early community. Some cities and artists will have more activity than
others as the founding crowd grows.

## Keywords draft

`concerts,live music,venues,reviews,shows,artists,setlists,concert diary,music community,gigs`

Recheck Apple's current 100-character limit and localization rules in App Store
Connect before publishing.

## Screenshot story

Use only owned or licensed images and real app behavior. Do not include private
messages, personal email addresses, unlicensed concert footage, fake activity,
or claims that are not true in the submitted build.

1. **Your life's musical journey** — personal concert history/profile.
2. **Remember every show** — completed concert review with ratings and media.
3. **Find your next room** — venue discovery and upcoming events.
4. **A feed shaped for you** — recommendation feed with honest explanation or
   Not for me control visible.
5. **The crowd after the encore** — comments, fan club, or show lounge using
   review-safe demo content.
6. **You stay in control** — privacy, reporting, blocking, and analytics choice.

Capture the required current iPhone sizes from the signed candidate. Because
`supportsTablet` is false, do not upload iPad screenshots or imply iPad support.

## App Review notes draft

Pit is a social live-music journal. The app uses email/password authentication;
there is no third-party account login. It contains user-generated reviews,
photos, comments, direct messages, fan-club messages, and show-lounge messages.
Users can report supported content, block accounts, and permanently delete their
account from Settings. Staff process reports in the in-app moderation console.

The music player uses embedded YouTube playback on web. The native iOS build
uses short Deezer preview audio when available; it does not download or claim to
provide full copyrighted tracks. Do not give this statement to App Review until
the owner has documented Deezer approval or replaced/disabled that provider.

**Owner input before submission:**

- A stable, non-privileged reviewer account and password, stored only in App
  Store Connect—not in Git.
- Exact steps that let review reach a post, comment, message, fan club, lounge,
  report flow, block flow, analytics control, export, and account deletion.
- A monitored reviewer contact name, phone number, and email address.
- Any feature flags or sparse-data conditions the reviewer should know about.

The production API must remain online for the entire review period.

## TestFlight "What to test" draft

Please focus on sign-up and email verification, feed loading, venue discovery,
creating a concert review, selecting and uploading media, player controls and
swipe-to-close, reporting/blocking, poor-network recovery, background/foreground
restoration, VoiceOver labels, and permanent account deletion. Report the app
version/build, iPhone model, iOS version, and diagnostic reference shown by Pit.

## Owner decisions that cannot be inferred from code

- Final legal entity/operator name, postal address, jurisdiction, copyright
  holder, and counsel-approved Terms and Privacy language.
- Final app-name availability, trademark clearance, pricing, countries, release
  strategy, and localization.
- Final age-rating questionnaire answers. Open UGC, messaging, concert media,
  profanity, alcohol/drug references, and embedded music/video must be answered
  honestly; an all-minimum rating is not a safe default.
- Final App Privacy answers for contact information, identifiers, coarse city,
  user content, usage data, diagnostics/security processing, and YouTube/service
  providers.
- Rights confirmation for the Pit brand, icon/splash artwork, catalogue and venue
  photography, user concert media, music/video embeds, and every screenshot.
- Written provider approval or replacement evidence for Deezer-derived catalogue
  metadata, artist artwork, rankings, top tracks, and preview audio. The public
  developer terms do not authorize Pit's planned commercial use by themselves.
- Confirmation that `support@mshpit.com` exists and is actively monitored.

## Release boundary

Repository checks and JavaScript exports are not a signed-device acceptance.
Follow `APP_STORE_READINESS.md` before creating an EAS production build. Start
with internal TestFlight, resolve physical-device findings, then use external
TestFlight review before an App Store submission.
