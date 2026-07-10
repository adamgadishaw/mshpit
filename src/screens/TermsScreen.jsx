import PolicyScreen from "./PolicyScreen";

// Terms & conditions. Presented (and agreed to) at sign-up alongside the Privacy
// policy. Covers eligibility, acceptable use, content licensing, the ad-supported
// model, disclaimers, and account termination.
export default function TermsScreen({ onClose }) {
  return (
    <PolicyScreen
      title="Terms & conditions"
      updated="July 2026"
      onClose={onClose}
      note="These terms form a binding agreement between you and Pit. If you don't agree with them, don't use Pit. Questions can go to the team from your profile."
      intro="Welcome to Pit. By creating an account or using Pit you agree to these Terms & Conditions and to our Privacy policy, which explains how we collect and use your data, including for advertising. Please read both carefully."
      sections={[
        { h: "Eligibility", p: "You must be at least 13 years old (or the minimum age required in your country) to use Pit, and legally able to enter this agreement. One account per person unless we approve otherwise. Artist accounts are reviewed and verified before approval." },
        { h: "Your account", p: "Provide accurate information at sign-up and keep it current. You're responsible for your login credentials and for all activity under your account. Tell us right away if you suspect unauthorized use. We may refuse, suspend, or reclaim usernames and accounts to protect the service or comply with the law." },
        { h: "Acceptable use", p: "Only log and review shows you actually attended. Don't post spam, hate speech, harassment, threats, illegal content, or anyone's private information; don't impersonate others, manipulate ratings, scrape the service, interfere with its operation, or attempt to access it in unauthorized ways. You agree to follow all applicable laws while using Pit." },
        { h: "Your content & licence", p: "You keep ownership of the reviews, photos, messages, and other content you create. By posting, you grant Pit a worldwide, non-exclusive, royalty-free licence to host, store, reproduce, adapt, display, and distribute that content to operate, promote, and improve the service (for example in feeds, discovery surfaces, and previews). This licence ends when you delete the content or your account, except for copies retained for backups, legal reasons, or where already shared with others." },
        { h: "Advertising & the free service", p: "Pit is free and supported by advertising. You agree that we may display ads and sponsored content, and that we may use your information as described in the Privacy policy, including building interest profiles and targeting, capping, and measuring ads. Ads may appear alongside your content and others'." },
        { h: "Moderation & enforcement", p: "Content is public when posted; the community can report it and moderators act on reports. We may remove content, limit features, or suspend or terminate accounts that break these terms or harm the community or service, and we keep a record of moderation actions. Where practical we'll explain enforcement, but we may act immediately in serious cases." },
        { h: "Tickets & third parties", p: "Ticket links and some content point to third-party providers (e.g. Ticketmaster). Purchases, their terms, and any issues are handled by those providers, Pit is not the seller and isn't responsible for those transactions or external sites." },
        { h: "Disclaimers & liability", p: "Pit is provided “as is” and “as available,” without warranties of any kind. Ratings and recommendations are community-driven and offered without guarantees. To the fullest extent permitted by law, Pit isn't liable for indirect, incidental, or consequential damages, and our total liability is limited to the amount you paid us (which for a free account is zero)." },
        { h: "Termination", p: "You can stop using Pit and delete your account at any time. We may suspend or end your access if you break these terms or if we discontinue the service. Sections meant to survive termination (licences already granted, disclaimers, and limits of liability) continue to apply." },
        { h: "Changes & governing law", p: "We may update these terms as Pit develops and will change the date above when we do; continuing to use Pit means you accept the changes. These terms are governed by the laws applicable where Pit operates, and disputes will be handled by the courts with jurisdiction there, except where local consumer law gives you other rights." },
      ]}
    />
  );
}
