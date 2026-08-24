const text = (value) => typeof value === "string" ? value.trim() : "";

// Keep the artist in the noun phrase: "in a SZA post" reads naturally, while
// the generic notification suffix would produce "in a post of SZA".
export function postTagNotificationPhrase(artist) {
  const name = text(artist);
  return name ? `tagged you in a ${name} post` : "tagged you in a post";
}

export function postTagNotificationCopy(actorName, artist) {
  return `${text(actorName) || "Someone"} ${postTagNotificationPhrase(artist)}`;
}
