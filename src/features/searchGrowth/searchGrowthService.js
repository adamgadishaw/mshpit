import { api } from "../../lib/api";
import { readSearchGrowth, setSearchGrowthMode } from "./searchGrowthApi.mjs";

export const loadSearchGrowth = (options) => readSearchGrowth(options, { apiCall: api });
export const changeSearchGrowthMode = (options) => setSearchGrowthMode(options, { apiCall: api });
