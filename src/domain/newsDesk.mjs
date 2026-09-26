// Presentation helpers for news desk stories.

const CATEGORY_LABELS = Object.freeze({
  release: "New music", tour: "Tours", festival: "Festivals", awards: "Awards", charts: "Charts",
  industry: "Music business", lineup: "Band news", death: "In memoriam", legal: "Legal", other: "Music news",
});

export const newsCategoryLabel = (category) => CATEGORY_LABELS[category] || CATEGORY_LABELS.other;

const joinNames = (names) => names.length <= 1 ? names.join("")
  : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

// "Confirmed by Billboard, Pitchfork and NME"
export function newsSourceLine(story) {
  const names = [...new Set((Array.isArray(story?.sources) ? story.sources : []).map((source) => String(source?.name || "").trim()).filter(Boolean))];
  if (!names.length) return "";
  return `Confirmed by ${joinNames(names.slice(0, 4))}${names.length > 4 ? ` and ${names.length - 4} more` : ""}`;
}

// The first artist with a photo that Discover may crop.
export const newsStoryPhoto = (story) => (Array.isArray(story?.artists) ? story.artists : []).find((artist) => artist?.photo)?.photo || null;
