export const ARTIST_REQUEST_SAVE_ERROR = "That request did not save. Please try again.";
export const ARTIST_REQUEST_CONFIRMATION_ERROR = "Pit did not confirm that request. Please try again.";

const confirmedId = (value) => {
  if (typeof value !== "string" || value !== value.trim()) return null;
  return /^[A-Za-z0-9_-]{2,120}$/.test(value) ? value : null;
};

// Artist-request rows must be anchored to the ID returned after the server has
// committed the request. Never manufacture an ID that can look durable locally.
export function confirmedArtistRequest(response, submission) {
  const id = confirmedId(response?.id);
  const userId = typeof submission?.userId === "string" ? submission.userId.trim() : "";
  const artistName = typeof submission?.artistName === "string" ? submission.artistName.trim() : "";
  const note = typeof submission?.note === "string" ? submission.note : "";
  if (!id || !userId || artistName.length < 2) return null;
  return { id, userId, artistName, note, status: "pending" };
}

export function mergeConfirmedArtistRequest(current, request) {
  const rows = Array.isArray(current) ? current : [];
  if (!request?.id) return rows;
  return [request, ...rows.filter((row) => row?.id !== request.id)];
}

export function artistRequestFailureMessage(error) {
  const safeMessage = typeof error?.userMessage === "string" ? error.userMessage.trim() : "";
  return safeMessage || ARTIST_REQUEST_SAVE_ERROR;
}
