import { journeyMenuModel } from "./menuJourney.mjs";

// iOS presentation only. Reuse the shared authorization model and the actual
// supplied callbacks, so regrouping never invents or strands a destination.
export function iosMenuSections({ session = null, inboxUnread = 0, notifications = 0, actions = {} } = {}) {
  const model = journeyMenuModel({ session, inboxUnread, notifications, includeCrew: typeof actions.crew === "function" });
  const sections = [
    { title: "Community", items: [
      ...model.discover.filter(item => item.key === "fanClubs"),
      ...model.connection.filter(item => item.key !== "suggestion"),
    ] },
    { title: "Explore", items: [
      ...model.discover.filter(item => item.key !== "fanClubs"),
      { key: "clips", title: "Clips", icon: "play", detail: "Watch concert clips" },
    ] },
    { title: "Account", items: session ? [
      ...model.account.filter(item => item.key !== "settings"),
      { key: "calendar", title: "Your calendar", icon: "calendar", detail: "Your upcoming shows and plans" },
      { key: "signOut", title: "Sign out", icon: "logout", detail: "Sign out of this account" },
    ] : [] },
    { title: "Settings", items: [
      ...model.account.filter(item => item.key === "settings"),
      ...model.connection.filter(item => item.key === "suggestion"),
      { key: "howItWorks", title: "How Mshpit works", icon: "discover", detail: "Learn how to use Mshpit" },
    ] },
  ];
  return sections.map(section => ({ ...section, items: section.items.filter(item => typeof actions[item.key] === "function") }))
    .filter(section => section.items.length > 0);
}


export const IOS_FEED_FILTERS = Object.freeze([
  { key: "following", title: "Following", icon: "you", detail: "Posts and reposts from people you follow" },
  { key: "local", title: "Local", icon: "pin", detail: "Concert posts from your city" },
  { key: "everyone", title: "For You", icon: "feed", detail: "Posts picked for your music interests" },
  { key: "news", title: "News", icon: "music", detail: "The latest music stories" },
]);

export function iosFeedFilterChoices(selected = "everyone") {
  const value = IOS_FEED_FILTERS.some(item => item.key === selected) ? selected : "everyone";
  return IOS_FEED_FILTERS.map(item => ({ ...item, selected: item.key === value }));
}
