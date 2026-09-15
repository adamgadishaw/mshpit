import { api } from "../../lib/api";
import { readCatalogMaintenance, setCatalogMaintenanceMode } from "./catalogMaintenanceApi.mjs";

export const loadCatalogMaintenance = (options) => readCatalogMaintenance(options, { apiCall: api });
export const changeCatalogMaintenanceMode = (options) => setCatalogMaintenanceMode(options, { apiCall: api });
