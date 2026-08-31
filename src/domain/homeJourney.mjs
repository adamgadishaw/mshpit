const accountScope = (accountId) => {
  const value = typeof accountId === "string" ? accountId.trim() : "";
  return value || "guest";
};

// One plain-language journey shared by the public landing and the signed-in
// feed. Keeping the order in a pure contract prevents the two entry points from
// slowly teaching different versions of the product.
export const HOME_JOURNEY_STEPS = Object.freeze([
  Object.freeze({ key: "find", label: "Find", detail: "Choose a show worth seeing." }),
  Object.freeze({ key: "attend", label: "Attend", detail: "Save the night and go." }),
  Object.freeze({ key: "log", label: "Log", detail: "Rate the artist and venue." }),
  Object.freeze({ key: "share", label: "Share", detail: "Add your memory and media." }),
  Object.freeze({ key: "connect", label: "Connect", detail: "Meet fans around the show." }),
]);

export const HOME_JOURNEY_LINE = "Find a show, log and rate it, share a review or photo, and connect with other fans.";

export function homeGuideStorageKey(accountId) {
  return `pit.home.guide.v1.${accountScope(accountId)}`;
}
