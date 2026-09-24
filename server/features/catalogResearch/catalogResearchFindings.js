// What the research agent may publish, and the checks every finding passes
// before it can reach a page. The model proposes; this module decides. Every
// fact must cite a page the agent actually opened through web search in the
// same run, so a source can never be invented.

export const CATALOG_RESEARCH_FACTS = Object.freeze({
  artist: Object.freeze({
    origin: "From",
    active_since: "Active since",
    genres: "Genres",
    members: "Members",
    website: "Official site",
  }),
  venue: Object.freeze({
    address: "Address",
    capacity: "Capacity",
    opened: "Opened",
    venue_type: "Type",
    also_known_as: "Also known as",
    website: "Official site",
  }),
});

const SUMMARY_MIN = 60;
const SUMMARY_MAX = 700;
const FACT_MAX = 160;
const MAX_FACTS = 8;
const MAX_IMAGES = 3;
const COMMONS_FILE = /^https:\/\/commons\.wikimedia\.org\/wiki\/File:[^\s?#]{3,240}$/u;

function cleanText(value, max) {
  if (typeof value !== "string") return "";
  return value
    // House style: no em or en dashes, no markdown, one line.
    .replace(/\s*[—–]\s*/gu, ", ")
    .replace(/[*_`#>]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
}

export function httpsUrl(value) {
  if (typeof value !== "string" || value.length > 1_000 || /[\u0000- \u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname.includes(".")
        || /^(?:localhost|.*\.local|\d+(?:\.\d+){3}|\[.*\])$/iu.test(url.hostname)) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

// Search results and citations may differ from the model's copy by a trailing
// slash or tracking fragment; compare on a normalised form.
export function sourceKey(value) {
  const url = httpsUrl(value);
  if (!url) return null;
  const parsed = new URL(url);
  parsed.hostname = parsed.hostname.replace(/^www\./u, "");
  return `${parsed.hostname}${parsed.pathname.replace(/\/+$/u, "")}${parsed.search}`.toLowerCase();
}

function mentionsName(text, name) {
  const words = String(name || "").toLowerCase().replace(/^the\s+/u, "").split(/\s+/u).filter((word) => word.length > 1);
  const haystack = text.toLowerCase();
  return words.length > 0 && words.every((word) => haystack.includes(word));
}

// Returns the publishable record, or a reason it cannot be published.
export function validateCatalogResearchFindings(input, { type, name, searchedUrls } = {}) {
  const allowed = CATALOG_RESEARCH_FACTS[type];
  if (!allowed) return { ok: false, reason: "unknown_type" };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, reason: "no_findings" };
  if (input.match === "not_found") return { ok: false, reason: "not_found" };
  if (input.match !== "confident") return { ok: false, reason: "unsure" };
  const searched = new Map();
  for (const url of searchedUrls || []) {
    const key = sourceKey(url);
    if (key && !searched.has(key)) searched.set(key, httpsUrl(url));
  }
  const cited = (value) => {
    const key = sourceKey(value);
    return key && searched.has(key) ? searched.get(key) : null;
  };

  const summary = cleanText(input.summary, SUMMARY_MAX);
  if (summary.length < SUMMARY_MIN) return { ok: false, reason: "summary_too_short" };
  if (/https?:\/\/|www\./iu.test(summary)) return { ok: false, reason: "summary_has_links" };
  if (/\b(?:as an ai|i (?:could not|couldn't|found)|my search|search results?)\b/iu.test(summary)) {
    return { ok: false, reason: "summary_not_about_subject" };
  }
  if (!mentionsName(summary, name)) return { ok: false, reason: "summary_missing_name" };
  const summarySources = [...new Set((Array.isArray(input.summarySources) ? input.summarySources : [])
    .map(cited).filter(Boolean))].slice(0, 4);
  if (!summarySources.length) return { ok: false, reason: "summary_uncited" };

  const facts = [];
  const seen = new Set();
  for (const fact of Array.isArray(input.facts) ? input.facts.slice(0, 20) : []) {
    const field = typeof fact?.field === "string" ? fact.field : "";
    if (!Object.hasOwn(allowed, field) || seen.has(field)) continue;
    const source = cited(fact.source);
    if (!source) continue;
    let value = cleanText(fact.value, FACT_MAX);
    if (field === "website") value = httpsUrl(fact.value) || "";
    if (field === "capacity") {
      const digits = Number(String(fact.value || "").replace(/[,\s]/gu, ""));
      value = Number.isSafeInteger(digits) && digits >= 20 && digits <= 250_000 ? digits.toLocaleString("en-US") : "";
    }
    if ((field === "active_since" || field === "opened")) {
      const year = /\b(1[5-9]\d\d|20\d\d)\b/u.exec(value)?.[1];
      value = year && Number(year) <= new Date().getUTCFullYear() ? year : "";
    }
    if (!value) continue;
    seen.add(field);
    facts.push({ field, value, source });
    if (facts.length >= MAX_FACTS) break;
  }

  const images = [...new Set((Array.isArray(input.images) ? input.images : [])
    .filter((value) => typeof value === "string" && COMMONS_FILE.test(value.trim()))
    .map((value) => value.trim()))].slice(0, MAX_IMAGES);

  return { ok: true, record: { version: 1, summary, summarySources, facts, images } };
}

// The shape pages receive. Sources are listed once, in first-use order.
export function publicCatalogResearch(type, record, { researchedAt } = {}) {
  const labels = CATALOG_RESEARCH_FACTS[type];
  if (!labels || !record || record.version !== 1 || typeof record.summary !== "string") return null;
  const sources = [];
  const addSource = (url) => {
    const safe = httpsUrl(url);
    if (safe && !sources.some((item) => item.url === safe)) {
      sources.push({ url: safe, site: new URL(safe).hostname.replace(/^www\./u, "") });
    }
  };
  (record.summarySources || []).forEach(addSource);
  const facts = (record.facts || [])
    .filter((fact) => Object.hasOwn(labels, fact?.field) && typeof fact.value === "string" && httpsUrl(fact.source))
    .map((fact) => {
      addSource(fact.source);
      return { field: fact.field, label: labels[fact.field], value: fact.value, sourceUrl: httpsUrl(fact.source) };
    });
  return {
    summary: record.summary,
    facts,
    sources,
    researchedAt: Number.isSafeInteger(researchedAt) ? researchedAt : null,
  };
}
