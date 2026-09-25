import { api } from "./api";

// Show swipe. Every call is silent so the screen shows its own friendly
// states instead of a generic toast.
const request = (path, options = {}) => api(path, { silent: true, ...options });

export function fetchCrewShows({ city = null, signal } = {}) {
  const query = city ? `?city=${encodeURIComponent(city)}` : "";
  return request(`/api/crew/shows${query}`, { signal, context: "Loading shows near you" });
}

export function passCrewShow(tourDateId) {
  return request(`/api/crew/shows/${encodeURIComponent(tourDateId)}/pass`, { method: "POST", context: "Skipping a show" });
}

// Right or up on a show: the same attendance every other screen uses.
export function markCrewShow(tourDateId, state) {
  return request("/api/going", {
    method: "POST",
    body: { tourDateId, state },
    context: state === "going" ? "Saying you're going" : "Saving a show you're interested in",
  });
}

export function fetchMyPlans({ signal } = {}) {
  return request("/api/me/plans", { signal, context: "Loading your plans" });
}
