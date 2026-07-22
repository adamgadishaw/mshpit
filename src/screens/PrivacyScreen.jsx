import PolicyScreen from "./PolicyScreen";

// Plain-language product disclosure. This reflects the controls and retention
// implemented in the app; it deliberately avoids promising legal compliance.
// Counsel should review it before a public commercial launch.
export default function PrivacyScreen({ onClose }) {
  return (
    <PolicyScreen
      title="Privacy policy"
      updated="July 2026"
      onClose={onClose}
      note="This policy explains, in plain terms, what Pit currently collects and how it is used. You can download or delete your account data and turn optional product analytics off from Settings. Contact the team for access, correction, or privacy requests."
      intro="Pit is a social service for logging concerts, rating them, and following people whose taste matches yours. We use account and activity data to operate the service, protect it from abuse, and personalize music and local-show features. This policy describes what we collect, why, and the choices you have."
      sections={[
        { h: "Information you give us", p: "Account details (name, email, password, and the city you choose), your profile (bio, avatar, genres, favorite artists, playlists), and everything you create on Pit: reviews, ratings, photos, comments, fan-club and lounge messages, direct messages, follows, and who/what you engage with." },
        { h: "Information we collect automatically", p: "For signed-in accounts that have product analytics enabled, Pit records a limited, server-approved set of events such as opening an artist or venue, playing a track, following, liking, posting, and a privacy-filtered search term. Guests are not recorded in product analytics. Like every web service, Pit receives an IP address and basic request details when a device connects; those details may be processed briefly for security and rate limiting, but raw IP addresses are not retained in the product-analytics table." },
        { h: "Cookies & similar technologies", p: "Pit uses first-party session cookies and local storage to keep you signed in, restore navigation, remember preferences, and make the app work. The embedded YouTube player can use Google or YouTube technologies under their own policies. Most browsers let you clear or block stored data, though sign-in and other features may stop working." },
        { h: "How we use your data", p: "To provide and secure the service; deliver your feed, messages, local discovery, recommendations, search, playback, and account support; understand aggregate feature health; develop new features; detect abuse and enforce our Terms; and communicate with you when needed." },
        { h: "Advertising & profiling", p: "Pit is designed to support an advertising-funded service, but the current first-party product analytics system is not an ad-network integration and does not send your event history or searches to advertisers. If Pit later adds third-party advertising or materially changes profiling, this policy and the relevant choices will be updated before that use begins." },
        { h: "How we share data", p: "With service providers that host, secure, deliver email for, and operate Pit on our behalf; with YouTube when you use the embedded player; with other users according to the feature you use (for example, a public review is public while a direct message is shown to its participants); and when required by law or reasonably necessary to protect people and the service. A business transfer may include data subject to appropriate safeguards." },
        {
          h: "YouTube API Services",
          p: "Pit uses YouTube API Services and an embedded YouTube player to resolve and play requested tracks. When you use the player, Google and YouTube may receive information such as your IP address, device and browser details, the video requested, and your interactions with the embedded player, and may use cookies or similar technologies according to Google's privacy practices. Pit does not receive your YouTube password or download YouTube videos.",
          links: [
            { label: "Google Privacy Policy", url: "https://policies.google.com/privacy" },
            { label: "YouTube Terms of Service", url: "https://www.youtube.com/t/terms" },
          ],
        },
        { h: "Your choices & rights", p: "You can edit your profile, download a portable account backup, delete content, block accounts, turn product analytics off, or permanently delete your account from Settings. Turning analytics off deletes that account's existing product-event rows and prevents new ones from being recorded. Depending on where you live, additional access, correction, deletion, objection, or restriction rights may apply; contact the team to make a request." },
        { h: "Data retention & security", p: "Account and content data is kept while needed to operate the account and service. First-party product analytics is automatically limited to a rolling period of up to 180 days by default and is deleted earlier when you opt out or delete your account. Passwords are hashed, sessions use secure signed-in requests over HTTPS in production, and access is limited, but no online service can promise perfect security." },
        { h: "Children", p: "Pit isn't directed to children under 13 (or the minimum age in your country), and we don't knowingly collect their data. If you believe a child has created an account, contact us and we'll remove it." },
        { h: "Changes", p: "We'll update this policy as Pit grows and will change the date above when we do. If we make material changes to how we use your data for advertising, we'll take reasonable steps to let you know." },
      ]}
    />
  );
}
