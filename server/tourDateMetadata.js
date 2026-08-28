const cleanLine = (value, maxLength = 160) => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maxLength) : null;
};

const identity = (value) => String(value || "")
  .normalize("NFKD")
  .replace(/\p{Mark}+/gu, "")
  .toLocaleLowerCase("en")
  .replace(/&/g, " and ")
  .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
  .trim();

const TOUR_TOKEN = /\btour\b/i;
const SPECIAL_EVENT_TOKEN = /\b(?:festival|fest|fair|fairs|rodeo|carnival|exhibition|expo)\b/i;
const TITLE_SEPARATOR = /\s+(?:[-\u2013\u2014|])\s+|:\s+/;

// Ticketmaster Discovery supplies an official event title, not a dedicated
// music-tour field. Keep the original title separately and only promote one
// unambiguous, explicitly labelled concert-title segment to `tour_name`.
export function deriveTourNameFromEventTitle({ eventName, artist, eventKind } = {}) {
  const title = cleanLine(eventName);
  const artistName = cleanLine(artist);
  if (!title || !artistName || identity(eventKind) !== "concert") return null;
  if (!TOUR_TOKEN.test(title) || SPECIAL_EVENT_TOKEN.test(title)) return null;

  const segments = title.split(TITLE_SEPARATOR)
    .map((segment) => segment.replace(/^[\s"'\u201c\u201d]+|[\s"'\u201c\u201d]+$/g, "").trim())
    .filter(Boolean);
  const tourSegments = segments.filter((segment) => TOUR_TOKEN.test(segment));
  if (tourSegments.length !== 1) return null;

  const candidate = tourSegments[0];
  const candidateIdentity = identity(candidate);
  if (!candidateIdentity || candidateIdentity === "tour" || candidateIdentity === identity(artistName)) return null;
  return candidate;
}

export function publicTourDateProviderFields(row) {
  const approximate = row?.access_start_approximate;
  return {
    providerEventId: cleanLine(row?.provider_event_id),
    eventName: cleanLine(row?.event_name),
    tourName: cleanLine(row?.tour_name),
    startDateTime: cleanLine(row?.start_date_time, 80),
    startLocalTime: cleanLine(row?.start_local_time, 80),
    accessStartDateTime: cleanLine(row?.access_start_date_time, 80),
    accessStartApproximate: approximate == null ? null : !!approximate,
    eventStatus: cleanLine(row?.event_status, 40),
  };
}
