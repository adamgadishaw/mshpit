// One bounded set of destinations: changing sections never changes the area.
export const DISCOVER_PROGRAMME_SECTIONS = Object.freeze([
  Object.freeze({ key: "shows", label: "Shows", icon: "ticket" }),
  Object.freeze({ key: "artists", label: "Artists", icon: "music" }),
  Object.freeze({ key: "venues", label: "Venues", icon: "pin" }),
  Object.freeze({ key: "cities", label: "Cities", icon: "globe" }),
  Object.freeze({ key: "photos", label: "Photos", icon: "photo" }),
]);

export function discoverProgrammeKey(value) {
  return DISCOVER_PROGRAMME_SECTIONS.some((section) => section.key === value) ? value : "shows";
}

export function discoverProgrammeKeyboardTarget(current, key) {
  const sections = DISCOVER_PROGRAMME_SECTIONS;
  const index = sections.findIndex((section) => section.key === discoverProgrammeKey(current));
  if (key === "Home") return sections[0].key;
  if (key === "End") return sections[sections.length - 1].key;
  if (key === "ArrowRight") return sections[(index + 1) % sections.length].key;
  if (key === "ArrowLeft") return sections[(index + sections.length - 1) % sections.length].key;
  return null;
}
