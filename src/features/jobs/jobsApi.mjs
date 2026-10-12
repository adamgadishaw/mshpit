import { api } from "../../lib/api";
export const listAdminJobs = ({ signal, cursor = "" } = {}) => api(`/api/admin/jobs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { signal, silent: true, context: "Loading job openings" });
export const createAdminJob = ({ id, draft, signal }) => api("/api/admin/jobs", { method: "POST", body: { id, draft }, signal, context: "Saving a job draft" });
export const updateAdminJob = ({ id, revision, draft, action, signal }) => api(`/api/admin/jobs/${encodeURIComponent(id)}`, { method: "POST", body: { revision, draft, action }, signal, context: "Updating a job opening" });
