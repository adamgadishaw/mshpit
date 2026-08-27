export const RIGHT_RAIL_EVENT_SCOPE = Object.freeze({
  NEAR: "near",
  WORLD: "world",
});

const identityPart = (value, fallback) => {
  const normalized = String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  return normalized || fallback;
};

export function rightRailScopeIdentity({ accountId, homeCity } = {}) {
  return `${identityPart(accountId, "guest")}::${identityPart(homeCity, "world")}`;
}

export function rightRailDefaultScope({ homeCity } = {}) {
  return String(homeCity || "").trim()
    ? RIGHT_RAIL_EVENT_SCOPE.NEAR
    : RIGHT_RAIL_EVENT_SCOPE.WORLD;
}

export function reconcileRightRailScopeChoice(choice, context = {}) {
  const identity = rightRailScopeIdentity(context);
  const fallback = rightRailDefaultScope(context);
  if (!choice || choice.identity !== identity) {
    return { identity, value: fallback, touched: false };
  }
  const value = choice.value === RIGHT_RAIL_EVENT_SCOPE.NEAR || choice.value === RIGHT_RAIL_EVENT_SCOPE.WORLD
    ? choice.value
    : fallback;
  return { identity, value, touched: choice.touched === true };
}

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
