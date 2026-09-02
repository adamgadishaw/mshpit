const text = (value, max = 160) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/gu, "").replace(/\s+/gu, " ").trim().slice(0, max)
  : "";

export const EMPTY_MESSAGE_RELATIONSHIP_CONTEXT = Object.freeze({
  artist: false,
  friend: false,
  following: false,
  followsYou: false,
  concertBuddy: false,
  sharedShow: null,
});

export function normalizeMessageRelationshipContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY_MESSAGE_RELATIONSHIP_CONTEXT;
  const date = text(value.sharedShow?.date, 10);
  const artist = text(value.sharedShow?.artist);
  const venue = text(value.sharedShow?.venue);
  const sharedShow = /^\d{4}-\d{2}-\d{2}$/u.test(date) && artist && venue ? {
    artist,
    venue,
    city: text(value.sharedShow?.city, 120) || null,
    date,
    source: value.sharedShow?.source === "visible_attendance" ? "visible_attendance" : "public_reviews",
  } : null;
  const following = value.following === true;
  const followsYou = value.followsYou === true;
  return {
    artist: value.artist === true,
    friend: value.friend === true && following && followsYou,
    following,
    followsYou,
    concertBuddy: value.concertBuddy === true,
    sharedShow,
  };
}

export function messageRelationshipChips(value) {
  const context = normalizeMessageRelationshipContext(value);
  const chips = [];
  if (context.artist) chips.push({ key: "artist", label: "Artist" });
  if (context.friend) chips.push({ key: "friend", label: "Friends" });
  else {
    if (context.following) chips.push({ key: "following", label: "Following" });
    if (context.followsYou) chips.push({ key: "follows-you", label: "Follows you" });
  }
  if (context.concertBuddy) chips.push({ key: "concert-buddy", label: "Concert buddy" });
  if (context.sharedShow) chips.push({ key: "same-show", label: "Same show" });
  return chips;
}

export function messageRelationshipSummary(value) {
  const context = normalizeMessageRelationshipContext(value);
  if (context.sharedShow) {
    const place = [context.sharedShow.artist, context.sharedShow.venue, context.sharedShow.date].filter(Boolean).join(" · ");
    return `Both logged the same show: ${place}.`;
  }
  if (context.concertBuddy) return "You're tagged together in a concert post.";
  if (context.friend) return "You follow each other.";
  if (context.following) return "You follow this member.";
  if (context.followsYou) return "This member follows you.";
  if (context.artist) return "This is an artist account.";
  return "";
}
