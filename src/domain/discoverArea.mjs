export const DISCOVER_AREA_SCOPE = Object.freeze({
  LOCAL: "local",
  COUNTRY: "country",
});

export const DEFAULT_DISCOVER_REGION = "Worldwide";

const clean = (value, max = 160) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max)
  : "";

const accountIdentity = (value) => {
  if (value == null) return null;
  const identity = clean(String(value), 240);
  return identity || null;
};

const regionIdentity = (value) => clean(value, 120) || DEFAULT_DISCOVER_REGION;

const sameArea = (left, right) => left?.accountId === right.accountId
  && left?.region === right.region
  && left?.scope === right.scope
  && left?.touched === right.touched;

const normalizedArea = (state) => ({
  accountId: accountIdentity(state?.accountId),
  region: regionIdentity(state?.region),
  scope: state?.scope === DISCOVER_AREA_SCOPE.LOCAL
    ? DISCOVER_AREA_SCOPE.LOCAL
    : DISCOVER_AREA_SCOPE.COUNTRY,
  touched: state?.touched === true,
});

/**
 * Creates the one state object that controls both the Discover catalogue and
 * its live-event cards. A saved city starts in the nearby view; accounts with
 * no city start in their known country, or Worldwide when no country is known.
 */
export function defaultDiscoverAreaChoice({
  accountId = null,
  homeCity = "",
  homeCountry = "",
} = {}) {
  const hasHomeCity = Boolean(clean(homeCity, 120));
  return {
    accountId: accountIdentity(accountId),
    region: regionIdentity(homeCountry),
    scope: hasHomeCity ? DISCOVER_AREA_SCOPE.LOCAL : DISCOVER_AREA_SCOPE.COUNTRY,
    touched: false,
  };
}

/**
 * Produces the effective area after account/location hydration. A different
 * account always receives fresh defaults; late location data updates only a
 * choice that the person has not touched.
 */
export function resolveDiscoverAreaChoice(state, context = {}) {
  const current = normalizedArea(state);
  const accountId = accountIdentity(context?.accountId);
  const defaults = defaultDiscoverAreaChoice({ ...context, accountId });

  if (current.accountId !== accountId) return defaults;
  if (current.touched) return sameArea(state, current) ? state : current;
  return sameArea(state, defaults) ? state : defaults;
}

/**
 * Returns the next state only when account/location reconciliation changed it,
 * allowing a React effect to hydrate the same single state without loops.
 */
export function syncDiscoverAreaChoice(state, context = {}) {
  return resolveDiscoverAreaChoice(state, context);
}

/** Selecting a nation (or Worldwide) atomically moves live events with it. */
export function selectDiscoverCountryArea(state, region) {
  const current = normalizedArea(state);
  const next = {
    ...current,
    region: regionIdentity(region),
    scope: DISCOVER_AREA_SCOPE.COUNTRY,
    touched: true,
  };
  return sameArea(state, next) ? state : next;
}

/**
 * Nearby resets the chosen nation to the account's home country. Returning to
 * country/global mode deliberately retains that nation.
 */
export function selectDiscoverScopeArea(state, scope, { homeCountry = "" } = {}) {
  const current = normalizedArea(state);
  const isLocal = scope === DISCOVER_AREA_SCOPE.LOCAL;
  const next = {
    ...current,
    region: isLocal ? regionIdentity(homeCountry) : current.region,
    scope: isLocal ? DISCOVER_AREA_SCOPE.LOCAL : DISCOVER_AREA_SCOPE.COUNTRY,
    touched: true,
  };
  return sameArea(state, next) ? state : next;
}

export function discoverAreaIsLocal(state) {
  return state?.scope === DISCOVER_AREA_SCOPE.LOCAL;
}
