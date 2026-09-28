import { api } from "../../lib/api";
import { discardNewsDraft, publishNewsDraft, readNewsEditor, writeNewsDraft } from "./newsDeskEditorApi.mjs";

export const loadNewsEditor = (options) => readNewsEditor(options, { apiCall: api });
export const writeDraft = (options) => writeNewsDraft(options, { apiCall: api });
export const publishDraft = (options) => publishNewsDraft(options, { apiCall: api });
export const discardDraft = (options) => discardNewsDraft(options, { apiCall: api });
