import { api, AppError } from "../../../lib/api";
import { artistOverviewFromResponse, artistOverviewRequest } from "../artistOverviewRequest.mjs";

export async function readArtistOverview(options = {}) {
  const context = "Loading artist shows and ratings";
  let request;
  try { request = artistOverviewRequest(options); }
  catch (cause) { throw new AppError(undefined, { code: "PIT-REQ-001", context, source: "artist-overview", cause }); }
  const payload = await api(request.path, {
    signal: options.signal, expectedAccountId: request.expectedAccountId, silent: true, context,
  });
  try { return artistOverviewFromResponse(payload); }
  catch (cause) { throw new AppError(undefined, { code: "PIT-API-001", context, source: "artist-overview", cause }); }
}
