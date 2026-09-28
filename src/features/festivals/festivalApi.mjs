import { api } from "../../lib/api";
import { discoverCountryCode } from "../../domain/discoverScene.mjs";

// Festivals (server/features/festivals): the Discover list, one festival's
// page, and the signed-in member's plan for an edition.
const SLUG = /^[a-z0-9-]{1,80}$/u;
const slugPath = (slug) => {
  const value = String(slug || "").toLowerCase();
  if (!SLUG.test(value)) throw new TypeError("A festival is required.");
  return `/api/festivals/${value}`;
};

export function readFestivals({ country = "", signal } = {}) {
  const code = discoverCountryCode(country);
  const params = code ? `?country=${encodeURIComponent(code)}` : "";
  return api(`/api/festivals${params}`, { signal, silent: true, skipIdentityCheck: true, context: "Loading festivals" });
}

export function readFestival(slug, { signal } = {}) {
  return api(slugPath(slug), { signal, silent: true, context: "Loading a festival" });
}

export function saveFestivalPlan(slug, { editionId, days, mustSee }, { signal } = {}) {
  return api(`${slugPath(slug)}/plan`, { method: "PUT", body: { editionId, days, mustSee }, signal, context: "Saving your festival plan" });
}

export function removeFestivalPlan(slug, editionId, { signal } = {}) {
  return api(`${slugPath(slug)}/plan?editionId=${encodeURIComponent(editionId)}`, { method: "DELETE", signal, context: "Removing your festival plan" });
}
