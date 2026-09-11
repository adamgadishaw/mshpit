export const PRIVACY_POLICY_UPDATED = "September 11, 2026";
export const TERMS_POLICY_UPDATED = "September 11, 2026";
// Sent by current clients and persisted with account creation so an acceptance
// record identifies the exact materially revised Terms + Privacy pair.
export const LEGAL_ACCEPTANCE_VERSION = "2026-09-11";

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
    "When the app stops unexpectedly, Pit automatically sends a small report so staff can find and fix the problem. It contains a fixed error code, the broad app area, the platform category (web, iOS, Android, or unknown), the general type of error, and a shortened error message. On the web it also includes the position in Pit's own app code where the error happened, which Pit's servers match to the original source file and line. Pit's servers add a request reference, timestamps, and a count of how often the problem happened.",
    "Before the report leaves your device, and again before it is stored, Pit removes email addresses, passwords, access tokens and other keys, long codes, IP addresses, most text in quotation marks, and everything in a web address except the site and page path from the message. The report does not include your account identity, cookies, IP address, user agent, the address of the page you were on, or a full stack trace. Error messages are written by software, so one can occasionally still contain a fragment of what was on screen, such as an artist name or a link. This necessary reliability reporting is separate from optional product analytics.",
    "When something goes wrong on Pit's servers, Pit keeps a similar problem record: the request type and route pattern, a fixed error code, a request reference, where in Pit's own code the failure happened, a shortened error message cleaned the same way, and the app release that was running. Pit emails a summary of new problems, with these details, to staff through its email delivery provider.",
    "Hourly crash and server-error trend buckets are kept for a rolling 30 days. One deduplicated problem record may remain while the same problem continues and is removed 30 days after it stops; the ledger is also capped at 2,000 problem records. The latest error message and code location are kept with that record and deleted with it, and an alert waiting to be emailed is kept only until it is sent. Alert emails stay in the staff mailbox until deleted there, and the email delivery provider may keep its own copy for its documented retention period.",
  ]),
});
