import { apiUrl } from "../../lib/api";

// Landing media is published as a same-origin path by the server. Keeping base
// URL resolution behind this feature boundary also supports native API hosts.
export const resolveLandingMediaPath = (path) => apiUrl(path);
