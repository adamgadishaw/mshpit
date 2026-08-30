import { api } from "../../lib/api";
import {
  readPublicPost as readPublicPostWithApi,
  resolvePublicEntity as resolvePublicEntityWithApi,
} from "./publicNavigationApi.mjs";

// The app shell owns navigation state; this feature service owns the network
// transport needed to hydrate a public URL after a browser refresh.
export const resolvePublicEntity = (path, options) => resolvePublicEntityWithApi(path, options, { apiCall: api });

export const readPublicPost = (id, options) => readPublicPostWithApi(id, options, { apiCall: api });
