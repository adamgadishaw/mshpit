import { api } from "../../lib/api";
import { fetchArtistBiography as fetchWithApi, saveArtistBiography as saveWithApi } from "./artistBiographyApi.mjs";

export const fetchArtistBiography = (options) => fetchWithApi(options, { apiCall: api });
export const saveArtistBiography = (options) => saveWithApi(options, { apiCall: api });
