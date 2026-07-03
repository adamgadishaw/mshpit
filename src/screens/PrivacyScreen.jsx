import PolicyScreen from "./PolicyScreen";

export default function PrivacyScreen({ onClose }) {
  return (
    <PolicyScreen
      title="Privacy policy"
      updated="July 2026"
      onClose={onClose}
      intro="Pit helps you log concerts, rate them, and follow people whose taste matches yours. We keep the data we collect to what makes that work."
      sections={[
        { h: "What we collect", p: "Your account details (name, email, chosen city), the content you create (reviews, ratings, photos, playlists, messages), and who you follow. Your city powers your local feed and nearby recommendations." },
        { h: "How it's stored", p: "In this prototype build your session and data are held on your own device (in-memory and browser storage) so you stay logged in across refreshes. The production build moves this to secured servers with encrypted sessions and hashed passwords — never plain credentials in the browser." },
        { h: "Photos & takedowns", p: "Artist and venue galleries are filled from open, licensed sources first (Wikimedia Commons, Openverse). Any image can be removed on request; a pulled photo is replaced from the next available source. Your own uploaded photos are yours and can be deleted at any time." },
        { h: "What we never do", p: "We don't sell your personal data, and we don't scrape private social accounts. Tour dates and venue facts come from official, open APIs." },
        { h: "Your controls", p: "Edit or delete your profile content whenever you like, report content that breaks the rules, and log out to end your session. Deleting your account removes your posts from public view." },
      ]}
    />
  );
}
