import { NEWS_SOURCES } from "./newsSources.js";

const MONEY_TODAY_KOREAN = String.fromCodePoint(0xBA38, 0xB2C8, 0xD22C, 0xB370, 0xC774);

// Self-written articles may cite a small, owner-vetted set of editorial
// publishers in addition to the outlets used by the automated RSS desk. Keep
// this registry separate: adding a manual source must never make it an
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

const lower = (value) => String(value || "").trim().toLocaleLowerCase();

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
