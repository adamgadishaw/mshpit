import { CATALOG_RESEARCH_FACTS } from "./catalogResearchFindings.js";

// One research run: Claude searches the web for a single artist or venue and
// hands back its findings through the record_findings tool. The API key stays
// in this process; only public names, places and IDs are sent.

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_CONTINUATIONS = 3;
export const CATALOG_RESEARCH_DEFAULT_MODEL = "claude-sonnet-5";
export const CATALOG_RESEARCH_MAX_SEARCHES = 5;

// USD per million tokens, from the published price list (September 2026).
const PRICES = Object.freeze({
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
});
const SEARCH_USD = 0.01;

export function catalogResearchModel(env = process.env) {
  const requested = String(env.CATALOG_RESEARCH_MODEL || "").trim();
  return Object.hasOwn(PRICES, requested) ? requested : CATALOG_RESEARCH_DEFAULT_MODEL;
}

// Cost of one run in millionths of a dollar, rounded up so the daily cap is
// never undercounted.
export function catalogResearchCostMicroUsd(model, usage = {}) {
  const price = PRICES[model] || PRICES[CATALOG_RESEARCH_DEFAULT_MODEL];
  const count = (value) => Math.max(0, Number(value) || 0);
  const usd = (count(usage.input_tokens) * price.input
    + count(usage.output_tokens) * price.output
    + count(usage.cache_read_input_tokens) * price.cacheRead
    + count(usage.cache_creation_input_tokens) * price.cacheWrite) / 1_000_000
    + count(usage.server_tool_use?.web_search_requests) * SEARCH_USD;
  return Math.ceil(usd * 1_000_000);
}

function addUsage(total, usage = {}) {
  const sum = (key) => (Number(total[key]) || 0) + (Number(usage[key]) || 0);
  return {
    input_tokens: sum("input_tokens"),
    output_tokens: sum("output_tokens"),
    cache_read_input_tokens: sum("cache_read_input_tokens"),
    cache_creation_input_tokens: sum("cache_creation_input_tokens"),
    server_tool_use: {
      web_search_requests: (Number(total.server_tool_use?.web_search_requests) || 0)
        + (Number(usage.server_tool_use?.web_search_requests) || 0),
    },
  };
}

const SYSTEM_PROMPT = `You research one music artist or one live music venue for Mshpit, a site where fans log and review concerts. Use web search to find reliable, current, public information, then call record_findings exactly once.

Rules:
- First make sure you have the right subject. Many artists and venues share names. Use every detail you are given (city, country, MusicBrainz ID, genre, upcoming shows) to tell them apart. If you cannot be confident it is the same subject, set match to "unsure". If you find nothing reliable, set match to "not_found".
- Prefer official sites, Wikipedia, MusicBrainz, AllMusic, Discogs, major newspapers and music press, venue and city websites. Avoid fan wikis, social media comments, ticket resellers and content farms.
- Every fact and the summary must be supported by a page you actually opened in this search. Give the exact URL of that page as its source. Never guess a URL.
- The summary is 2 to 4 short sentences in plain, neutral, third-person English, and names the subject. Describe the music or the venue and why fans know it. No hype, no opinions, no em dashes, no markdown, no links.
- About real people, keep to their public music career. Leave out health, relationships, legal matters, rumours and anything controversial.
- Only add a fact you can source. Leave a fact out rather than guess.
- images: up to 3 Wikimedia Commons file pages (https://commons.wikimedia.org/wiki/File:...) that clearly show this subject, only if you found them. Never any other image host.`;

function recordTool(type) {
  const fields = Object.keys(CATALOG_RESEARCH_FACTS[type]);
  return {
    name: "record_findings",
    description: `Record what you found about this ${type}. Call once, after searching.`,
    input_schema: {
      type: "object",
      properties: {
        match: { type: "string", enum: ["confident", "unsure", "not_found"] },
        summary: { type: "string", description: "2 to 4 plain sentences naming the subject. Empty if not_found." },
        summarySources: { type: "array", items: { type: "string" }, description: "URLs of pages that support the summary." },
        facts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: { type: "string", enum: fields },
              value: { type: "string" },
              source: { type: "string", description: "URL of the page that states this fact." },
            },
            required: ["field", "value", "source"],
          },
        },
        images: { type: "array", items: { type: "string" } },
      },
      required: ["match", "summary", "summarySources", "facts"],
    },
  };
}

