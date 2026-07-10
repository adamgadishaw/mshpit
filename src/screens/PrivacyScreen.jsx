import PolicyScreen from "./PolicyScreen";

// Privacy policy. Pit is ad-supported: like other social platforms, we collect
// account, activity, device and location signals, build interest profiles from
// them, and use those to personalize content and show relevant ads. This page
// discloses that plainly; sign-up requires explicit consent to it.
export default function PrivacyScreen({ onClose }) {
  return (
    <PolicyScreen
      title="Privacy policy"
      updated="July 2026"
      onClose={onClose}
      note="This policy explains, in plain terms, the data Pit collects and how we use it, including to personalize and measure advertising. By creating an account you consent to it. You can reach the team from your profile with any request (access, correction, deletion, or opt-out where available)."
      intro="Pit is a free, ad-supported service for logging concerts, rating them, and following people whose taste matches yours. To run and pay for that service we collect data about you and your activity, build an understanding of your interests, and use it to personalize what you see, including the ads we show. This policy describes what we collect, why, and the choices you have."
      sections={[
        { h: "Information you give us", p: "Account details (name, email, password, and the city you choose), your profile (bio, avatar, genres, favorite artists, playlists), and everything you create on Pit: reviews, ratings, photos, comments, fan-club and lounge messages, direct messages, follows, and who/what you engage with." },
        { h: "Information we collect automatically", p: "How you use Pit, pages and shows you view, searches you run, artists/venues you open, taps, likes, follows, time spent, and referral/exit points. We also collect technical and device data: IP address, approximate location derived from it and from your chosen city, browser/OS/device type, and identifiers stored in cookies or local storage. This activity data is the core signal we use to personalize content and ads." },
        { h: "Cookies & similar technologies", p: "We and our advertising and analytics partners use cookies, local storage, and similar identifiers to keep you signed in, remember preferences, measure performance, and build the interest profiles used for advertising. Most browsers let you clear or block these, though parts of Pit may not work without them." },
        { h: "How we use your data", p: "To provide and secure the service; to power your local feed, recommendations, and search; to build an interest profile (e.g. genres, artists, venues, and locations you engage with) that we use to personalize content and to select, target, cap, and measure advertising; to develop new features; to detect abuse and enforce our Terms; and to communicate with you." },
        { h: "Advertising & profiling", p: "Pit shows ads and may earn revenue from them. We use the data above to infer your interests and demographics and to serve ads we think are relevant, and to measure whether ads were seen and acted on. We may share pseudonymous or aggregated audience and measurement data with advertisers and ad partners so campaigns can be targeted and reported. We do not tell advertisers who you are, and we do not sell your name, email, or password." },
        { h: "How we share data", p: "With service providers who host, secure, and operate Pit on our behalf; with advertising, analytics, and measurement partners as described above; with other users, according to your settings (your public reviews, profile, and activity are visible on Pit); and if required by law or to protect the safety and rights of people and the service. Business transfers (e.g. a merger) may include your data." },
        { h: "Your choices & rights", p: "You can view and edit your profile and content at any time, adjust what you share, and delete individual posts. Depending on where you live you may have rights to access, correct, download, or delete your personal data, and to object to or limit certain processing (including profiling for ads). Contact us from your profile to make a request; you can also clear cookies or stop using Pit at any time." },
        { h: "Data retention & security", p: "We keep account and content data while your account is active and for a reasonable period afterward, and activity/ad data for as long as needed for the purposes above or as the law requires. Passwords are hashed, sessions are signed and served over HTTPS, and access is limited, but no online service can promise perfect security." },
        { h: "Children", p: "Pit isn't directed to children under 13 (or the minimum age in your country), and we don't knowingly collect their data. If you believe a child has created an account, contact us and we'll remove it." },
        { h: "Changes", p: "We'll update this policy as Pit grows and will change the date above when we do. If we make material changes to how we use your data for advertising, we'll take reasonable steps to let you know." },
      ]}
    />
  );
}
