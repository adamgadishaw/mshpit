#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  isStrictCalendarDate,
  isStrictIsoDateTime,
  publicMusicEventTitleViolations,
} from "../server/features/seo/publicEntityPolicy.js";

const DEFAULT_ORIGIN = "https://www.mshpit.com";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_SITEMAP_SAMPLE = 8;
const MAX_SITEMAP_SAMPLE = 12;
const MAX_EVENT_SITEMAP_SHARDS = 16;
const MAX_EVENT_DIRECTORY_PAGE = 1_000;
const MAX_PAGINATION_REQUESTS = 13;
const MAX_REQUESTS = 2 + 1 + MAX_EVENT_SITEMAP_SHARDS + MAX_SITEMAP_SAMPLE + MAX_PAGINATION_REQUESTS;
const MAX_HTML_BYTES = 768 * 1024;
const MAX_SITEMAP_BYTES = 50 * 1024 * 1024;
const MAX_EVENT_SPAN_DAYS = 45;
const STALE_GRACE_DAYS = 1;

function cleanText(value = "") {
  return String(value).replace(/<[^>]*>/gu, " ").replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&").replace(/&#39;|&apos;/giu, "'").replace(/&quot;/giu, '"')
    .replace(/\s+/gu, " ").trim();
}

function escapePattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function attribute(tag, name) {
  const match = String(tag).match(new RegExp(`\\b${escapePattern(name)}\\s*=\\s*(["'])(.*?)\\1`, "isu"));
  return match?.[2]?.trim() || "";
}

function normalizedOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("origin must be an absolute URL"); }
  if (!/^https?:$/u.test(url.protocol) || url.username || url.password
    || url.search || url.hash || url.pathname !== "/") {
    throw new Error("origin must be an http(s) origin without credentials, path, query, or fragment");
  }
  return url.origin;
}

function boundedInteger(value, { name, minimum, maximum }) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

export function parseArguments(argv) {
  let origin = DEFAULT_ORIGIN;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let sitemapSample = DEFAULT_SITEMAP_SAMPLE;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--origin") origin = argv[++index];
    else if (argument.startsWith("--origin=")) origin = argument.slice("--origin=".length);
    else if (argument === "--timeout-ms") timeoutMs = argv[++index];
    else if (argument.startsWith("--timeout-ms=")) timeoutMs = argument.slice("--timeout-ms=".length);
    else if (argument === "--sitemap-sample") sitemapSample = argv[++index];
    else if (argument.startsWith("--sitemap-sample=")) sitemapSample = argument.slice("--sitemap-sample=".length);
    else if (argument === "--help" || argument === "-h") return { help: true };
    else throw new Error(`unknown argument: ${argument}`);
  }
  return {
    help: false,
    origin: normalizedOrigin(origin),
    timeoutMs: boundedInteger(timeoutMs, { name: "--timeout-ms", minimum: 500, maximum: 60_000 }),
    sitemapSample: boundedInteger(sitemapSample, { name: "--sitemap-sample", minimum: 1, maximum: MAX_SITEMAP_SAMPLE }),
  };
}

export function catalogEventTitleViolations(title) {
  const value = cleanText(title);
  if (!value) return ["empty event title"];
  return [...publicMusicEventTitleViolations(value)];
}

export function extractEventLinks(html, origin) {
  const found = new Map();
  for (const match of String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)) {
    const href = attribute(`<a ${match[1]}>`, "href");
    if (!href) continue;
    let url;
    try { url = new URL(href, origin); } catch { continue; }
    if (url.origin !== origin || url.search || url.hash || !/^\/event\/[^/]+$/u.test(url.pathname)) continue;
    const title = cleanText(match[2]);
    if (title && !found.has(url.href)) found.set(url.href, title);
  }
  return [...found].map(([url, title]) => ({ url, title }));
}

export function extractEventPaginationUrls(html, origin) {
  const found = new Map();
  for (const match of String(html).matchAll(/<a\b[^>]*>/giu)) {
    const href = attribute(match[0], "href");
    if (!href) continue;
    let url;
    try { url = new URL(href, origin); } catch { continue; }
    const pageMatch = /^\/events\/page\/([1-9][0-9]*)$/u.exec(url.pathname);
    const page = Number(pageMatch?.[1]);
    if (url.origin !== origin || url.search || url.hash || !pageMatch
      || page < 2 || page > MAX_EVENT_DIRECTORY_PAGE) continue;
    found.set(page, url.href);
  }
  return [...found].sort(([left], [right]) => left - right)
    .map(([page, url]) => ({ page, url }));
}

