import { api } from "../../lib/api";
import { discardNewsDraft, endNewsLive, markNewsLiveWinner, postNewsLiveUpdate, publishNewsDraft, readNewsEditor, removeNewsLiveUpdate, setNewsLiveCategories, setNewsStoryPhoto, startNewsLive, writeNewsDraft } from "./newsDeskEditorApi.mjs";

export const loadNewsEditor = (options) => readNewsEditor(options, { apiCall: api });
export const writeDraft = (options) => writeNewsDraft(options, { apiCall: api });
export const publishDraft = (options) => publishNewsDraft(options, { apiCall: api });
export const discardDraft = (options) => discardNewsDraft(options, { apiCall: api });
export const startLive = (options) => startNewsLive(options, { apiCall: api });
export const postLiveUpdate = (options) => postNewsLiveUpdate(options, { apiCall: api });
export const endLive = (options) => endNewsLive(options, { apiCall: api });
export const removeLiveUpdate = (options) => removeNewsLiveUpdate(options, { apiCall: api });
export const setLiveCategories = (options) => setNewsLiveCategories(options, { apiCall: api });
export const markLiveWinner = (options) => markNewsLiveWinner(options, { apiCall: api });
export const chooseStoryPhoto = (options) => setNewsStoryPhoto(options, { apiCall: api });
