import { api } from "../../lib/api";
import { createPageHeadController } from "./pageHeadController.mjs";
import {
  readPublicPost as readPublicPostWithApi,
  resolveNavigationArtist as resolveNavigationArtistWithApi,
  resolvePublicEntity as resolvePublicEntityWithApi,
} from "./publicNavigationApi.mjs";

// The app shell owns navigation state; this feature service owns the network
// transport needed to hydrate a public URL after a browser refresh.
export const resolvePublicEntity = (path, options) => resolvePublicEntityWithApi(path, options, { apiCall: api });

export const readPublicPost = (id, options) => readPublicPostWithApi(id, options, { apiCall: api });
export const resolveNavigationArtist = (name, options) => resolveNavigationArtistWithApi(name, options, { apiCall: api });

export const createPublicPageHeadController = (options) => createPageHeadController({
  ...options,
  // This endpoint always returns anonymous public metadata, never account data.
  // A pending sign-in handshake must not hold the browser's head on an old page.
  apiCall: (path, request) => api(path, { ...request, skipIdentityCheck: true, timeoutMs: 6_000 }),
});
