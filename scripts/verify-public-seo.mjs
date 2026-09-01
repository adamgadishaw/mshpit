#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const DEFAULT_ORIGIN = "https://www.mshpit.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_SITEMAP_ENTRIES = 50_000;
const MAX_SITEMAP_BYTES = 50 * 1024 * 1024;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_ROBOTS_BYTES = 256 * 1024;
const MAX_CHILD_SITEMAPS = 100;
const MAX_SITEMAP_CLASSES = 25;
const MAX_TOTAL_SITEMAP_BYTES = 512 * 1024 * 1024;

function cleanText(value = "") {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${escapePattern(name)}\\s*=\\s*(["'])(.*?)\\1`, "is"));
  return match?.[2]?.trim() || "";
}

function tags(html, name) {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) || [];
}

function metadataValues(html, key) {
  const normalized = key.toLowerCase();
  return tags(html, "meta")
    .filter((tag) => [attribute(tag, "name"), attribute(tag, "property")]
      .some((value) => value.toLowerCase() === normalized))
    .map((tag) => attribute(tag, "content"));
}

function linkHrefs(html, relationship) {
  const normalized = relationship.toLowerCase();
  return tags(html, "link")
    .filter((tag) => attribute(tag, "rel").toLowerCase().split(/\s+/).includes(normalized))
    .map((tag) => attribute(tag, "href"));
}

function exactlyOne(values, label) {
  if (values.length !== 1) throw new Error(`${label} must appear exactly once`);
  if (!cleanText(values[0])) throw new Error(`${label} is empty`);
  return values[0].trim();
}

function visibleBodyText(html) {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || "";
  return cleanText(body
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " "));
}

function parseJsonLd(html) {
  const documents = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    if (attribute(`<script ${match[1]}>`, "type").toLowerCase() !== "application/ld+json") continue;
    try {
      documents.push(JSON.parse(match[2]));
    } catch {
      throw new Error("page contains invalid JSON-LD");
    }
  }
  return documents;
}

function schemaTypes(documents) {
  const found = new Set();
  function visit(value) {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const rawType = value["@type"];
    for (const type of Array.isArray(rawType) ? rawType : [rawType]) {
      if (typeof type === "string" && type.trim()) found.add(type.trim());
    }
    for (const nested of Object.values(value)) visit(nested);
  }
  visit(documents);
  return found;
}

function structuredNodes(documents) {
  const nodes = [];
  function visit(value, relationship = null) {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, relationship);
      return;
    }
    if (!value || typeof value !== "object") return;
    nodes.push({ value, relationship });
    for (const [property, nested] of Object.entries(value)) visit(nested, property);
  }
  visit(documents);
  return nodes;
}

function structuredTypes(node) {
  const raw = node?.["@type"];
  return (Array.isArray(raw) ? raw : [raw])
    .filter((type) => typeof type === "string" && type.trim())
    .map((type) => type.trim());
}

function nonemptyStructuredText(value) {
  return typeof value === "string" && Boolean(value.trim());
}

/**
 * Fail production verification when a page creates an Event node that Google
 * can recognize but that does not contain its required visible facts.
 *
 * Schema properties such as MusicVenue.event have an Event range even when a
 * bare reference omits @type. Resolve same-document @id references, but reject
 * cross-document phantom Event nodes because Google validates the current
 * page's graph independently.
 */
