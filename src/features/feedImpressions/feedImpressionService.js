import { createFeedImpressionQueue } from "../../domain/feedImpressions.mjs";
import { api } from "../../lib/api";
import { sendFeedImpressionBatch } from "./feedImpressionApi.mjs";

const queue = createFeedImpressionQueue({
  send: (impressions, { accountId }) => sendFeedImpressionBatch(impressions, {
    accountId,
    apiCall: api,
  }),
});

export const configureFeedImpressions = (session) => queue.configure(session?.id || null);
export const recordFeedImpression = (impression) => queue.record(impression);
export const recordFeedImpressionForSession = (session, impression) => {
  configureFeedImpressions(session);
  return recordFeedImpression(impression);
};
export const flushFeedImpressions = () => queue.flush();
export const setFeedImpressionsActive = (active) => queue.setActive(active);
