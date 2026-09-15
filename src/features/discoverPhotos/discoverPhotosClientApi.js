import { api } from "../../lib/api";
import { fetchDiscoverPhotos } from "./discoverPhotosApi.mjs";

export function loadDiscoverPhotos(options) {
  return fetchDiscoverPhotos({ ...options, apiClient: api });
}
