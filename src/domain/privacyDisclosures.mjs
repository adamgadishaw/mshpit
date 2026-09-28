export const PRIVACY_POLICY_UPDATED = "September 28, 2026";
export const TERMS_POLICY_UPDATED = "September 28, 2026";
// Sent by current clients and persisted with account creation so an acceptance
// record identifies the exact materially revised Terms + Privacy pair.
export const LEGAL_ACCEPTANCE_VERSION = "2026-09-28";

// This describes a separate, item-specific permission. Terms acceptance and
// existing spotlight/email/analytics flags are NOT promotional-media consent.
export const PROMOTIONAL_CONTENT_TERMS = Object.freeze({
  heading: "Optional permission for Mshpit promotion",
  paragraphs: Object.freeze([
    "You keep ownership of your content. Only if you separately and expressly approve a promotional use, you grant Mshpit a non-exclusive, worldwide, royalty-free licence to reproduce, crop, resize, excerpt, caption, display, and distribute the specific public content you approve to promote Mshpit and its app. This can include Mshpit's social-media posts and paid advertisements, but only in the channels and for the period described in your permission. Providers may handle that content only on Mshpit's behalf for that approved use, not sell it or use it to advertise unrelated products.",
    "Permission is optional and is not a condition of having an account or posting. Uploading, accepting these Terms, continuing to use Mshpit, or enabling artist-page sharing, community spotlights, announcement emails, or analytics does not grant this separate permission. Existing content and existing permissions are not automatically enrolled. Private posts, drafts, messages, and non-public account information are excluded. Mshpit must obtain and record your express permission for the identified content, uses, channels, period, and public credit before a campaign uses it; until a dedicated permission control is available, this is arranged in writing through Support.",
    "Mshpit will always give credit for each approved promotional use. Credit will use the public name or handle you approve and identify the source content, linking to the original public post where available and appropriate. Credit may appear on a corresponding entry on Mshpit's public credits/source page instead of being overlaid on the photo or video. In that case, each promotion must visibly link directly to that entry from its caption, description, or accompanying material; a generic homepage link is not enough. Where the format cannot carry that link, credit must appear with the promotion. Private names, email addresses, and other private contact details will not be used as credit.",
    "You may approve only rights you hold or are authorized to license. A posting credit does not establish copyright ownership. Mshpit must separately clear any additional rights needed for the intended use, including music, performances, other people's likenesses, or third-party material. Edits must not materially misrepresent you or the content, imply an endorsement you did not approve, or remove required third-party attribution. This permission does not transfer copyright or waive moral rights.",
    "You can withdraw promotional permission through Support at any time without losing your account. Making the approved content private, deleting it, or deleting your account also ends permission for new promotional use. Mshpit will stop new uses and promptly pause or remove promotional copies it controls, including active paid ads, and remove or revise the corresponding public credit entry as needed to respect your privacy. Copies already distributed by third parties may not be fully retrievable, but that does not authorize Mshpit to keep publishing or running ads. Limited private records may be retained where needed to document permission, withdrawal, or legal obligations; they do not authorize further promotion.",
  ]),
});

export const PROMOTIONAL_CONTENT_PRIVACY = Object.freeze({
  heading: "Optional promotional content and source credits",
  paragraphs: Object.freeze([
    "Mshpit may use specific public content in its social-media posts or paid ads only after you separately approve the content, channels, period, and public credit in writing through Support or a dedicated permission control if one becomes available. This is optional; existing content and artist-page, spotlight, email, or analytics permissions are not automatically included. Private posts, drafts, messages, and non-public account information are excluded.",
    "For an approved use, the agreed content and public name or handle can be shared with the approved social or advertising service and shown on a public credits/source entry visibly linked from the promotion. Those services may process the published material under their own policies. Permission and withdrawal records are kept privately, not on the credits page. You can withdraw through Support; making the content private or deleting it or your account also ends permission for new use. Mshpit will stop new uses, promptly pause or remove copies it controls, and remove or revise public credits as needed for privacy. Third-party copies may not be fully retrievable. The Terms explain the licence and attribution requirements.",
  ]),
});

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
