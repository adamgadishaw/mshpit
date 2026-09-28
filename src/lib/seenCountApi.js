import { api } from "./api";

// The review form's "times seen" starting number (server/supportingActs.js):
// for a new show, everything before its date plus this show; for a saved
// review (postId), the number it shows now. A read the form treats as a hint.
export function fetchSeenCount({ artist = "", artistKey = null, date = "", postId = null, signal } = {}) {
  const params = new URLSearchParams();
  if (postId) params.set("postId", postId);
  else {
    params.set("artist", artist);
    if (artistKey) params.set("artistKey", artistKey);
    if (date) params.set("date", date);
  }
  return api(`/api/me/seen-count?${params.toString()}`, { silent: true, signal, context: "Counting times you saw this artist" });
}