export function validateEventStructuredData(documents) {
  const nodes = structuredNodes(documents);
  const definitions = new Map();
  for (const { value } of nodes) {
    const id = nonemptyStructuredText(value?.["@id"]) ? value["@id"].trim() : "";
    if (!id) continue;
    const current = definitions.get(id);
    if (!current || Object.keys(value).length > Object.keys(current).length) definitions.set(id, value);
  }

  for (const { value, relationship } of nodes) {
    const types = structuredTypes(value);
    const explicitlyEvent = types.some((type) => /Event$/u.test(type));
    if (!explicitlyEvent && relationship !== "event") continue;

    const id = nonemptyStructuredText(value?.["@id"]) ? value["@id"].trim() : "";
    const event = id && definitions.get(id) !== value ? definitions.get(id) : value;
    const eventTypes = structuredTypes(event);
    if (relationship === "event" && !eventTypes.some((type) => /Event$/u.test(type))) {
      throw new Error("JSON-LD contains an undefined Event reference");
    }

    const missing = [];
    if (!nonemptyStructuredText(event?.name)) missing.push("name");
    if (!nonemptyStructuredText(event?.startDate)) missing.push("startDate");
    const location = event?.location;
    if (!location || typeof location !== "object" || Array.isArray(location)) {
      missing.push("location");
    } else {
      const locationTypes = structuredTypes(location);
      const address = location.address;
      if (!locationTypes.includes("Place")
        || !nonemptyStructuredText(location.name)
        || !address || typeof address !== "object" || Array.isArray(address)
        || !nonemptyStructuredText(address.streetAddress)
        || !nonemptyStructuredText(address.addressLocality)
        || !nonemptyStructuredText(address.addressCountry)) {
        missing.push("location");
      }
    }
    if (missing.length) throw new Error(`JSON-LD Event is missing required ${missing.join(", ")}`);
  }
  return true;
}

function hasSchemaContext(documents) {
  return documents.some((document) => {
    const contexts = Array.isArray(document?.["@context"]) ? document["@context"] : [document?.["@context"]];
    return contexts.some((context) => typeof context === "string" && /^https?:\/\/schema\.org\/?$/i.test(context));
  });
}

function decodeXml(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function xmlRoot(xml) {
  if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/i.test(xml)) {
    throw new Error("XML contains an unescaped ampersand");
  }
  const stack = [];
  let root = "";
  let rootCount = 0;
  const withoutSpecialBlocks = xml
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "");
  const xmlTags = withoutSpecialBlocks.match(/<[^>]+>/g) || [];
  for (const tag of xmlTags) {
    if (/^<\?/.test(tag) || /^<!/.test(tag)) continue;
    const closing = tag.match(/^<\/\s*([\w:.-]+)\s*>$/);
    if (closing) {
      if (stack.pop() !== closing[1]) throw new Error("XML has mismatched elements");
      continue;
    }
    const opening = tag.match(/^<\s*([\w:.-]+)(?:\s[^>]*)?\s*\/?>$/);
    if (!opening) throw new Error("XML contains a malformed element");
    if (!stack.length) rootCount += 1;
    if (rootCount > 1) throw new Error("XML has multiple root elements");
    root ||= opening[1];
    if (!/\/\s*>$/.test(tag)) stack.push(opening[1]);
  }
  if (!root) throw new Error("XML has no root element");
  if (stack.length) throw new Error("XML has an unclosed element");
  return root;
}

function elementBodies(xml, elementName) {
  const bodies = [];
  const pattern = new RegExp(`<${elementName}\\b[^>]*>([\\s\\S]*?)<\\/${elementName}>`, "gi");
  for (const match of xml.matchAll(pattern)) bodies.push(match[1]);
  return bodies;
}

function primaryLocs(xml, parentName) {
  return elementBodies(xml, parentName).map((body) => {
    const beforeMedia = body.split(/<(?:image:image|video:video|news:news)\b/i, 1)[0];
    const match = beforeMedia.match(/<loc\b[^>]*>([\s\S]*?)<\/loc>/i);
    if (!match) throw new Error(`${parentName} entry has no primary <loc>`);
    return decodeXml(match[1].trim());
  });
}

function displayOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "[invalid origin]";
  }
}

function normalizedOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("origin must be an absolute URL");
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error("origin must use http or https");
  if (url.username || url.password) throw new Error("origin must not contain credentials");
  if (url.search || url.hash) throw new Error("origin must not contain a query or fragment");
  if (url.pathname !== "/") throw new Error("origin must not contain a path");
  return url.origin;
}

