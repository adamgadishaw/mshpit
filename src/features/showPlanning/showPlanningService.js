import { api } from "../../lib/api";
import { fetchMyShowPlans as fetchMyShowPlansWithApi } from "./showPlanningApi.mjs";

export const fetchMyShowPlans = (options) => fetchMyShowPlansWithApi(options, { apiCall: api });
