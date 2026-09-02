const text = (value) => typeof value === "string" ? value.trim() : "";
const count = (value) => Array.isArray(value) ? value.length : 0;

const joinMissing = (items) => {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, or ${items.at(-1)}`;
};

// Helpful, not blocking: the post can still be published with the product's
// existing minimum fields. This only explains which details make a concert
// post easier for other fans to understand and respond to.
export function composerEngagementPrompt({
  kind = "review",
  experienceType = "in_person",
  canPost = false,
  artistLinked = false,
  city = "",
  tour = "",
  title = "",
  review = "",
  media = [],
  song = null,
  taggedPeople = [],
} = {}) {
  if (!canPost) return null;
  const body = text(review);

  if (kind === "status") {
    const signals = [body.length >= 24, count(media) > 0, !!song].filter(Boolean).length;
    if (signals >= 2) return null;
    const missing = [
      body.length < 24 ? "a little more context" : null,
      count(media) === 0 ? "a photo or video" : null,
    ].filter(Boolean);
    return {
      title: "Give people more to respond to",
      body: `Add ${joinMissing(missing.slice(0, 2))}. More detail helps other fans understand the post.`,
    };
  }

  const online = experienceType === "online";
  const details = online
    ? [
        [artistLinked, "choose the artist from search"],
        [text(title), "the concert or video title"],
        [body.length >= 24, "a short review"],
      ]
    : [
        [artistLinked, "choose the artist from search"],
        [text(city), "the city"],
        [text(tour), "the tour name"],
        [body.length >= 24, "a short review"],
        [count(media) > 0, "a photo or video"],
        [count(taggedPeople) > 0, "people you went with"],
      ];
  const completed = details.filter(([present]) => !!present).length;
  if (completed >= (online ? 2 : 3)) return null;
  const missing = details.filter(([present]) => !present).map(([, label]) => label).slice(0, 3);
  return {
    title: "Add a few details",
    body: `Posts usually get more replies when you add ${joinMissing(missing)}.`,
  };
}