function decodeXml(value) {
  return String(value).replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'").replace(/&amp;/gu, "&");
}

export function extractSitemapEventUrls(xmlPrefix, origin, limit) {
  const found = [];
  for (const match of String(xmlPrefix).matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/giu)) {
    const loc = match[1].match(/<loc\b[^>]*>([\s\S]*?)<\/loc>/iu)?.[1];
    if (!loc) continue;
    let url;
    try { url = new URL(decodeXml(loc.trim())); } catch { continue; }
    if (url.origin !== origin || url.search || url.hash || !/^\/event\/[^/]+$/u.test(url.pathname)) continue;
    found.push(url.href);
    if (found.length >= limit) break;
  }
  return [...new Set(found)];
}

export function extractEventSitemapUrls(xml, origin) {
  const found = [];
  for (const match of String(xml).matchAll(/<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/giu)) {
    const loc = match[1].match(/<loc\b[^>]*>([\s\S]*?)<\/loc>/iu)?.[1];
    if (!loc) continue;
    let url;
    try { url = new URL(decodeXml(loc.trim())); } catch { continue; }
    const shard = /^\/sitemaps\/events(?:-([1-9][0-9]*))?\.xml$/u.exec(url.pathname);
    if (url.origin !== origin || url.search || url.hash || !shard || shard[1] === "1") continue;
    found.push(url.href);
  }
  return [...new Set(found)];
}

function jsonLdDocuments(html) {
  const documents = [];
  for (const match of String(html).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)) {
    if (attribute(`<script ${match[1]}>`, "type").toLowerCase() !== "application/ld+json") continue;
    try { documents.push(JSON.parse(match[2])); } catch { throw new Error("event page contains invalid JSON-LD"); }
  }
  return documents;
}