export function catalogResearchBrief(subject) {
  const lines = [];
  if (subject.type === "artist") {
    lines.push(`Artist: ${subject.name}`);
    if (subject.mbid) lines.push(`MusicBrainz ID: ${subject.mbid} (https://musicbrainz.org/artist/${subject.mbid})`);
    if (subject.genre) lines.push(`Genre on file (may be wrong): ${subject.genre}`);
    if (subject.country) lines.push(`Country on file: ${subject.country}`);
    if (subject.shows?.length) lines.push(`Upcoming shows on file: ${subject.shows.join("; ")}`);
    lines.push("Facts to look for: origin (city and country), active_since (year they started), genres (up to 3), members (for a group, current members), website (official site).");
  } else {
    lines.push(`Venue: ${subject.name}`);
    const place = [subject.city, subject.region, subject.country].filter(Boolean).join(", ");
    if (place) lines.push(`Location: ${place}`);
    if (subject.address) lines.push(`Address on file: ${subject.address}`);
    if (subject.shows?.length) lines.push(`Upcoming shows on file: ${subject.shows.join("; ")}`);
    lines.push("Facts to look for: address (street address), capacity (a number), opened (year), venue_type (club, theatre, arena, stadium, amphitheatre, hall, bar or festival site), also_known_as (former or common names), website (official site).");
  }
  return lines.join("\n");
}

async function boundedJson(response) {
  const reader = response.body?.getReader?.();
  if (!reader) return response.json();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      // architecture: allow-empty-catch -- the oversized body is abandoned either way
      await reader.cancel().catch(() => {});
      throw Object.assign(new Error("Research response is too large."), { code: "research_response_too_large" });
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"));
}

function providerError(status, body) {
  const type = typeof body?.error?.type === "string" ? body.error.type : "";
  const code = status === 401 || status === 403 ? "research_auth"
    : status === 429 || type === "rate_limit_error" ? "research_rate_limited"
      : status === 529 || type === "overloaded_error" ? "research_overloaded"
        : status >= 500 ? "research_unavailable" : "research_rejected";
  return Object.assign(new Error(`Research request failed (${status}${type ? ` ${type}` : ""}).`), { code, status });
}

// Runs one research conversation. Returns { findings, searchedUrls, usage,
// costMicroUsd, model }. findings is null when Claude ended without recording.
export async function researchCatalogSubject(subject, {
  apiKey,
  model = CATALOG_RESEARCH_DEFAULT_MODEL,
  fetchImpl = globalThis.fetch,
  signal,
  timeoutMs = 120_000,
  maxSearches = CATALOG_RESEARCH_MAX_SEARCHES,
} = {}) {
  if (!apiKey) throw Object.assign(new Error("Research is not configured."), { code: "research_not_configured" });
  if (!CATALOG_RESEARCH_FACTS[subject?.type]) throw new TypeError("Unknown research subject type.");
  const messages = [{ role: "user", content: catalogResearchBrief(subject) }];
  const tools = [
    { type: "web_search_20250305", name: "web_search", max_uses: maxSearches },
    recordTool(subject.type),
  ];
  const searchedUrls = new Set();
  let usage = {};
  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn += 1) {
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    const response = await fetchImpl(API_URL, {
      method: "POST",
      signal: requestSignal,
      redirect: "error",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify({ model, max_tokens: 4_000, system: SYSTEM_PROMPT, messages, tools }),
    });
    const body = await boundedJson(response).catch((error) => {
      if (!response.ok) return null;
      throw error;
    });
    if (!response.ok) throw providerError(response.status, body);
    usage = addUsage(usage, body?.usage);
    const content = Array.isArray(body?.content) ? body.content : [];
    for (const block of content) {
      if (block?.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const result of block.content) if (typeof result?.url === "string") searchedUrls.add(result.url);
      }
      if (block?.type === "text" && Array.isArray(block.citations)) {
        for (const citation of block.citations) if (typeof citation?.url === "string") searchedUrls.add(citation.url);
      }
    }
    const recorded = content.find((block) => block?.type === "tool_use" && block.name === "record_findings");
    if (recorded) {
      return { findings: recorded.input ?? null, searchedUrls: [...searchedUrls], usage,
        costMicroUsd: catalogResearchCostMicroUsd(model, usage), model };
    }
    if (body?.stop_reason === "pause_turn") {
      // A long search turn was paused; send it back unchanged to continue.
      messages.push({ role: "assistant", content });
      continue;
    }
    break;
  }
  return { findings: null, searchedUrls: [...searchedUrls], usage, costMicroUsd: catalogResearchCostMicroUsd(model, usage), model };
}
