import { api } from "./api";

// Group plans inside a show's Lounge. Kept apart from crewApi.js so the
// Lounge does not share a chunk with the show swipe.
const request = (path, options = {}) => api(path, { silent: true, ...options });
const loungePath = (key) => `/api/lounges/${encodeURIComponent(key)}/plans`;
const planPath = (id) => `/api/plans/${encodeURIComponent(id)}`;

export function fetchLoungePlans(key, { signal } = {}) {
  return request(loungePath(key), { signal, context: "Loading plans for this show" });
}

export function startLoungePlan(key, { kind, text, spots }) {
  return request(loungePath(key), { method: "POST", body: { kind, text, spots }, context: "Starting a plan" });
}

export function joinPlan(id) {
  return request(`${planPath(id)}/join`, { method: "POST", context: "Joining a plan" });
}

export function leavePlan(id) {
  return request(`${planPath(id)}/leave`, { method: "POST", context: "Leaving a plan" });
}

export function closePlan(id) {
  return request(`${planPath(id)}/close`, { method: "POST", context: "Closing a plan" });
}

export function removePlanMember(id, userId) {
  return request(`${planPath(id)}/members/${encodeURIComponent(userId)}`, { method: "DELETE", context: "Removing someone from a plan" });
}

export function fetchPlanMessages(id, { after = 0, signal } = {}) {
  return request(`${planPath(id)}/messages${after ? `?after=${encodeURIComponent(after)}` : ""}`, { signal, context: "Loading plan messages" });
}

export function sendPlanMessage(id, text) {
  return request(`${planPath(id)}/messages`, { method: "POST", body: { text }, context: "Sending a plan message" });
}