function findMusicEvent(value) {
  if (Array.isArray(value)) {
    for (const child of value) { const found = findMusicEvent(child); if (found) return found; }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
  if (types.includes("MusicEvent")) return value;
  for (const child of Object.values(value)) { const found = findMusicEvent(child); if (found) return found; }
  return null;
}

function calendarDay(value) {
  const candidate = String(value || "").trim();
  if (!isStrictCalendarDate(candidate) && !isStrictIsoDateTime(candidate)) return null;
  const milliseconds = Date.parse(`${candidate.slice(0, 10)}T00:00:00Z`);
  return Math.floor(milliseconds / 86_400_000);
}

function structuredTypeIncludes(value, expected) {
  const types = Array.isArray(value?.["@type"]) ? value["@type"] : [value?.["@type"]];
  return types.includes(expected);
}

function canonicalHrefs(html, documentUrl) {
  const found = [];
  for (const match of String(html).matchAll(/<link\b[^>]*>/giu)) {
    const rel = attribute(match[0], "rel").toLowerCase().split(/\s+/u);
    if (!rel.includes("canonical")) continue;
    const href = attribute(match[0], "href");
    if (!href) { found.push(null); continue; }
    try { found.push(new URL(href, documentUrl).href); }
    catch { found.push(null); }
  }
  return found;
}

function pageRobotsValues(response, html) {
  const headers = response.headers.get("x-robots-tag") || "";
  const meta = [...String(html).matchAll(/<meta\b[^>]*>/giu)]
    .filter((match) => ["robots", "googlebot"].includes(attribute(match[0], "name").toLowerCase()))
    .map((match) => attribute(match[0], "content"));
  return [headers, ...meta];
}

function pageHasNoindex(response, html) {
  return pageRobotsValues(response, html)
    .some((value) => /(?:^|[,;\s])(?:noindex|none)(?:$|[,;\s])/iu.test(value));
}

function pageHasNofollow(response, html) {
  return pageRobotsValues(response, html)
    .some((value) => /(?:^|[,;\s])(?:nofollow|none)(?:$|[,;\s])/iu.test(value));
}

function hasSubstantiveFanEvidence(html) {
  return /\bdata-mshpit-fan-backed\s*=\s*(["'])true\1/iu.test(String(html));
}

export function inspectEventDocument(html, { now = Date.now() } = {}) {
  const event = findMusicEvent(jsonLdDocuments(html));
  const heading = cleanText(String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/iu)?.[1]);
  const eventName = cleanText(event?.name);
  const title = eventName || heading;
  const issues = catalogEventTitleViolations(title);
  // A fan-backed event page can be useful and indexable without qualifying for
  // Google's Event rich result. The server-owned marker is emitted only after
  // a substantive review or finalized public media survives projection.
  if (!event) {
    if (!hasSubstantiveFanEvidence(html)) {
      issues.push("missing MusicEvent JSON-LD or substantive fan-backed evidence");
    }
    return { title, issues: [...new Set(issues)] };
  }
  if (!eventName) issues.push('missing MusicEvent "name"');
  const start = calendarDay(event.startDate);
  const end = calendarDay(event.endDate);
  if (start == null) issues.push("missing or invalid MusicEvent startDate");
  if (event.endDate && end == null) issues.push("invalid MusicEvent endDate");
  const location = event.location;
  if (!location || typeof location !== "object" || !structuredTypeIncludes(location, "Place")) {
    issues.push('missing or invalid MusicEvent "location" Place');
  } else {
    if (!cleanText(location.name)) issues.push('missing MusicEvent "location.name"');
    const address = location.address;
    if (!address || typeof address !== "object" || !structuredTypeIncludes(address, "PostalAddress")) {
      issues.push('missing or invalid MusicEvent "location.address" PostalAddress');
    } else {
      if (!cleanText(address.streetAddress)) issues.push('missing MusicEvent "location.address.streetAddress"');
      if (!cleanText(address.addressLocality)) issues.push('missing MusicEvent "location.address.addressLocality"');
      if (!cleanText(address.addressCountry)) issues.push('missing MusicEvent "location.address.addressCountry"');
    }
  }
  if (start != null && end != null) {
    const span = end - start;
    if (span < 0) issues.push("MusicEvent endDate precedes startDate");
    else if (span > MAX_EVENT_SPAN_DAYS) issues.push(`MusicEvent spans ${span} days (maximum ${MAX_EVENT_SPAN_DAYS})`);
  }
  const currentDay = Math.floor(Number(now) / 86_400_000);
  const effectiveEnd = end ?? start;
  const scheduled = !event.eventStatus || /EventScheduled$/u.test(String(event.eventStatus));
  if (Number.isFinite(currentDay) && effectiveEnd != null && effectiveEnd < currentDay - STALE_GRACE_DAYS && scheduled) {
    issues.push("expired event remains EventScheduled in the upcoming sitemap sample");
  }
  return { title, issues: [...new Set(issues)] };
}

async function readLimited(response, maximum) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) throw new Error("response exceeded byte budget");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    total += value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw new Error("response exceeded byte budget");
    }
    text += decoder.decode(value, { stream: true });
  }
}

export function stratifiedSample(values, limit) {
  const source = [...new Set(Array.isArray(values) ? values : [])];
  const size = Math.min(source.length, Math.max(0, Number(limit) || 0));
  if (size === 0) return [];
  if (size === source.length) return source;
  if (size === 1) return [source[0]];
  return [...new Set(Array.from({ length:size }, (_, index) =>
    source[Math.round(index * (source.length - 1) / (size - 1))]))];
}

function contentType(response, expected) {
  return expected.some((type) => (response.headers.get("content-type") || "").toLowerCase().includes(type));
}

