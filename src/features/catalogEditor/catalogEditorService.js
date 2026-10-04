import { api } from "../../lib/api";
import { createCatalogEditorApi } from "./catalogEditorApi.mjs";

export const catalogEditorForAccount = accountId => createCatalogEditorApi({ accountId, apiCall: api });
