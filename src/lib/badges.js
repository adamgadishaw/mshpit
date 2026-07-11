// Single source of truth for what every badge MEANS — powers the hover tooltips,
// the badge legend, and the achievement/points system. Keep this in sync with the
// visual `meta()` in components/Badge.jsx (that owns the art; this owns the words).

// Status / role badges: granted, not earned by activity.
export const STATUS_BADGES = {
  verified: { label: "Verified", desc: "Identity confirmed by the Pit team.", how: "Granted by an admin to real, notable accounts." },
  sponsor: { label: "Sponsor", desc: "An official Pit partner or sponsor.", how: "Granted by the Pit team to partners." },
  top100: { label: "Top 100", desc: "One of the 100 most popular artists on Pit.", how: "Rank in the global Top 100 by popularity." },
  staff: { label: "Pit Team", desc: "Works on Pit.", how: "Reserved for staff." },
  mod: { label: "Moderator", desc: "Keeps the community healthy.", how: "Appointed by an admin." },
  founder: { label: "Founder", desc: "Built Pit.", how: "Reserved." },
  artist: { label: "Verified Artist", desc: "An official, claimed artist account.", how: "Claim your artist page; an admin approves." },
};

// Achievement badges: EARNED by using the app. `test(s)` reads a user's stats.
// `points` is what completing it is worth. Ordered easy → hard.
export const ACHIEVEMENTS = [
  { id: "first_show", label: "First Pit", icon: "ticket", tint: "amber", points: 25, desc: "Logged your first show.", how: "Log 1 show.", test: (s) => s.shows >= 1, goal: (s) => Math.min(1, s.shows), target: 1 },
  { id: "regular", label: "Regular", icon: "ticket", tint: "amber", points: 75, desc: "Ten nights on the books.", how: "Log 10 shows.", test: (s) => s.shows >= 10, goal: (s) => Math.min(10, s.shows), target: 10 },
  { id: "road_warrior", label: "Road Warrior", icon: "map", tint: "magenta", points: 200, desc: "A serious gig-going habit.", how: "Log 25 shows.", test: (s) => s.shows >= 25, goal: (s) => Math.min(25, s.shows), target: 25 },
  { id: "critic", label: "Critic", icon: "edit", tint: "cool", points: 100, desc: "Ten written reviews.", how: "Write 10 reviews (not just a score).", test: (s) => s.reviews >= 10, goal: (s) => Math.min(10, s.reviews), target: 10 },
  { id: "tastemaker", label: "Tastemaker", icon: "heart", tint: "magenta", points: 150, desc: "The crowd rates YOU.", how: "Earn 100 likes across your posts.", test: (s) => s.likes >= 100, goal: (s) => Math.min(100, s.likes), target: 100 },
  { id: "superfan", label: "Superfan", icon: "comment", tint: "amber", points: 80, desc: "Deep in the fan clubs.", how: "Join 3 fan clubs.", test: (s) => s.fanClubs >= 3, goal: (s) => Math.min(3, s.fanClubs), target: 3 },
  { id: "connector", label: "Connector", icon: "you", tint: "cool", points: 90, desc: "Building your scene.", how: "Follow 25 people.", test: (s) => s.follows >= 25, goal: (s) => Math.min(25, s.follows), target: 25 },
  { id: "photographer", label: "Photographer", icon: "camera", tint: "good", points: 120, desc: "Bringing the night to life.", how: "Post 20 show photos.", test: (s) => s.photos >= 20, goal: (s) => Math.min(20, s.photos), target: 20 },
  { id: "globetrotter", label: "Globetrotter", icon: "map", tint: "good", points: 160, desc: "Shows across many cities.", how: "See shows in 5 different cities.", test: (s) => s.cities >= 5, goal: (s) => Math.min(5, s.cities), target: 5 },
  { id: "explorer", label: "Explorer", icon: "discover", tint: "amber", points: 110, desc: "A wide-ranging ear.", how: "Review 10 different artists.", test: (s) => s.artists >= 10, goal: (s) => Math.min(10, s.artists), target: 10 },
];

export const TINT = { amber: "amber", magenta: "magenta", cool: "cool", good: "good", gold: "gold" };

// A friendly tier from total points (for a headline on the profile / legend).
export function pointsTier(points) {
  if (points >= 900) return { name: "Legend", next: null };
  if (points >= 500) return { name: "Headliner", next: 900 };
  if (points >= 250) return { name: "Regular", next: 500 };
  if (points >= 75) return { name: "Opener", next: 250 };
  return { name: "Newcomer", next: 75 };
}
