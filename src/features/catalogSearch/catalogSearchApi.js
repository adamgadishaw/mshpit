import { api } from "../../lib/api";
import { readCatalogSearchPage, readCatalogSearchPages } from "./catalogSearchClient.mjs";
export const searchCatalogEvents = (query, options) => readCatalogSearchPages(api, query, options);
export const searchMoreCatalogEvents = (query, options) => readCatalogSearchPage(api, query, options);
