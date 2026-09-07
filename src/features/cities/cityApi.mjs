import { Platform } from "react-native";
import { api, apiUrl } from "../../lib/api";
import { discoverCountryCode } from "../../domain/discoverScene.mjs";
import { projectCityMedia } from "./cityMediaProjection.mjs";

const mediaForRuntime = (payload, admin) => Platform.OS === "web" || admin ? payload : projectCityMedia(payload, apiUrl);

function cityEndpoint(city, admin = false) {
  const country = String(city?.countryCode || "").toLowerCase();
  const slug = String(city?.citySlug || "");
  if (!/^[a-z]{2}$/.test(country) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new TypeError("A country and city are required.");
  return `/api/${admin ? "admin/" : ""}cities/${country}/${slug}`;
}
const options = ({ signal, admin = false, accountId } = {}) => ({ signal, silent: true, skipIdentityCheck: !admin, ...(admin ? { expectedAccountId: accountId } : {}) });
export function readCityDirectory({ query = "", country = "", limit = 12, cursor = null, ...request } = {}) {
  const params = new URLSearchParams({ q: query.trim().slice(0, 100), limit: String(Math.max(1, Math.min(100, limit))) });
  const countryCode = discoverCountryCode(country);
  if (countryCode) params.set("country", countryCode);
  if (cursor != null) params.set("cursor", String(cursor));
  return api(`/api/${request.admin ? "admin/" : ""}cities?${params}`, { ...options(request), context: "Loading cities" }).then((payload) => mediaForRuntime(payload, request.admin));
}
export function readCityGuide(city, request = {}) {
  return api(cityEndpoint(city, request.admin), { ...options(request), skipIdentityCheck: false, ...(request.accountId !== undefined ? { expectedAccountId: request.accountId } : {}), context: "Loading a city page" }).then((payload) => mediaForRuntime(payload, request.admin));
}
export function readCityCopy(request = {}) {
  return api(`/api/${request.admin ? "admin/" : ""}city-copy`, { ...options(request), context: "Loading city page wording" }).then((payload) => mediaForRuntime(payload, request.admin));
}
export function saveCityGuide(city, { editorial, revision }, { signal, accountId } = {}) {
  return api(cityEndpoint(city, true), { method: "PUT", body: { editorial, revision }, signal, expectedAccountId: accountId, context: "Saving a city page" });
}
export function saveCityCopy({ copy, revision }, { signal, accountId } = {}) {
  return api("/api/admin/city-copy", { method: "PUT", body: { copy, revision }, signal, expectedAccountId: accountId, context: "Saving city page wording" });
}
