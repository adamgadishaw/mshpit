import { api, AppError } from "../../../lib/api";
import {
  artistMemorialAdminListRequest,
  artistMemorialFromResponse,
  artistMemorialListFromResponse,
  artistMemorialPublicRequest,
  artistMemorialSavedFromResponse,
  artistMemorialSaveRequest,
} from "../artistMemorialRequest.mjs";

const SOURCE = "artist-memorials";

function invalidRequest(error, context) {
  return new AppError(undefined, { code: "PIT-REQ-001", context, source: SOURCE, cause: error });
}

function invalidResponse(error, context) {
  return new AppError(undefined, { code: "PIT-API-001", context, source: SOURCE, cause: error });
}

export async function readArtistMemorial(options = {}) {
  const context = "Loading artist memorial";
  let request;
  try {
    request = artistMemorialPublicRequest(options);
  } catch (error) {
    throw invalidRequest(error, context);
  }
  const response = await api(request.path, {
    signal: options.signal,
    silent: true,
    context,
    expectedAccountId: request.expectedAccountId,
  });
  try {
    return artistMemorialFromResponse(response);
  } catch (error) {
    throw invalidResponse(error, context);
  }
}

export async function listArtistMemorials(options = {}) {
  const context = "Loading artist memorials";
  const request = artistMemorialAdminListRequest(options);
  const response = await api(request.path, {
    signal: options.signal,
    silent: true,
    context,
    expectedAccountId: request.expectedAccountId,
  });
  try {
    return artistMemorialListFromResponse(response);
  } catch (error) {
    throw invalidResponse(error, context);
  }
}

export async function saveArtistMemorial(input, options = {}) {
  const context = "Saving artist memorial";
  let request;
  try {
    request = artistMemorialSaveRequest(input, options);
  } catch (error) {
    throw invalidRequest(error, context);
  }
  const response = await api(request.path, {
    method: "PUT",
    body: request.body,
    signal: options.signal,
    silent: true,
    context,
    expectedAccountId: request.expectedAccountId,
  });
  try {
    return artistMemorialSavedFromResponse(response);
  } catch (error) {
    throw invalidResponse(error, context);
  }
}