function canonicalUrl(value, origin, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is not an absolute URL`);
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error(`${label} is unsafe`);
  if (url.origin !== origin) throw new Error(`${label} is off-origin`);
  if (url.search || url.hash) throw new Error(`${label} is not canonical`);
  return url.href;
}

function hasNoindex(response, html) {
  const directives = [
    response.headers.get("x-robots-tag") || "",
    ...metadataValues(html, "robots"),
    ...metadataValues(html, "googlebot"),
  ].join(",").toLowerCase();
  return directives.split(/[;,]/).some((value) => value.trim().split(/\s+/).includes("noindex"));
}

function httpCanonicalLinks(headerValue) {
  const links = [];
  const pattern = /<([^>]+)>\s*;([^,]*)/g;
  for (const match of String(headerValue || "").matchAll(pattern)) {
    const rel = match[2].match(/\brel\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s;]+))/i);
    const relationships = (rel?.[1] || rel?.[2] || rel?.[3] || "").toLowerCase().split(/\s+/);
    if (relationships.includes("canonical")) links.push(match[1]);
  }
  return links;
}

function hasCrawlableAnchor(html, origin, path) {
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const href = attribute(`<a ${match[1]}>`, "href");
    if (!href || !cleanText(match[2])) continue;
    try {
      const url = new URL(href, origin);
      if (url.origin === origin && url.pathname === path && !url.search && !url.hash) return true;
    } catch {
      continue;
    }
  }
  return false;
}

function robotsGroups(text) {
  const groups = [];
  let agents = [];
  let rules = [];
  let sawRule = false;

  function finish() {
    if (agents.length) groups.push({ agents, rules });
    agents = [];
    rules = [];
    sawRule = false;
  }

  for (const rawLine of String(text).replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) {
      if (agents.length) finish();
      continue;
    }
    const directive = line.match(/^([^:]+)\s*:\s*(.*)$/);
    if (!directive) continue;
    const name = directive[1].trim().toLowerCase();
    const value = directive[2].trim();
    if (name === "user-agent") {
      if (agents.length && sawRule) finish();
      agents.push(value.toLowerCase());
      continue;
    }
    if (agents.length) {
      sawRule = true;
      if (name === "allow" || name === "disallow") rules.push({ name, value });
    }
  }
  finish();
  return groups;
}

function rootRuleSpecificity(value) {
  const rule = String(value || "").trim();
  if (rule !== "/" && rule !== "/*") return -1;
  return rule.replace(/[*$]/g, "").length;
}

function rulesBlockRoot(rules) {
  const matching = rules
    .map((rule) => ({ ...rule, specificity: rootRuleSpecificity(rule.value) }))
    .filter((rule) => rule.specificity >= 0);
  if (!matching.length) return false;
  const strongest = Math.max(...matching.map((rule) => rule.specificity));
  const equallySpecific = matching.filter((rule) => rule.specificity === strongest);
  // Google resolves equally specific conflicts in favour of the least
  // restrictive rule. This avoids false alarms for Cloudflare-generated
  // content-signal groups that pair a root block with an equally precise allow.
  if (equallySpecific.some((rule) => rule.name === "allow")) return false;
  return equallySpecific.some((rule) => rule.name === "disallow");
}

function sitewideRobotsBlock(text) {
  const groups = robotsGroups(text);
  const rulesFor = (agent, fallbacks = []) => {
    for (const candidate of [agent, ...fallbacks]) {
      const matching = groups.filter((group) => group.agents.includes(candidate));
      if (matching.length) return matching.flatMap((group) => group.rules);
    }
    return [];
  };
  for (const [label, rules] of [
    ["User-agent: *", rulesFor("*")],
    ["Googlebot", rulesFor("googlebot", ["*"])],
    ["Googlebot-Smartphone", rulesFor("googlebot-smartphone", ["googlebot", "*"])],
  ]) {
    if (rulesBlockRoot(rules)) return label;
  }
  return null;
}

function sitemapClass(url) {
  const filename = new URL(url).pathname.split("/").filter(Boolean).at(-1) || "sitemap";
  return filename.replace(/-\d+(?=\.xml$)/i, "").replace(/\.xml$/i, "") || "sitemap";
}

export function parseArguments(argv) {
  let origin = DEFAULT_ORIGIN;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--origin") origin = argv[++index];
    else if (argument.startsWith("--origin=")) origin = argument.slice("--origin=".length);
    else if (argument === "--timeout-ms") timeoutMs = Number(argv[++index]);
    else if (argument.startsWith("--timeout-ms=")) timeoutMs = Number(argument.slice("--timeout-ms=".length));
    else if (argument === "--help" || argument === "-h") return { help: true };
    else throw new Error("unknown argument");
  }
  if (!origin) throw new Error("--origin requires a value");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 60_000) {
    throw new Error("--timeout-ms must be an integer from 500 to 60000");
  }
  return { origin: normalizedOrigin(origin), timeoutMs, help: false };
}

async function readTextLimited(response, maxBytes) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("response exceeded the safe byte limit");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("response exceeded the safe byte limit");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function request(url, {
  fetchImpl,
  timeoutMs,
  method = "GET",
  redirect = "manual",
  maxBytes = MAX_HTML_BYTES,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`request exceeded ${timeoutMs}ms`)), timeoutMs);
  timer.unref?.();
  try {
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        redirect,
        signal: controller.signal,
        headers: {
          accept: method === "HEAD" ? "*/*" : "text/html,application/xml,text/xml,text/plain;q=0.9,*/*;q=0.1",
          "user-agent": "Mshpit-SEO-Verification/1.0 (+https://www.mshpit.com/about)",
        },
      });
      return {
        status: response.status,
        headers: response.headers,
        body: method === "HEAD" ? "" : await readTextLimited(response, maxBytes),
      };
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`request exceeded ${timeoutMs}ms`);
      if (error instanceof Error && error.message === "response exceeded the safe byte limit") throw error;
      throw new Error("network request failed");
    }
  } finally {
    clearTimeout(timer);
  }
}

async function headOrGet(url, options) {
  const response = await request(url, { ...options, method: "HEAD" });
  if (response.status !== 405 && response.status !== 501) return response;
  return request(url, options);
}

async function resolveFinalOrigin(origin, options) {
  const start = `${origin}/`;
  const response = await headOrGet(start, options);
  if (response.status >= 200 && response.status < 300) return { origin, redirected: false };
  if (response.status < 300 || response.status >= 400) throw new Error(`home canonical probe returned HTTP ${response.status}`);
  const location = response.headers.get("location");
  if (!location) throw new Error("home redirect did not include Location");
  let destination;
  try {
    destination = new URL(location, start);
  } catch {
    throw new Error("home redirect Location is invalid");
  }
  if (destination.username || destination.password) throw new Error("home redirect contains credentials");
  const finalOrigin = normalizedOrigin(destination.origin);
  if (destination.pathname !== "/" || destination.search || destination.hash) {
    throw new Error("home redirect did not resolve to a canonical origin");
  }
  const finalResponse = await headOrGet(destination, options);
  if (finalResponse.status < 200 || finalResponse.status >= 300) {
    throw new Error(`canonical origin returned HTTP ${finalResponse.status}; more than one redirect is not allowed`);
  }
  return { origin: finalOrigin, redirected: true };
}

function requireStatus(response, expected, label) {
  if (response.status !== expected) throw new Error(`${label} returned HTTP ${response.status}, expected ${expected}`);
}

function requireContentType(response, expected, label) {
  const type = response.headers.get("content-type")?.toLowerCase() || "";
  if (!expected.some((value) => type.includes(value))) throw new Error(`${label} returned unexpected Content-Type`);
}

async function verifyRobots(origin, options) {
  const response = await request(`${origin}/robots.txt`, { ...options, maxBytes: MAX_ROBOTS_BYTES });
  requireStatus(response, 200, "robots.txt");
  requireContentType(response, ["text/plain"], "robots.txt");
  const blockingAgent = sitewideRobotsBlock(response.body);
  if (blockingAgent) {
    throw new Error(`robots.txt blocks the entire site for ${blockingAgent}`);
  }
  const sitemapLines = response.body.match(/^\s*Sitemap\s*:\s*(\S+)\s*$/gim) || [];
  if (!sitemapLines.length) throw new Error("robots.txt has no Sitemap line");
  const urls = sitemapLines.map((line) => line.replace(/^\s*Sitemap\s*:\s*/i, "").trim());
  const advertised = urls.some((value) => {
    try {
      return canonicalUrl(value, origin, "robots sitemap") === `${origin}/sitemap.xml`;
    } catch {
      return false;
    }
  });
  if (!advertised) throw new Error("robots.txt does not advertise canonical /sitemap.xml");
  return `${urls.length} Sitemap directive${urls.length === 1 ? "" : "s"}`;
}

async function verifySitemaps(origin, options) {
  const indexResponse = await request(`${origin}/sitemap.xml`, { ...options, maxBytes: MAX_SITEMAP_BYTES });
  requireStatus(indexResponse, 200, "sitemap index");
  requireContentType(indexResponse, ["application/xml", "text/xml"], "sitemap index");
  if (xmlRoot(indexResponse.body).toLowerCase() !== "sitemapindex") {
    throw new Error("sitemap.xml root must be <sitemapindex>");
  }
  const rawChildren = primaryLocs(indexResponse.body, "sitemap");
  if (!rawChildren.length) throw new Error("sitemap index has no child sitemap URLs");
  if (rawChildren.length > MAX_SITEMAP_ENTRIES) {
    throw new Error(`sitemap index exceeds ${MAX_SITEMAP_ENTRIES} entries`);
  }
  if (rawChildren.length > MAX_CHILD_SITEMAPS) {
    throw new Error(`sitemap index exceeds the verifier safety limit of ${MAX_CHILD_SITEMAPS} child sitemaps`);
  }
  const children = rawChildren.map((value) => canonicalUrl(value, origin, "child sitemap URL"));
  if (new Set(children).size !== children.length) throw new Error("sitemap index contains duplicate child sitemap URLs");

  const publicUrls = new Set();
  const samplesByClass = new Map();
  let totalSitemapBytes = Buffer.byteLength(indexResponse.body, "utf8");
  for (let index = 0; index < children.length; index += 1) {
    const childResponse = await request(children[index], { ...options, maxBytes: MAX_SITEMAP_BYTES });
    const label = `child sitemap ${index + 1}`;
    requireStatus(childResponse, 200, label);
    requireContentType(childResponse, ["application/xml", "text/xml"], label);
    totalSitemapBytes += Buffer.byteLength(childResponse.body, "utf8");
    if (totalSitemapBytes > MAX_TOTAL_SITEMAP_BYTES) {
      throw new Error("sitemaps exceed the verifier cumulative byte safety limit");
    }
    if (xmlRoot(childResponse.body).toLowerCase() !== "urlset") {
      throw new Error(`${label} root must be <urlset>`);
    }
    const entries = primaryLocs(childResponse.body, "url");
    if (entries.length > MAX_SITEMAP_ENTRIES) {
      throw new Error(`${label} exceeds ${MAX_SITEMAP_ENTRIES} URLs`);
    }
    const canonicalEntries = [];
    for (const entry of entries) {
      const url = canonicalUrl(entry, origin, "sitemap page URL");
      if (/\/page\/1\/?$/.test(new URL(url).pathname)) {
        throw new Error("sitemaps contain a noncanonical /page/1 URL");
      }
      if (publicUrls.has(url)) throw new Error("sitemaps contain a duplicate public URL");
      publicUrls.add(url);
      canonicalEntries.push(url);
    }
    if (canonicalEntries.length) {
      const className = sitemapClass(children[index]);
      const state = samplesByClass.get(className) || { first: null, last: null, middle: null, largestShard: 0 };
      state.first ||= canonicalEntries[0];
      state.last = canonicalEntries.at(-1);
      if (canonicalEntries.length > state.largestShard) {
        state.largestShard = canonicalEntries.length;
        state.middle = canonicalEntries[Math.floor(canonicalEntries.length / 2)];
      }
      samplesByClass.set(className, state);
      if (samplesByClass.size > MAX_SITEMAP_CLASSES) {
        throw new Error(`sitemaps exceed the verifier safety limit of ${MAX_SITEMAP_CLASSES} classes`);
      }
    }
  }

  for (const requiredPath of ["/", "/about"]) {
    if (!publicUrls.has(`${origin}${requiredPath}`)) {
      throw new Error(`sitemaps do not include required public URL ${requiredPath}`);
    }
  }
  let sampledUrls = 0;
  for (const [className, state] of samplesByClass) {
    const samples = [...new Set([state.first, state.middle, state.last].filter(Boolean))];
    for (const rawUrl of samples) {
      sampledUrls += 1;
      const url = canonicalUrl(rawUrl, origin, "sitemap sample URL");
      const response = await request(url, options);
      const label = `sitemap class ${className} sample`;
      requireStatus(response, 200, label);
      requireContentType(response, ["text/html"], label);
      if (hasNoindex(response, response.body)) throw new Error(`${label} is marked noindex`);
      const visible = visibleBodyText(response.body);
      if (/you need to enable javascript/i.test(visible) || visible.length < 80) {
        throw new Error(`${label} is a JavaScript-only or materially empty HTML shell`);
      }
      if (!cleanText(response.body.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1])) {
        throw new Error(`${label} has no visible <h1>`);
      }
      verifyHtmlMetadata(response, response.body, origin, new URL(url).pathname, []);
      const canonical = exactlyOne(linkHrefs(response.body, "canonical"), `${label} canonical link`);
      if (!/^https?:\/\//i.test(canonical) || canonicalUrl(canonical, origin, `${label} canonical link`) !== url) {
        throw new Error(`${label} canonical link is not self-referential`);
      }
      for (const headerCanonical of httpCanonicalLinks(response.headers.get("link"))) {
        if (canonicalUrl(headerCanonical, origin, `${label} HTTP canonical`) !== url) {
          throw new Error(`${label} HTTP canonical conflicts with HTML`);
        }
      }
    }
  }

  return `${children.length} child sitemaps, ${publicUrls.size} unique public URLs, ${samplesByClass.size} sampled classes / ${sampledUrls} pages`;
}

function requireAbsoluteMediaUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error(`${label} is unsafe`);
}

function verifyHtmlMetadata(response, html, origin, path, expectedTypes) {
  const htmlTags = tags(html, "html");
  if (htmlTags.length !== 1 || !attribute(htmlTags[0], "lang")) throw new Error(`${path} must have one <html lang>`);

  exactlyOne([...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)].map((match) => cleanText(match[1])), `${path} title`);
  exactlyOne(metadataValues(html, "description"), `${path} meta description`);
  exactlyOne(metadataValues(html, "robots"), `${path} meta robots`);
  if (hasNoindex(response, html)) throw new Error(`${path} is marked noindex`);

  const expectedUrl = `${origin}${path}`;
  const canonical = exactlyOne(linkHrefs(html, "canonical"), `${path} canonical link`);
  if (!/^https?:\/\//i.test(canonical) || canonicalUrl(canonical, origin, `${path} canonical link`) !== expectedUrl) {
    throw new Error(`${path} canonical link does not match its public URL`);
  }
  for (const headerCanonical of httpCanonicalLinks(response.headers.get("link"))) {
    if (canonicalUrl(headerCanonical, origin, `${path} HTTP canonical`) !== expectedUrl) {
      throw new Error(`${path} HTTP canonical conflicts with HTML`);
    }
  }

  exactlyOne(metadataValues(html, "og:title"), `${path} og:title`);
  exactlyOne(metadataValues(html, "og:description"), `${path} og:description`);
  const ogUrl = exactlyOne(metadataValues(html, "og:url"), `${path} og:url`);
  if (canonicalUrl(ogUrl, origin, `${path} og:url`) !== expectedUrl) throw new Error(`${path} og:url conflicts with canonical`);
  requireAbsoluteMediaUrl(exactlyOne(metadataValues(html, "og:image"), `${path} og:image`), `${path} og:image`);
  exactlyOne(metadataValues(html, "twitter:card"), `${path} twitter:card`);
  requireAbsoluteMediaUrl(exactlyOne(metadataValues(html, "twitter:image"), `${path} twitter:image`), `${path} twitter:image`);
  const icons = linkHrefs(html, "icon");
  if (!icons.length || !icons.some((href) => {
    try {
      const url = new URL(href, expectedUrl);
      return /^https?:$/.test(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  })) throw new Error(`${path} has no valid favicon link`);

  const documents = parseJsonLd(html);
  if (!documents.length || !hasSchemaContext(documents)) throw new Error(`${path} has no schema.org JSON-LD context`);
  validateEventStructuredData(documents);
  const types = schemaTypes(documents);
  for (const expectedType of expectedTypes) {
    if (!types.has(expectedType)) throw new Error(`${path} JSON-LD is missing ${expectedType}`);
  }
}

async function verifyIndexablePage(origin, path, expectedTypes, options) {
  const response = await request(`${origin}${path}`, options);
  requireStatus(response, 200, path);
  requireContentType(response, ["text/html"], path);
  const html = response.body;
  const visible = visibleBodyText(html);
  if (/you need to enable javascript/i.test(visible) || visible.length < 80) {
    throw new Error(`${path} is a JavaScript-only or materially empty HTML shell`);
  }
  if (!cleanText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1])) throw new Error(`${path} has no visible <h1>`);
  verifyHtmlMetadata(response, html, origin, path, expectedTypes);
  if (path === "/") {
    for (const requiredPath of ["/artists", "/events"]) {
      if (!hasCrawlableAnchor(html, origin, requiredPath)) {
        throw new Error(`home has no crawlable ${requiredPath} anchor`);
      }
    }
  }
  return `semantic HTML (${visible.length} visible characters)`;
}

async function verifyNotFound(origin, options) {
  const path = `/__seo-verification-not-found-${Date.now().toString(36)}`;
  const response = await request(`${origin}${path}`, options);
  requireStatus(response, 404, "unknown public URL");
  requireContentType(response, ["text/html"], "unknown public URL");
  if (!hasNoindex(response, response.body)) throw new Error("404 response is not marked noindex");
  return "HTTP 404 with noindex";
}

export async function verifyPublicSeo({
  origin = DEFAULT_ORIGIN,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable in this Node runtime");
  const target = normalizedOrigin(origin);
  const options = { fetchImpl, timeoutMs };
  const checks = [];
  async function check(name, task) {
    try {
      const detail = await task();
      checks.push({ name, ok: true, detail });
    } catch (error) {
      checks.push({ name, ok: false, detail: error instanceof Error ? error.message : "unexpected verification failure" });
    }
  }

  let finalOrigin = target;
  await check("Canonical origin", async () => {
    const resolution = await resolveFinalOrigin(target, options);
    finalOrigin = resolution.origin;
    return resolution.redirected ? `one redirect to ${displayOrigin(finalOrigin)}` : `${displayOrigin(finalOrigin)} is final`;
  });
  if (!checks.at(-1).ok) return { ok: false, origin: target, checks };

  await check("robots.txt", () => verifyRobots(finalOrigin, options));
  await check("Sitemaps", () => verifySitemaps(finalOrigin, options));
  await check("Home HTML", () => verifyIndexablePage(finalOrigin, "/", ["WebSite", "Organization"], options));
  await check("About HTML", () => verifyIndexablePage(finalOrigin, "/about", ["AboutPage", "Organization"], options));
  await check("404 policy", () => verifyNotFound(finalOrigin, options));
  return { ok: checks.every((item) => item.ok), origin: finalOrigin, checks };
}

export function formatReport(report) {
  const lines = [`SEO verification: ${displayOrigin(report.origin)}`];
  for (const check of report.checks) lines.push(`${check.ok ? "PASS" : "FAIL"}  ${check.name} - ${check.detail}`);
  lines.push(report.ok ? "PASS  Public SEO contract is healthy." : "FAIL  Public SEO contract needs attention.");
  return lines.join("\n");
}

export async function runCli(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArguments(argv);
  } catch (error) {
    console.error(`SEO verification argument error: ${error.message}`);
    return 2;
  }
  if (args.help) {
    console.log("Usage: npm run verify:seo -- [--origin https://www.mshpit.com] [--timeout-ms 10000]");
    return 0;
  }
  const report = await verifyPublicSeo(args);
  console.log(formatReport(report));
  return report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli();
}
