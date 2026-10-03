import { NEWS_SOURCES } from "./newsSources.js";

const MONEY_TODAY_KOREAN = String.fromCodePoint(0xBA38, 0xB2C8, 0xD22C, 0xB370, 0xC774);

// Known publisher identities for self-written citations. Other named sources
// may be cited without being added to this registry. Keep this separate:
// accepting a manual citation must never make its URL an
// automated feed, and a source hosted on a publishing platform must be bound
// to the exact publication host rather than the platform's whole domain.
const existingSources = NEWS_SOURCES.map((source) => Object.freeze({
  ...source,
  aliases: Object.freeze([source.name]),
  hosts: Object.freeze([source.domain]),
  allowSubdomains: true,
}));

const additionalSources = [
  {
    id: "billboard-substack",
    name: "Billboard Substack",
    aliases: ["Billboard Newsletter", "Billboard"],
    group: "pmc",
    hosts: ["billboard.substack.com"],
  },
  {
    id: "yonhap",
    name: "Yonhap News",
    aliases: ["Yonhap"],
    group: "yonhap",
    hosts: ["en.yna.co.kr", "www.yna.co.kr"],
  },
  {
    id: "moneytoday",
    name: "Money Today",
    aliases: ["MoneyToday", MONEY_TODAY_KOREAN],
    group: "moneytoday",
    hosts: ["www.mt.co.kr", "en.mt.co.kr", "m.mt.co.kr"],
  },
].map((source) => Object.freeze({
  ...source,
  aliases: Object.freeze([source.name, ...source.aliases]),
  hosts: Object.freeze(source.hosts),
  allowSubdomains: false,
}));

export const NEWS_EDITORIAL_SOURCES = Object.freeze([...existingSources, ...additionalSources]);

const lower = (value) => String(value || "").normalize("NFKC")
  .replace(/\p{Default_Ignorable_Code_Point}/gu, "").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-US");

function safeHttpsUrl(value) {
  try {
    const raw = String(value ?? "");
    if (!raw || raw !== raw.trim() || !raw.startsWith("https://") || /[\s\\]/u.test(raw)) return null;
    const authority = /^https:\/\/([^/?#]*)/iu.exec(raw)?.[1] || "";
    const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
    if (/:\d+$/u.test(hostPort)) return null;
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

export function canonicalEditorialUrl(value) {
  const url = safeHttpsUrl(value);
  return url?.toString() || null;
}

// Validate a stored citation, without resolving or fetching its URL. This is
// not evidence of ownership or accuracy and never grants network access.
export function canonicalManualCitationUrl(value) {
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u001f\u007f]/u.test(value)
    || /^https:\/\/[^/?#]*:/u.test(value)) return null;
  const url = safeHttpsUrl(value);
  if (!url || url.toString().length > 2048) return null;
  const host = url.hostname;
  const labels = host.split(".");
  if (host.length > 253 || labels.length < 2 || !/[a-z]/u.test(labels.at(-1))
    || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
    || /(?:^|\.)(?:localhost|local|internal|home|lan|onion|invalid|test|example)$/u.test(host)) return null;
  return url.toString();
}

function hostMatches(source, hostname) {
  return source.hosts.some((host) => source.allowSubdomains
    ? hostname === host || hostname.endsWith(`.${host}`)
    : hostname === host);
}

export function editorialSourceForUrl(value) {
  const url = safeHttpsUrl(value);
  if (!url) return null;
  const hostname = url.hostname.toLocaleLowerCase();
  return NEWS_EDITORIAL_SOURCES.find((source) => hostMatches(source, hostname)) || null;
}

export function editorialSourceNameMatches(source, value) {
  const name = lower(value);
  return !!source && source.aliases.some((alias) => lower(alias) === name);
}

export function isKnownEditorialSourceName(value) {
  return NEWS_EDITORIAL_SOURCES.some(source => editorialSourceNameMatches(source, value));
}
