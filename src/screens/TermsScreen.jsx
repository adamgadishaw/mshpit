import PolicyScreen from "./PolicyScreen";

// Terms & conditions. Presented (and agreed to) at sign-up alongside the Privacy
// policy. Covers eligibility, acceptable use, content licensing, the ad-supported
// model, disclaimers, and account termination.
export default function TermsScreen({ onClose }) {
  return (
    <PolicyScreen
      title="Terms & conditions"
      updated="August 2026"
      onClose={onClose}
      note="These terms form a binding agreement between you and Pit. If you don't agree with them, don't use Pit. Open Support from Settings if you have questions."
      intro="Welcome to Pit. By creating an account or using Pit you agree to these Terms & Conditions and to our Privacy policy, which explains how we collect and use your data. Please read both carefully."
      sections={[
        { h: "Eligibility", p: "You must be at least 13 years old (or the minimum age required in your country) to use Pit, and legally able to enter this agreement. One account per person unless we approve otherwise. Artist accounts are reviewed and verified before approval." },
        { h: "Your account", p: "Provide accurate information at sign-up and keep it current. You're responsible for your login credentials and for all activity under your account. Tell us right away if you suspect unauthorized use. We may refuse, suspend, or reclaim usernames and accounts to protect the service or comply with the law." },
        { h: "Acceptable use", p: "Only log and review shows you actually attended. Don't post spam, hate speech, harassment, threats, illegal content, or anyone's private information; don't impersonate others, manipulate ratings, scrape the service, interfere with its operation, or attempt to access it in unauthorized ways. You agree to follow all applicable laws while using Pit." },
        { h: "Your content & licence", p: "You keep ownership of the reviews, photos, messages, and other content you create. By posting, you grant Pit a worldwide, non-exclusive, royalty-free licence to host, store, reproduce, adapt, display, and distribute that content to operate, promote, and improve the service (for example in feeds, discovery surfaces, and previews). This licence ends when you delete the content or your account, except for copies retained for backups, legal reasons, or where already shared with others." },
        { h: "User inputs & accuracy", p: "Some information on Pit is entered by users: the artists, venues, tours, alternate or former venue names (\"also known as\"), setlists, and songs attached to reviews. You agree to enter this information accurately and in good faith, only where you have a reasonable basis to believe it is correct, and not to knowingly submit false, misleading, or defamatory details, for example claiming a venue changed its name or ownership when it did not. When you label a venue with an alternate or former name, you confirm you believe that name is genuinely accurate. You are responsible for what you submit. Pit does not verify every user input, may correct, merge, relabel, or remove inaccurate entries, and is not liable for user-submitted inaccuracies. Attributions to real artists and songs are for identification and community use and do not imply any endorsement by those artists." },
        { h: "Advertising & the free service", p: "Pit is designed to remain free and may in the future display advertising or sponsored content. Pit's current first-party product analytics is not an ad-network integration and does not send your event history or searches to advertisers. Before Pit introduces third-party advertising or materially changes how information is used for advertising, the Privacy policy and relevant choices will be updated. Sponsored content, if introduced, may appear alongside your content and others'." },
        { h: "Moderation & enforcement", p: "Content is public when posted; the community can report it and moderators act on reports. We may remove content, limit features, or suspend or terminate accounts that break these terms or harm the community or service, and we keep a record of moderation actions. Where practical we'll explain enforcement, but we may act immediately in serious cases." },
        { h: "Tickets & third parties", p: "Ticket links and some content point to third-party providers (e.g. Ticketmaster). Purchases, their terms, and any issues are handled by those providers, Pit is not the seller and isn't responsible for those transactions or external sites." },
        {
          h: "YouTube links in posts",
          p: "Members may attach a YouTube link to a post. Pit may use YouTube's oEmbed service to validate that link and retrieve public display metadata, but Pit does not download, host, or provide the underlying YouTube video. You are responsible for the links you share, and YouTube's Terms of Service apply when you use YouTube.",
          links: [{ label: "YouTube Terms of Service", url: "https://www.youtube.com/t/terms" }],
        },
        {
          h: "Music catalogue metadata",
          p: "Pit uses Deezer catalogue information for artist and track identification and related public metadata. That information remains controlled by Deezer and its right holders. Pit does not download or provide Deezer recordings, and catalogue references do not grant anyone rights to copy or redistribute third-party material.",
          links: [
            { label: "Deezer Developer Terms", url: "https://developers.deezer.com/termsofuse" },
            { label: "Deezer Privacy Policy", url: "https://www.deezer.com/legal/personal-datas" },
          ],
        },
        { h: "Disclaimers & liability", p: "Pit is provided \"as is\" and \"as available,\" without warranties of any kind. Ratings and recommendations are community-driven and offered without guarantees. To the fullest extent permitted by law, Pit isn't liable for indirect, incidental, or consequential damages, and our total liability is limited to the amount you paid us (which for a free account is zero)." },
        { h: "Termination", p: "You can stop using Pit and delete your account at any time. We may suspend or end your access if you break these terms or if we discontinue the service. Sections meant to survive termination (licences already granted, disclaimers, and limits of liability) continue to apply." },
        { h: "Changes & governing law", p: "We may update these terms as Pit develops and will change the date above when we do; continuing to use Pit means you accept the changes. These terms are governed by the laws applicable where Pit operates, and disputes will be handled by the courts with jurisdiction there, except where local consumer law gives you other rights." },
      ]}
    />
  );
}
