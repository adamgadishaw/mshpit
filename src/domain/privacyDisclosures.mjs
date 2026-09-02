export const PRIVACY_POLICY_UPDATED = "September 2, 2026";
export const TERMS_POLICY_UPDATED = "September 2, 2026";
// Sent by current clients and persisted with account creation so an acceptance
// record identifies the exact materially revised Terms + Privacy pair.
export const LEGAL_ACCEPTANCE_VERSION = "2026-09-02";

export const ANNOUNCEMENT_EMAIL_DISCLOSURE = Object.freeze({
  heading: "Email and announcement choices",
  paragraphs: Object.freeze([
    "Account-security, verification, password-reset, and service messages are transactional and may be sent when needed to operate or protect your account. Optional product, community, or promotional announcements are off by default and are sent only after you affirmatively enable them in Settings and confirm your email address.",
    "Pit uses an email delivery provider to send these messages. You can withdraw announcement consent at any time in Settings or with the unsubscribe link in an announcement; withdrawing does not turn off necessary transactional mail. Pit records the consent or withdrawal time, policy version, and source so the choice can be enforced and audited.",
    "Recipient and delivery-status metadata in Pit's operational email log is retained for 90 days by default, subject to a bounded 30-to-365-day operator setting and any shorter or longer period legally required. The delivery provider may apply its own documented retention period.",
  ]),
});

export const MEDIA_AND_SESSION_SECURITY_DISCLOSURE =
  "Pit does not retain raw session IP addresses or user-agent strings in session records. Uploaded images are decoded, metadata such as EXIF/GPS is removed, and only server re-encoded derivatives are made public; private staging objects are not published directly.";

export const PROFILE_SEARCH_INDEXING_DISCLOSURE =
  "Public posts may appear in search engines. You can ask Pit to keep your personal member profile out of search-engine results from Settings; Pit then marks that profile noindex and removes it from its sitemaps. This does not make public posts private, remove an artist page, or immediately erase results already cached by a search engine.";

export const CRASH_MONITORING_DISCLOSURE = Object.freeze({
  heading: "Crash and reliability monitoring",
  paragraphs: Object.freeze([
    "When the app stops unexpectedly, Pit automatically sends a small operational report so staff can see that a problem happened. It contains a fixed error code, the broad app area, the platform category (web, iOS, Android, or unknown), a server-generated request reference, timestamps, and an aggregate occurrence count.",
    "The crash report does not contain the error message or stack trace, page URL, artist or venue name, search text, account identity, cookies, IP address, user agent, messages, posts, media URLs, or other user content. This necessary reliability reporting is separate from optional product analytics.",
    "Hourly crash and server-error trend buckets are kept for a rolling 30 days. One deduplicated problem record may remain while the same problem continues and is removed 30 days after it stops; the ledger is also capped at 2,000 problem records.",
  ]),
});
