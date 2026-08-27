import PolicyScreen from "./PolicyScreen";
import {
  ANNOUNCEMENT_EMAIL_DISCLOSURE,
  MEDIA_AND_SESSION_SECURITY_DISCLOSURE,
  PRIVACY_POLICY_UPDATED,
  PROFILE_SEARCH_INDEXING_DISCLOSURE,
} from "../domain/privacyDisclosures.mjs";

// Plain-language product disclosure. This reflects the controls and retention
// implemented in the app; it deliberately avoids promising legal compliance.
// Counsel should review it before a public commercial launch.
export default function PrivacyScreen({ onClose }) {
  return (
    <PolicyScreen
      title="Privacy policy"
      updated={PRIVACY_POLICY_UPDATED}
      onClose={onClose}
      note="This policy explains, in plain terms, what Pit currently collects and how it is used. You can download or delete your account data and turn optional product analytics off from Settings. Contact the team for access, correction, or privacy requests."
      intro="Pit is a social service for logging concerts, rating them, and following people whose taste matches yours. We use account and activity data to operate the service, protect it from abuse, and personalize music and local-show features. This policy describes what we collect, why, and the choices you have."
      sections={[
        { h: "Information you give us", p: "Account details (name, email, password, and the city you choose), your profile (bio, avatar, genres, and favorite artists), feed preferences such as Not for me, and everything you create on Pit: reviews, ratings, photos, comments, fan-club and lounge messages, direct messages, follows, and other content or settings you save. The suggestion box accepts an anonymous category, message, and optional general area of Pit; Pit does not attach the suggestion to an account or ask for contact details." },
        { h: "Information we collect automatically", p: "For signed-in accounts that have product analytics enabled, Pit records a limited, server-approved set of categorical events such as screen and feed usage, internal post impressions, opening content, time-range buckets, following, liking, and posting. Separately, when a guest searches, Pit increments daily aggregate counters for the search category, success or failure, and a coarse result-count range. These guest counters do not contain typed words, account or device identifiers, cookies, URLs, IP addresses, user agents, or exact request times, and cannot identify a unique visitor. Like every web service, Pit receives an IP address and basic request details when a device connects; those details may be processed briefly for security and rate limiting, but raw IP addresses are not retained in product analytics or suggestion records." },
        { h: "Cookies & similar technologies", p: "Pit uses first-party session cookies and local storage to keep you signed in, restore navigation, remember preferences, and make the app work. Links to third-party services are governed by those services' own privacy and cookie policies when you open them. Most browsers let you clear or block stored data, though sign-in and other features may stop working." },
        { h: "How we use your data", p: "To provide and secure the service; deliver your feed, messages, local discovery, recommendations, search, and account support; understand aggregate feature health; develop new features; detect abuse and enforce our Terms; and communicate with you when needed." },
        { h: ANNOUNCEMENT_EMAIL_DISCLOSURE.heading, p: ANNOUNCEMENT_EMAIL_DISCLOSURE.paragraphs.join(" ") },
        { h: "Community photo spotlights", p: "Concert-review photos can be shared on an artist page when you enable public photo sharing. A separate, default-off control lets you make one eligible photo available for PIT community spotlights, including the logged-out homepage. A spotlight may show your public handle plus the artist and venue. You can turn this permission off by editing the post, make the photos private, or delete the post. PIT applies account and safety checks and may remove featured content." },
        { h: "Advertising & profiling", p: "Pit is designed to support an advertising-funded service, but the current first-party product analytics system is not an ad-network integration and does not send your event history or searches to advertisers. If Pit later adds third-party advertising or materially changes profiling, this policy and the relevant choices will be updated before that use begins." },
        { h: "How we share data", p: "With service providers that host, secure, deliver email for, and operate Pit on our behalf; with YouTube when a signed-in member asks Pit to validate a YouTube link for a post; with Deezer when Pit resolves public music-catalogue metadata; with other users according to the feature you use (for example, a public review is public while a direct message is shown to its participants); and when required by law or reasonably necessary to protect people and the service. A business transfer may include data subject to appropriate safeguards." },
        {
          h: "YouTube links shared in posts",
          p: "A signed-in member can attach a YouTube URL to a post. Pit sends the canonical URL to YouTube's oEmbed service to validate it and retrieve public display metadata such as the title, channel name, and thumbnail, then stores the chosen link and metadata with the post. Pit does not receive your YouTube password or download YouTube videos. If you open a YouTube link, YouTube receives that visit under Google's privacy practices.",
          links: [
            { label: "Google Privacy Policy", url: "https://policies.google.com/privacy" },
            { label: "YouTube Terms of Service", url: "https://www.youtube.com/t/terms" },
          ],
        },
        {
          h: "Music catalogue metadata",
          p: "Pit uses Deezer catalogue information to help identify artists and tracks and to display available public metadata such as titles, artwork, genres, rankings, and top tracks. Pit's server may send an artist or track search term to Deezer to resolve that metadata. Pit does not receive a Deezer password or download or provide Deezer recordings.",
          links: [{ label: "Deezer Privacy Policy", url: "https://www.deezer.com/legal/personal-datas" }],
        },
        { h: "Your choices & rights", p: `You can edit your profile, download a portable account backup, delete content, block accounts, turn product analytics off, or permanently delete your account from Settings. Turning analytics off deletes that account's existing product-event rows and prevents new ones from being recorded. ${PROFILE_SEARCH_INDEXING_DISCLOSURE} Depending on where you live, additional access, correction, deletion, objection, or restriction rights may apply; contact the team to make a request.` },
        { h: "Data retention & security", p: `Account and content data is kept while needed to operate the account and service. Raw first-party product analytics is automatically limited to a rolling 30-day period by default and is deleted earlier when you opt out or delete your account. Aggregate guest-search counters are retained for up to 90 days. Closed suggestion records are pruned after 90 days and unresolved suggestions after one year. If an artist search returns no match, the submitted artist name may remain in a bounded staff enrichment queue for up to 30 days. ${MEDIA_AND_SESSION_SECURITY_DISCLOSURE} When you delete content or your account, active database records are removed or scrubbed and Pit-owned uploads are durably queued for active object-storage deletion; cleanup retries automatically and can take additional time. Separate backup copies remain until the configured retention period ends, or longer when legally required. Passwords are hashed, signed-in requests use HTTPS in production, and access is limited, but no online service can promise perfect security.` },
        { h: "Children", p: "Pit isn't directed to children under 13 (or the minimum age in your country), and we don't knowingly collect their data. If you believe a child has created an account, contact us and we'll remove it." },
        { h: "Changes", p: "We'll update this policy as Pit grows and will change the date above when we do. If we make material changes to how we use your data for advertising, we'll take reasonable steps to let you know." },
      ]}
    />
  );
}
