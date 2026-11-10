// Public badge catalog. Screens and server consumers retain the complete API.
// Startup consumers import only the status definitions or award rules they use.
import { ACHIEVEMENT_RULES } from "./achievementRules.mjs";
export { STATUS_BADGES } from "./statusBadges.mjs";

const ACHIEVEMENT_DETAILS = {
  "first_show": { label: "First Pit", icon: "ticket", tint: "amber", desc: "Logged your first show.", how: "Log 1 show.", goal: (stats) => Math.min(1, stats.shows), target: 1 },
  "regular": { label: "Regular", icon: "ticket", tint: "amber", desc: "Ten nights on the books.", how: "Log 10 shows.", goal: (stats) => Math.min(10, stats.shows), target: 10 },
  "road_warrior": { label: "Road Warrior", icon: "map", tint: "magenta", desc: "A serious gig-going habit.", how: "Log 25 shows.", goal: (stats) => Math.min(25, stats.shows), target: 25 },
  "critic": { label: "Critic", icon: "edit", tint: "cool", desc: "Ten written reviews.", how: "Write 10 reviews (not just a score).", goal: (stats) => Math.min(10, stats.reviews), target: 10 },
  "tastemaker": { label: "Tastemaker", icon: "heart", tint: "magenta", desc: "The crowd rates YOU.", how: "Earn 100 likes across your posts.", goal: (stats) => Math.min(100, stats.likes), target: 100 },
  "superfan": { label: "Superfan", icon: "comment", tint: "amber", desc: "Deep in the fan clubs.", how: "Join 3 fan clubs.", goal: (stats) => Math.min(3, stats.fanClubs), target: 3 },
  "connector": { label: "Connector", icon: "you", tint: "cool", desc: "Building your scene.", how: "Follow 25 people.", goal: (stats) => Math.min(25, stats.follows), target: 25 },
  "photographer": { label: "Photographer", icon: "camera", tint: "good", desc: "Bringing the night to life.", how: "Post 20 show photos.", goal: (stats) => Math.min(20, stats.photos), target: 20 },
  "globetrotter": { label: "Globetrotter", icon: "map", tint: "good", desc: "Shows across many cities.", how: "See shows in 5 different cities.", goal: (stats) => Math.min(5, stats.cities), target: 5 },
  "explorer": { label: "Explorer", icon: "discover", tint: "amber", desc: "A wide-ranging ear.", how: "Review 10 different artists.", goal: (stats) => Math.min(10, stats.artists), target: 10 },
};
export const ACHIEVEMENTS = Object.freeze(ACHIEVEMENT_RULES.map(rule => ({ ...rule, ...ACHIEVEMENT_DETAILS[rule.id] })));

export const TINT = Object.freeze({ amber: "amber", magenta: "magenta", cool: "cool", good: "good", gold: "gold" });

export function pointsTier(points) {
  if (points >= 900) return { name: "Legend", start: 900, next: null };
  if (points >= 500) return { name: "Headliner", start: 500, next: 900 };
  if (points >= 250) return { name: "Regular", start: 250, next: 500 };
  if (points >= 75) return { name: "Opener", start: 75, next: 250 };
  return { name: "Newcomer", start: 0, next: 75 };
}
