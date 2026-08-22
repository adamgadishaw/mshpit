import { api } from "../../../lib/api";

export function readAdminHealth({ signal } = {}) {
  return api("/api/admin/health", {
    signal,
    silent: true,
    context: "Loading playback health",
  });
}
