// Single source of truth for badge meaning and achievement policy. Visual badge
// art stays in the UI; these labels, thresholds, points, and predicates are
// platform-neutral and shared with the server rewards engine.

export const STATUS_BADGES = Object.freeze({
  verified: { label: "Verified", desc: "Identity confirmed by the Pit team.", how: "Granted by an admin to real, notable accounts." },
  sponsor: { label: "Sponsor", desc: "An official Pit partner or sponsor.", how: "Granted by the Pit team to partners." },
  top100: { label: "Top 100", desc: "One of the 100 most popular artists on Pit.", how: "Rank in the global Top 100 by popularity." },
  staff: { label: "Pit Team", desc: "Works on Pit.", how: "Reserved for staff." },
  mod: { label: "Moderator", desc: "Keeps the community healthy.", how: "Appointed by an admin." },
  founder: { label: "Founder", desc: "Built Pit.", how: "Reserved." },
  artist: { label: "Verified Artist", desc: "An official, claimed artist account.", how: "Claim your artist page; an admin approves." },
});

export const ACHIEVEMENTS = Object.freeze([
  { id: "first_show", label: "First Pit", icon: "ticket", tint: "amber", points: 25, desc: "Logged your first show.", how: "Log 1 show.", test: (stats) => stats.shows >= 1, goal: (stats) => Math.min(1, stats.shows), target: 1 },
  { id: "regular", label: "Regular", icon: "ticket", tint: "amber", points: 75, desc: "Ten nights on the books.", how: "Log 10 shows.", test: (stats) => stats.shows >= 10, goal: (stats) => Math.min(10, stats.shows), target: 10 },
  { id: "road_warrior", label: "Road Warrior", icon: "map", tint: "magenta", points: 200, desc: "A serious gig-going habit.", how: "Log 25 shows.", test: (stats) => stats.shows >= 25, goal: (stats) => Math.min(25, stats.shows), target: 25 },
  { id: "critic", label: "Critic", icon: "edit", tint: "cool", points: 100, desc: "Ten written reviews.", how: "Write 10 reviews (not just a score).", test: (stats) => stats.reviews >= 10, goal: (stats) => Math.min(10, stats.reviews), target: 10 },
  { id: "tastemaker", label: "Tastemaker", icon: "heart", tint: "magenta", points: 150, desc: "The crowd rates YOU.", how: "Earn 100 likes across your posts.", test: (stats) => stats.likes >= 100, goal: (stats) => Math.min(100, stats.likes), target: 100 },
  { id: "superfan", label: "Superfan", icon: "comment", tint: "amber", points: 80, desc: "Deep in the fan clubs.", how: "Join 3 fan clubs.", test: (stats) => stats.fanClubs >= 3, goal: (stats) => Math.min(3, stats.fanClubs), target: 3 },
  { id: "connector", label: "Connector", icon: "you", tint: "cool", points: 90, desc: "Building your scene.", how: "Follow 25 people.", test: (stats) => stats.follows >= 25, goal: (stats) => Math.min(25, stats.follows), target: 25 },
  { id: "photographer", label: "Photographer", icon: "camera", tint: "good", points: 120, desc: "Bringing the night to life.", how: "Post 20 show photos.", test: (stats) => stats.photos >= 20, goal: (stats) => Math.min(20, stats.photos), target: 20 },
  { id: "globetrotter", label: "Globetrotter", icon: "map", tint: "good", points: 160, desc: "Shows across many cities.", how: "See shows in 5 different cities.", test: (stats) => stats.cities >= 5, goal: (stats) => Math.min(5, stats.cities), target: 5 },
  { id: "explorer", label: "Explorer", icon: "discover", tint: "amber", points: 110, desc: "A wide-ranging ear.", how: "Review 10 different artists.", test: (stats) => stats.artists >= 10, goal: (stats) => Math.min(10, stats.artists), target: 10 },
]);

export const TINT = Object.freeze({ amber: "amber", magenta: "magenta", cool: "cool", good: "good", gold: "gold" });

export function pointsTier(points) {
  if (points >= 900) return { name: "Legend", start: 900, next: null };
  if (points >= 500) return { name: "Headliner", start: 500, next: 900 };
  if (points >= 250) return { name: "Regular", start: 250, next: 500 };
  if (points >= 75) return { name: "Opener", start: 75, next: 250 };
  return { name: "Newcomer", start: 0, next: 75 };
}
