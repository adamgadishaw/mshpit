const MAX_TICKET_URL_LENGTH = 1_000;

const PROVIDER_HOSTS = Object.freeze({
  ticketmaster: Object.freeze([
    "ticketmaster.com",
    "ticketmaster.ca",
    "ticketmaster.co.uk",
    "ticketmaster.ie",
    "ticketmaster.fr",
    "ticketmaster.de",
    "ticketmaster.es",
    "ticketmaster.it",
    "ticketmaster.nl",
    "ticketmaster.be",
    "ticketmaster.ch",
    "ticketmaster.at",
    "ticketmaster.pl",
    "ticketmaster.cz",
    "ticketmaster.dk",
    "ticketmaster.se",
    "ticketmaster.no",
    "ticketmaster.fi",
    "ticketmaster.com.au",
    "ticketmaster.co.nz",
    "ticketmaster.co.za",
    "ticketmaster.com.mx",
    "ticketmaster.com.br",
    "ticketmaster.sg",
    "ticketmaster.ae",
  ]),
  bandsintown: Object.freeze(["bandsintown.com"]),
  axs: Object.freeze(["axs.com"]),
  dice: Object.freeze(["dice.fm"]),
  eventbrite: Object.freeze([
    "eventbrite.com",
    "eventbrite.ca",
    "eventbrite.co.uk",
    "eventbrite.com.au",
    "eventbrite.de",
    "eventbrite.es",
    "eventbrite.fr",
    "eventbrite.ie",
    "eventbrite.it",
    "eventbrite.nl",
  ]),
  seetickets: Object.freeze(["seetickets.com", "seetickets.us"]),
  ticketweb: Object.freeze(["ticketweb.com", "ticketweb.ca", "ticketweb.uk"]),
  tixr: Object.freeze(["tixr.com"]),
  etix: Object.freeze(["etix.com"]),
  universe: Object.freeze(["universe.com"]),
  fever: Object.freeze(["feverup.com"]),
  frontgate: Object.freeze(["frontgatetickets.com"]),
  livenation: Object.freeze([
    "livenation.com",
    "livenation.ca",
    "livenation.co.uk",
    "livenation.com.au",
    "livenation.de",
    "livenation.fr",
    "livenation.es",
    "livenation.it",
  ]),
  ticketek: Object.freeze(["ticketek.com.au", "ticketek.co.nz", "ticketek.co.uk", "ticketek.sg"]),
  eventim: Object.freeze([
    "eventim.de",
    "eventim.co.uk",
    "eventim.fr",
    "eventim.nl",
    "eventim.pl",
    "eventim.cz",
    "eventim.sk",
    "eventim.hu",
    "eventim.ro",
    "eventim.si",
    "eventim.hr",
    "eventim.bg",
    "eventim.se",
    "eventim.no",
    "eventim.fi",
    "eventim.dk",
    "eventim.es",
    "eventim.pt",
    "eventim.com.br",
  ]),
  ticketone: Object.freeze(["ticketone.it"]),
});

const PROVIDER_ENTRIES = Object.freeze(Object.entries(PROVIDER_HOSTS)
  .flatMap(([provider, hosts]) => hosts.map((hostname) => Object.freeze({ provider, hostname })))
  .sort((left, right) => right.hostname.length - left.hostname.length));

const PROVIDER_SOURCE_POLICY = Object.freeze({
  ticketmaster: Object.freeze(["ticketmaster"]),
  // Bandsintown offers are an aggregator boundary and can legitimately hand
  // off to Ticketmaster, AXS, DICE, or another reviewed ticket platform.
  bandsintown: Object.freeze([]),
});
const PROTECTED_PROVIDER_TOKENS = Object.freeze([
  "ticketmaster",
  "bandsintown",
  "eventbrite",
  "seetickets",
  "ticketweb",
  "frontgatetickets",
  "livenation",
  "ticketek",
  "eventim",
  "ticketone",
  "feverup",
]);
const SPECIAL_USE_HOSTS = Object.freeze([
  "localhost",
  "local",
  "localdomain",
  "internal",
  "lan",
  "home",
  "corp",
  "test",
  "example",
  "invalid",
  "home.arpa",
  "onion",
]);

const INVALID_TICKET_LINK = Object.freeze({
  valid: false,
  url: "",
  hostname: "",
  provider: null,
  trusted: false,
  requiresConfirmation: false,
  reason: "invalid",
});

function invalidTicketLink(reason) {
  return Object.freeze({ ...INVALID_TICKET_LINK, reason });
}

function hostMatches(hostname, base) {
  return hostname === base || hostname.endsWith(`.${base}`);
}

function trustedProvider(hostname) {
  return PROVIDER_ENTRIES.find((entry) => hostMatches(hostname, entry.hostname))?.provider || null;
}

