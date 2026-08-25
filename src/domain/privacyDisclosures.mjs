export const PRIVACY_POLICY_UPDATED = "August 25, 2026";

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