export async function verifyProductionSeoCatalog({
  origin = DEFAULT_ORIGIN,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  sitemapSample = DEFAULT_SITEMAP_SAMPLE,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
} = {}) {
  const target = normalizedOrigin(origin);
  const sampleLimit = boundedInteger(sitemapSample, { name: "sitemapSample", minimum: 1, maximum: MAX_SITEMAP_SAMPLE });
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
  const findings = [];
  const discovered = new Map();
  let eventsRootHtml = "";
  let requests = 0;

  async function request(url, { sitemapPrefix = false } = {}) {
    requests += 1;
    if (requests > MAX_REQUESTS) throw new Error(`request budget exceeded (${MAX_REQUESTS})`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const response = await fetchImpl(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: sitemapPrefix ? "application/xml,text/xml;q=0.9" : "text/html",
          "user-agent": "Mshpit-SEO-Catalog-Verification/1.0 (+https://www.mshpit.com/about)",
        },
      });
      const body = sitemapPrefix
        ? await readLimited(response, MAX_SITEMAP_BYTES)
        : await readLimited(response, MAX_HTML_BYTES);
      return { response, body };
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`request exceeded ${timeoutMs}ms`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  for (const path of ["/events", "/discover"]) {
    const { response, body } = await request(`${target}${path}`);
    if (response.status !== 200 || !contentType(response, ["text/html"])) {
      throw new Error(`${path} returned HTTP ${response.status} or an unexpected Content-Type`);
    }
    if (path === "/events") eventsRootHtml = body;
    for (const entry of extractEventLinks(body, target)) {
      discovered.set(entry.url, entry.title);
      for (const reason of catalogEventTitleViolations(entry.title)) {
        findings.push({ surface: path, url: entry.url, title: entry.title, reason });
      }
    }
  }

  const paginationCache = new Map();
  const rootPagination = extractEventPaginationUrls(eventsRootHtml, target);
  const rootAdvertisesPageTwo = rootPagination.some(({ page }) => page === 2);
  let paginatedEventPages = [];
  async function readPaginationPage(page) {
    if (paginationCache.has(page)) return paginationCache.get(page);
    const url = `${target}/events/page/${page}`;
    const result = await request(url);
    if (![200, 404].includes(result.response.status)) {
      throw new Error(`/events/page/${page} returned HTTP ${result.response.status} while locating the final page`);
    }
    if (result.response.status === 200 && !contentType(result.response, ["text/html"])) {
      throw new Error(`/events/page/${page} returned an unexpected Content-Type`);
    }
    paginationCache.set(page, { ...result, url });
    return paginationCache.get(page);
  }

  const pageTwo = await readPaginationPage(2);
  if (pageTwo.response.status !== 200) {
    if (rootAdvertisesPageTwo) {
      paginatedEventPages = [2];
      findings.push({
        surface: "/events/page/2",
        url: pageTwo.url,
        title: "",
        reason: "the event directory advertises page 2, but it returns HTTP 404",
      });
    }
  } else {
    if (!rootAdvertisesPageTwo) {
      findings.push({
        surface: "/events",
        url: `${target}/events/page/2`,
        title: "",
        reason: "event directory page 2 is accessible but missing from page 1 navigation",
      });
    }
    let lower = 3;
    let upper = MAX_EVENT_DIRECTORY_PAGE;
    let last = 2;
    while (lower <= upper) {
      const page = Math.floor((lower + upper) / 2);
      const { response } = await readPaginationPage(page);
      if (response.status === 200) {
        last = page;
        lower = page + 1;
      } else {
        upper = page - 1;
      }
    }

    const samplePages = [...new Set([2, Math.floor((2 + last) / 2), last])];
    paginatedEventPages = samplePages;
    for (const page of samplePages) {
      const { response, body, url } = await readPaginationPage(page);
      if (response.status !== 200) {
        findings.push({ surface: `/events/page/${page}`, url, title: "", reason: `HTTP ${response.status}` });
        continue;
      }
      if (!pageHasNoindex(response, body) || pageHasNofollow(response, body)) {
        findings.push({ surface: `/events/page/${page}`, url, title: "", reason: "paginated event directory must be noindex,follow" });
      }
      if (canonicalHrefs(body, url).length > 0) {
        findings.push({ surface: `/events/page/${page}`, url, title: "", reason: "noindex pagination must not publish a conflicting canonical" });
      }
      const pageEvents = extractEventLinks(body, target);
      if (!pageEvents.length) {
        findings.push({
          surface: `/events/page/${page}`,
          url,
          title: "",
          reason: "paginated event directory contains no canonical event links",
        });
      }
      for (const entry of pageEvents) {
        discovered.set(entry.url, entry.title);
        for (const reason of catalogEventTitleViolations(entry.title)) {
          findings.push({ surface: `/events/page/${page}`, url: entry.url, title: entry.title, reason });
        }
      }
    }
  }

  const indexUrl = `${target}/sitemap.xml`;
  const { response: indexResponse, body: indexXml } = await request(indexUrl, { sitemapPrefix: true });
  if (indexResponse.status !== 200
    || !contentType(indexResponse, ["application/xml", "text/xml"])
    || !/<sitemapindex\b/iu.test(indexXml)) {
    throw new Error(`sitemap index returned HTTP ${indexResponse.status} or an unexpected document`);
  }
  const eventSitemapUrls = extractEventSitemapUrls(indexXml, target);
  if (!eventSitemapUrls.length) throw new Error("sitemap index contains no event sitemap shards");
  if (eventSitemapUrls.length > MAX_EVENT_SITEMAP_SHARDS) {
    throw new Error(`event sitemap exceeds verifier shard budget (${MAX_EVENT_SITEMAP_SHARDS})`);
  }
  const allSitemapUrls = [];
  const seenSitemapLeaves = new Set();
  for (const sitemapUrl of eventSitemapUrls) {
    const { response: sitemapResponse, body: sitemapXml } = await request(sitemapUrl, { sitemapPrefix: true });
    if (sitemapResponse.status !== 200
      || !contentType(sitemapResponse, ["application/xml", "text/xml"])
      || !/<urlset\b/iu.test(sitemapXml)) {
      throw new Error(`event sitemap ${new URL(sitemapUrl).pathname} returned HTTP ${sitemapResponse.status} or an unexpected document`);
    }
    for (const url of extractSitemapEventUrls(sitemapXml, target, Number.MAX_SAFE_INTEGER)) {
      if (seenSitemapLeaves.has(url)) continue;
      seenSitemapLeaves.add(url);
      allSitemapUrls.push(url);
    }
  }
  if (!allSitemapUrls.length) throw new Error("event sitemap contains no canonical event URLs");
  const sitemapUrls = stratifiedSample(allSitemapUrls, sampleLimit);

  for (const url of sitemapUrls) {
    const { response, body } = await request(url);
    if (response.status !== 200 || !contentType(response, ["text/html"])) {
      findings.push({ surface: "events.xml", url, title: "", reason: `HTTP ${response.status} or unexpected Content-Type` });
      continue;
    }
    if (pageHasNoindex(response, body)) {
      findings.push({ surface: "events.xml", url, title: "", reason: "sitemap URL is marked noindex" });
      continue;
    }
    const canonicals = canonicalHrefs(body, url);
    if (canonicals.length !== 1 || canonicals[0] !== url) {
      findings.push({ surface: "events.xml", url, title: "", reason: "sitemap URL lacks an exact self-canonical" });
      continue;
    }
    const inspection = inspectEventDocument(body, { now });
    for (const reason of inspection.issues) {
      findings.push({ surface: "events.xml", url, title: inspection.title, reason });
    }
  }

  const uniqueFindings = [...new Map(findings.map((finding) => [
    JSON.stringify([finding.surface, finding.url, finding.reason]), finding,
  ])).values()];
  return {
    ok: uniqueFindings.length === 0,
    origin: target,
    requests,
    collectionEventUrls: discovered.size,
    sitemapEventUrls: sitemapUrls.length,
    sitemapCatalogEventUrls: allSitemapUrls.length,
    eventSitemapShards: eventSitemapUrls.length,
    paginatedEventPages,
    findings: uniqueFindings,
  };
}

