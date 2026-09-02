import { SUPPORT_EMAIL } from "../src/domain/contact.mjs";

export const SECURITY_TXT_PATH = "/.well-known/security.txt";
export const SECURITY_TXT_EXPIRES = "2027-08-31T23:59:59Z";

export function securityTxt() {
  return [
    `Contact: mailto:${SUPPORT_EMAIL}`,
    `Expires: ${SECURITY_TXT_EXPIRES}`,
    `Canonical: https://www.mshpit.com${SECURITY_TXT_PATH}`,
    "Policy: https://www.mshpit.com/support",
    "Preferred-Languages: en",
    "",
  ].join("\n");
}

export function securityTxtResponse(method = "GET") {
  const normalized = String(method || "").toUpperCase();
  if (normalized !== "GET" && normalized !== "HEAD") {
    return Object.freeze({
      status: 405,
      body: "Method not allowed.\n",
      headers: Object.freeze({
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
        Allow: "GET, HEAD",
      }),
    });
  }
  return Object.freeze({
    status: 200,
    body: securityTxt(),
    headers: Object.freeze({
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    }),
  });
}
