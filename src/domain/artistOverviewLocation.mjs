import { discoverCountryCode } from "./discoverScene.mjs";

export function artistOverviewLocation({ countryCode = "", city = "" } = {}) {
  const country = String(countryCode || "").trim();
  const code = country ? discoverCountryCode(country) : "";
  if (country && !code) throw new TypeError("Choose a valid country.");
  if (typeof city !== "string" || city.length > 120 || /[\u0000-\u001f]/.test(city)) throw new TypeError("Choose a valid city.");
  return { countryCode: code || "", city: city.trim() };
}
