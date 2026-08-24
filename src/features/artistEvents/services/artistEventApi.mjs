import { api, AppError } from "../../../lib/api";
import {
  artistEventArchiveFromResponse,
  artistEventArchiveRequest,
  artistEventReviewsFromResponse,
  artistEventReviewsRequest,
} from "../artistEventRequest.mjs";

const SOURCE = "artist-events";

function invalidRequest(error, context) {
  return new AppError(undefined, { code: "PIT-REQ-001", context, source: SOURCE, cause: error });
}

function invalidResponse(error, context) {
  return new AppError(undefined, { code: "PIT-API-001", context, source: SOURCE, cause: error });
}

export async function readArtistEventArchive(options = {}) {
  const context = "Loading artist live archive";
  let request;
  try {
    request = artistEventArchiveRequest(options);
  } catch (error) {
    throw invalidRequest(error, context);
  }
  const payload = await api(request.path, {
    signal: options.signal,
    silent: true,
    context,
    expectedAccountId: request.expectedAccountId,
  });
  try {
    return artistEventArchiveFromResponse(payload);
  } catch (error) {
    throw invalidResponse(error, context);
  }
}
export async function readArtistEventReviews(options = {}) {
  const context = "Loading artist archive reviews";
  let request;
  try {
    request = artistEventReviewsRequest(options);
  } catch (error) {
    throw invalidRequest(error, context);
  }
  const payload = await api(request.path, {
    signal: options.signal,
    silent: true,
    context,
    expectedAccountId: request.expectedAccountId,
  });
  try {
    return artistEventReviewsFromResponse(payload);
  } catch (error) {
    throw invalidResponse(error, context);
  }
}