function embeddedTrustedHostname(hostname) {
  const framed = `.${hostname}.`;
  return PROVIDER_ENTRIES.some((entry) => framed.includes(`.${entry.hostname}.`)
    && !hostMatches(hostname, entry.hostname));
}

function providerBrandLookalike(hostname) {
  const compact = hostname.replace(/[^a-z0-9]/g, "");
  return PROTECTED_PROVIDER_TOKENS.some((token) => compact.includes(token));
}

function validHostname(hostname) {
  if (!hostname || hostname.length > 253 || hostname.endsWith(".") || hostname.includes(":")) return false;
  if (/^\d+(?:\.\d+){3}$/.test(hostname)) return false;
  if (SPECIAL_USE_HOSTS.some((special) => hostMatches(hostname, special))) return false;
  const labels = hostname.split(".");
  if (labels.length < 2) return false;
  if (labels.some((label) => !label || label.length > 63 || !/^[a-z0-9-]+$/.test(label)
    || label.startsWith("-") || label.endsWith("-"))) return false;
  const suffix = labels.at(-1);
  return /^[a-z]{2,63}$/.test(suffix) || /^xn--[a-z0-9-]{2,59}$/.test(suffix);
}

function rawAuthority(value) {
  const match = String(value).match(/^https:\/\/([^/?#]*)/i);
  return match?.[1] || "";
}

/**
 * Parse and classify a ticket destination without granting trust merely because
 * it uses HTTPS. Known ticket providers can open directly; an owner-authored
 * public hostname remains usable but requires an explicit hostname prompt.
 */
export function ticketUrlDecision(value, { source = null, allowUntrusted = true } = {}) {
  if (value == null || value === "") return invalidTicketLink("empty");
  if (typeof value !== "string") return invalidTicketLink("type");
  const raw = value.trim();
  if (!raw || raw.length > MAX_TICKET_URL_LENGTH || /[\u0000-\u001f\u007f]/.test(raw)) {
    return invalidTicketLink("malformed");
  }
  const authority = rawAuthority(raw);
  if (!authority || authority.includes("%") || authority.includes("\\")) return invalidTicketLink("authority");

  let parsed;
  try { parsed = new URL(raw); }
  catch { return invalidTicketLink("malformed"); }
  const authorityHost = authority.slice(authority.lastIndexOf("@") + 1);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port
    || authorityHost.startsWith("[") || /:\d+$/.test(authorityHost)) {
    return invalidTicketLink("transport");
  }

  const hostname = parsed.hostname.toLowerCase();
  const provider = trustedProvider(hostname);
  if (!validHostname(hostname)
    || (!provider && (embeddedTrustedHostname(hostname) || providerBrandLookalike(hostname)))) {
    return invalidTicketLink("hostname");
  }
  const normalizedSource = String(source || "").trim().toLowerCase();
  const sourcePolicy = PROVIDER_SOURCE_POLICY[normalizedSource];
  if (sourcePolicy && (!provider || (sourcePolicy.length && !sourcePolicy.includes(provider)))) {
    return invalidTicketLink("provider_host_mismatch");
  }
  if (!provider && !allowUntrusted) return invalidTicketLink("untrusted_provider");

  parsed.hash = "";
  const url = parsed.toString();
  if (url.length > MAX_TICKET_URL_LENGTH) return invalidTicketLink("length");
  return Object.freeze({
    valid: true,
    url,
    hostname,
    provider,
    trusted: !!provider,
    requiresConfirmation: !provider,
    reason: null,
  });
}

export function canonicalTicketUrl(value, options) {
  return ticketUrlDecision(value, options).url;
}

/** Revalidate persisted rows at every public projection boundary. */
export function projectedTourDateTicketUrl(row) {
  const source = String(row?.source || "").trim().toLowerCase();
  const ownerId = row?.owner_id ?? row?.ownerId ?? null;
  return canonicalTicketUrl(row?.ticket_url ?? row?.ticketUrl ?? "", {
    source,
    allowUntrusted: !!ownerId && !Object.hasOwn(PROVIDER_SOURCE_POLICY, source),
  });
}

export async function followTicketLink(value, { confirmDestination, openUrl } = {}) {
  const decision = ticketUrlDecision(value, { allowUntrusted: true });
  if (!decision.valid) return Object.freeze({ status: "rejected", decision });
  if (typeof openUrl !== "function") return Object.freeze({ status: "failed", decision });

  if (decision.requiresConfirmation) {
    if (typeof confirmDestination !== "function") return Object.freeze({ status: "rejected", decision });
    try {
      if (!await confirmDestination(decision)) return Object.freeze({ status: "cancelled", decision });
    } catch {
      return Object.freeze({ status: "failed", decision });
    }
  }

  try {
    await openUrl(decision.url);
    return Object.freeze({ status: "opened", decision });
  } catch {
    return Object.freeze({ status: "failed", decision });
  }
}
