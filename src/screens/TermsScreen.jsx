import PolicyScreen from "./PolicyScreen";

export default function TermsScreen({ onClose }) {
  return (
    <PolicyScreen
      title="Terms & conditions"
      updated="July 2026"
      onClose={onClose}
      intro="By using Pit you agree to these terms. They keep the community honest and the reviews trustworthy."
      sections={[
        { h: "Your account", p: "You're responsible for what you post from your account. Provide accurate info at sign-up and keep your login secure. One account per person; artist accounts are verified before approval." },
        { h: "Posting & reviews", p: "Rate and review shows you actually attended. Don't post spam, hate speech, harassment, or anyone's private information. Reviews should reflect the live experience — the band and the room — not settle scores." },
        { h: "Content you create", p: "You keep ownership of your reviews and photos. By posting, you grant Pit a licence to display them in the app and its discovery surfaces. You can remove your content at any time." },
        { h: "Moderation", p: "Content is public when posted; the community can report it and moderators act on reports. We may remove content or suspend accounts that break these terms, and we keep a record of moderation actions." },
        { h: "Tickets & third parties", p: "Ticket links point to external providers (e.g. Ticketmaster). Purchases and their terms are handled by those providers — Pit isn't the seller and isn't responsible for those transactions." },
        { h: "No warranty", p: "Pit is provided as-is during this prototype phase. Ratings and recommendations are community-driven and offered without guarantees. Features may change as the product develops." },
      ]}
    />
  );
}
