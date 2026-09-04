const MSHPIT_ORIGIN = "https://www.mshpit.com";
const PHOTO_CREDIT_PATH = /^\/photo-credits\/[a-f0-9]{48}$/u;

function hasLicenseRelation(parameters) {
  for (const parameter of String(parameters || "").split(";")) {
    const match = /^\s*rel\s*=\s*(?:"([^"]*)"|([A-Za-z0-9._-]+))\s*$/iu.exec(parameter);
    if (!match) continue;
    const relations = String(match[1] ?? match[2] ?? "").toLowerCase().split(/[\t\n\f\r ]+/u);
    if (relations.includes("license")) return true;
  }
  return false;
}

export function photoCreditUrlFromLinkHeader(value) {
  if (typeof value !== "string" || !value || value.length > 4_096) return null;
  for (const part of value.split(",")) {
    const match = /^\s*<([^>]+)>\s*((?:;[^;]*)*)\s*$/u.exec(part);
    if (!match || !hasLicenseRelation(match[2])) continue;
    try {
      const url = new URL(match[1]);
      if (url.origin === MSHPIT_ORIGIN && !url.username && !url.password && !url.port
        && !url.search && !url.hash && PHOTO_CREDIT_PATH.test(url.pathname)) return url.toString();
    } catch {
      // A malformed optional Link target is ignored; the PNG remains usable.
    }
  }
  return null;
}
