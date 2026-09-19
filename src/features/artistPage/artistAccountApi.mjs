export async function artistAccountRequest({ accountId, signal, artistName, bio, create = false }, { apiCall }) {
  if (!accountId) throw new TypeError("Log in to set up an artist page.");
  signal?.throwIfAborted();
  const result = await apiCall(create ? "/api/artist-pages" : "/api/artist-account", {
    method: create ? "POST" : "GET",
    ...(create ? { body: { artistName, bio } } : {}),
    expectedAccountId: accountId, signal, silent: true,
    context: create ? "Creating your artist page" : "Loading your artist account",
  });
  signal?.throwIfAborted();
  if (result?.ok !== true || result.user?.id !== accountId
    || (create && (result.user.role !== "artist" || !result.artist?.key || !result.profile?.ownerId
      || result.profile.ownerId !== accountId))) {
    throw new TypeError("Your artist page could not be confirmed. Reload before trying again.");
  }
  return result;
}

export async function runArtistAccountCommand(options, { apiCall, isCurrent, confirmUser, cacheArtists, setRequests, fail }) {
  try {
    if (!isCurrent() || options.signal?.aborted) return { ...fail(new Error("Your account changed. Reopen artist setup.")), stale: true };
    if (options.requestReview) return submitArtistReview(options, { apiCall, isCurrent, setRequests, fail });
    const result = await artistAccountRequest(options, { apiCall });
    if (!isCurrent() || options.signal?.aborted) return { ...fail(new Error("Your account changed. Reopen artist setup.")), stale: true };
    confirmUser(result.user, { announce: options.create === true, hydrateAccount: false });
    if (result.artist) cacheArtists([result.artist]);
    return commandSuccess(result);
  } catch (error) {
    return fail(error);
  }
}

export async function submitArtistReview({ accountId, artistName, note, signal }, { apiCall, isCurrent, setRequests, fail }) {
  const name = clean(artistName, { max: LIMITS.artist });
  if (name.length < 2) return fail(new Error("Enter the artist name."));
  const cleanNote = clean(note, { max: LIMITS.note, newlines: true });
  try {
    if (!isCurrent() || signal?.aborted) return { ...fail(new Error("Your account changed. Reopen artist setup.")), stale: true };
    const response = await apiCall("/api/artist-requests", {
      method: "POST", body: { artistName: name, note: cleanNote },
      context: "Requesting an artist account", silent: true, signal, expectedAccountId: accountId,
    });
    if (!isCurrent() || signal?.aborted) return { ...fail(new Error("Your account changed. Reopen artist setup.")), stale: true };
    const request = confirmedArtistRequest(response, { userId: accountId, artistName: name, note: cleanNote });
    if (!request) return fail(new Error(ARTIST_REQUEST_CONFIRMATION_ERROR));
    setRequests((current) => mergeConfirmedArtistRequest(current, request));
    return commandSuccess({ request });
  } catch (error) {
    return fail(error);
  }
}
import { clean, LIMITS } from "../../domain/validation.mjs";
import { ARTIST_REQUEST_CONFIRMATION_ERROR, confirmedArtistRequest, mergeConfirmedArtistRequest } from "../../domain/artistRequestMutation.mjs";
import { commandSuccess } from "../../domain/commandResult.mjs";
