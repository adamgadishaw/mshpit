import { api, AppError } from "../../../lib/api";
import {
  artistRecommendationRequest,
  artistRecommendationsFromResponse,
} from "../artistRecommendationRequest.mjs";

const CONTEXT = "Finding artists for you";
const SOURCE = "artist-recommendations";

export async function readArtistRecommendations(options = {}) {
  let request;
  try {
    request = artistRecommendationRequest(options);
  } catch (error) {
    throw new AppError(undefined, { code: "PIT-REQ-001", context: CONTEXT, source: SOURCE, cause: error });
  }
  const payload = await api(request.path, {
    signal: options.signal,
    silent: true,
    context: CONTEXT,
    expectedAccountId: request.expectedAccountId,
  });
  try {
    return artistRecommendationsFromResponse(payload);
  } catch (error) {
    throw new AppError(undefined, { code: "PIT-API-001", context: CONTEXT, source: SOURCE, cause: error });
  }
}