export function formatReport(report) {
  const lines = [
    `Production SEO catalog verification: ${report.origin}`,
    `Bounded scope: ${report.requests}/${MAX_REQUESTS} requests; ${report.collectionEventUrls} collection event links; ${report.paginatedEventPages?.length || 0} later directory pages; ${report.sitemapEventUrls} stratified leaves from ${report.sitemapCatalogEventUrls} URLs across ${report.eventSitemapShards} event sitemap shard${report.eventSitemapShards === 1 ? "" : "s"}.`,
  ];
  for (const finding of report.findings) {
    lines.push(`FAIL  ${finding.surface} - ${finding.title || "[untitled]"} - ${finding.reason} - ${finding.url}`);
  }
  lines.push(report.ok
    ? "PASS  Public event catalog contains no sampled product, class, pass, VIP, stale, or invalid-range leaks."
    : `FAIL  Public event catalog exposed ${report.findings.length} crawler-visible violation${report.findings.length === 1 ? "" : "s"}.`);
  return lines.join("\n");
}

export async function runCli(argv = process.argv.slice(2)) {
  let args;
  try { args = parseArguments(argv); }
  catch (error) {
    console.error(`SEO catalog verification argument error: ${error.message}`);
    return 2;
  }
  if (args.help) {
    console.log("Usage: npm run verify:seo-catalog -- [--origin https://www.mshpit.com] [--timeout-ms 8000] [--sitemap-sample 8]");
    return 0;
  }
  try {
    const report = await verifyProductionSeoCatalog(args);
    console.log(formatReport(report));
    return report.ok ? 0 : 1;
  } catch (error) {
    console.error(`SEO catalog verification failed safely: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli();
}
