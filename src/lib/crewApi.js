import { api } from "./api";

// Crew: shows you might go to, people to go with. Every call is silent so the
// screen shows its own friendly states instead of a generic toast.
const request = (path, options = {}) => api(path, { silent: true, ...options });
const tourDatePath = (tourDateId) => `/api/crew/shows/${encodeURIComponent(tourDateId)}`;

export function fetchCrewShows({ city = null, signal } = {}) {
  const query = city ? `?city=${encodeURIComponent(city)}` : "";
  return request(`/api/crew/shows${query}`, { signal, context: "Loading shows near you" });
}

export function passCrewShow(tourDateId) {
  return request(`${tourDatePath(tourDateId)}/pass`, { method: "POST", context: "Skipping a show" });
}

// Right swipe on a show: the same attendance every other screen uses.
export function markCrewShow(tourDateId, state) {
  return request("/api/going", {
    method: "POST",
    body: { tourDateId, state },
    context: state === "going" ? "Saying you're going" : "Saving a show you're interested in",
  });
}

export function startCrewSeeking(tourDateId, { purposes = [], note = "" } = {}) {
  return request(`${tourDatePath(tourDateId)}/seeking`, {
    method: "PUT",
    body: { purposes, note },
    context: "Looking for a crew",
  });
}

export function stopCrewSeeking(tourDateId) {
  return request(`${tourDatePath(tourDateId)}/seeking`, { method: "DELETE", context: "Stopping crew search" });
}

export function fetchCrewPeople(tourDateId, { signal } = {}) {
  return request(`${tourDatePath(tourDateId)}/people`, { signal, context: "Loading people going to this show" });
}

export function swipeCrewPerson(tourDateId, userId, decision) {
  return request(`${tourDatePath(tourDateId)}/people/${encodeURIComponent(userId)}`, {
    method: "POST",
    body: { decision },
    context: decision === "like" ? "Crewing up" : "Passing",
  });
}

export function fetchMyCrew({ signal } = {}) {
  return request("/api/crew/me", { signal, context: "Loading your crews" });
}
