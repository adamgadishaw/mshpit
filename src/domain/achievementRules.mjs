// Award predicates and points used by the store. Legend copy stays lazy.
export const ACHIEVEMENT_RULES = Object.freeze([
  { id: "first_show", points: 25, test: (stats) => stats.shows >= 1 },
  { id: "regular", points: 75, test: (stats) => stats.shows >= 10 },
  { id: "road_warrior", points: 200, test: (stats) => stats.shows >= 25 },
  { id: "critic", points: 100, test: (stats) => stats.reviews >= 10 },
  { id: "tastemaker", points: 150, test: (stats) => stats.likes >= 100 },
  { id: "superfan", points: 80, test: (stats) => stats.fanClubs >= 3 },
  { id: "connector", points: 90, test: (stats) => stats.follows >= 25 },
  { id: "photographer", points: 120, test: (stats) => stats.photos >= 20 },
  { id: "globetrotter", points: 160, test: (stats) => stats.cities >= 5 },
  { id: "explorer", points: 110, test: (stats) => stats.artists >= 10 },
]);
