import { api, AppError } from "../../../lib/api";
import { artistReviewsFromResponse, artistReviewsRequest } from "../artistReviewsRequest.mjs";

const CONTEXT = "Loading artist reviews";
const SOURCE = "artist-reviews";

export async function readArtistTopReviews(options = {}) {
  let request;
  try {
    request = artistReviewsRequest(options);
  } catch (error) {
    throw new AppError(undefined, {
      code: "PIT-REQ-001",
      context: CONTEXT,
      source: SOURCE,
      cause: error,
    });
  }

  const payload = await api(request.path, {
    signal: options.signal,
    silent: true,
    context: CONTEXT,
    expectedAccountId: request.expectedAccountId,
  });

  try {
    return artistReviewsFromResponse(payload);
  } catch (error) {
    throw new AppError(undefined, {
      code: "PIT-API-001",
      context: CONTEXT,
      source: SOURCE,
      cause: error,
    });
  }
}
