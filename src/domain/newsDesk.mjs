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
  const names = [...new Set((Array.isArray(story?.sources) ? story.sources : [])
    .filter((source) => source?.kind !== "photo")
    .map((source) => String(source?.name || "").trim()).filter(Boolean))];
  if (!names.length) return "";
  const prefix = story?.origin === "self_written" ? "Sources:" : "Confirmed by";
  return `${prefix} ${joinNames(names.slice(0, 4))}${names.length > 4 ? ` and ${names.length - 4} more` : ""}`;
}

// A story's write-up as paragraphs (the desk separates them with a blank line).
export const newsStoryParagraphs = (body) => String(body || "").split(/\n\s*\n/u)
  .map((paragraph) => paragraph.replace(/\s+/gu, " ").trim()).filter(Boolean);

export const newsStorySources = (story, { includePhoto = false } = {}) => (Array.isArray(story?.sources) ? story.sources : [])
  .filter((source) => includePhoto || source?.kind !== "photo")
  .filter((source) => /^https:\/\//u.test(String(source?.url || "")) && String(source?.name || "").trim());

// A selected verified newsroom image takes precedence over the artist image
// fallback used by generated stories.
export const newsStoryPhoto = (story) => (Array.isArray(story?.media) ? story.media : []).find((asset) => asset?.kind === "image" && asset?.url)?.url
  || (Array.isArray(story?.artists) ? story.artists : []).find((artist) => artist?.photo)?.photo || null;
