// Group plans inside a show's Lounge: a carpool, a pre-show meetup, a hotel
// split, a spare ticket. Shared by the server rules and the Lounge screen.

export const PLAN_KINDS = Object.freeze({
  ride: "Share a ride",
  meet_before: "Meet before doors",
  hotel: "Split a hotel",
  ticket: "Spare ticket",
  pit: "Pit crew",
  other: "Something else",
});

export const PLAN_TEXT_MIN = 4;
export const PLAN_TEXT_MAX = 140;
export const PLAN_SPOTS_MIN = 1;
export const PLAN_SPOTS_MAX = 8;
export const PLAN_MESSAGE_MAX = 500;
export const PLANS_PER_HOST_PER_SHOW = 2;
export const OPEN_PLANS_PER_SHOW = 30;

export const planKindLabel = (kind) => (Object.hasOwn(PLAN_KINDS, kind) ? PLAN_KINDS[kind] : PLAN_KINDS.other);

export function planSpotsLabel(joined, spots) {
  const taken = Math.max(0, Math.floor(Number(joined) || 0));
  const total = Math.max(0, Math.floor(Number(spots) || 0));
  if (total && taken >= total) return "Full";
  return `${taken} of ${total} ${total === 1 ? "spot" : "spots"} taken`;
}
