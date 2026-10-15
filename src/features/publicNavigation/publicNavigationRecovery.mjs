import { resolvePublicFrameIdentity } from "../../domain/publicFrameIdentity.mjs";

// Loaded only when an uncached public destination needs identity recovery.
// Profile reads remain available while the artist directory is cooling down.
export async function recoverPublicNavigation(candidate, {
  owner, scope, controller, current, resolveArtist,
  createArtistLookupController, artistLookupFailureMessage, ...options
}) {
  let usedDirectory = false;
  try {
    const result = await resolvePublicFrameIdentity(candidate, {
      ...options, signal: controller.signal,
      resolveArtist: async (name) => {
        if (!current()) return null;
        usedDirectory = true;
        const lookup = owner.lookup ||= createArtistLookupController();
        const request = lookup.begin(scope, name);
        if (!request) throw Object.assign(new Error("Artist lookup is cooling down."), { serverCode: "PROVIDER_UNAVAILABLE" });
        const cancel = () => request.controller.abort(controller.signal.reason);
        controller.signal.addEventListener("abort", cancel, { once: true });
        if (controller.signal.aborted) cancel();
        try {
          const artist = await resolveArtist(name, { signal: request.controller.signal });
          if (!lookup.isCurrent(request)) controller.abort();
          return artist;
        } catch (error) {
          if (current()) lookup.fail(request, error);
          throw error;
        } finally {
          controller.signal.removeEventListener("abort", cancel);
          lookup.finish(request);
        }
      },
    });
    return result || { notice: { message: "This artist or profile does not have an available page yet." } };
  } catch (error) {
    return { notice: {
      error, directoryUnavailable: usedDirectory,
      message: usedDirectory ? artistLookupFailureMessage(error) : "This profile could not be opened. Please try again.",
    } };
  }
}
