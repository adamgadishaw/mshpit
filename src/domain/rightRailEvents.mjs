export const RIGHT_RAIL_EVENT_SCOPE = Object.freeze({
  NEAR: "near",
  WORLD: "world",
});

export function rightRailEventsForScope({
  scope = RIGHT_RAIL_EVENT_SCOPE.NEAR,
  nearEvents = [],
  worldEvents = [],
  limit = 6,
} = {}) {
  const source = scope === RIGHT_RAIL_EVENT_SCOPE.WORLD ? worldEvents : nearEvents;
  if (!Array.isArray(source)) return [];

  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 6;
  return source.slice(0, safeLimit);
}
