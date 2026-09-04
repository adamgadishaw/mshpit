const MAX_LABEL_LENGTH = 180;
const MAX_SEAT_PART_LENGTH = 48;
const SPECIAL_EVENT_KINDS = new Set([
  "festival", "fair", "state-fair", "exhibition", "rodeo", "multi-day",
]);

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const cleanText = (value, maxLength = MAX_LABEL_LENGTH) => {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
};

const firstText = (...values) => {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
};

const sameText = (left, right) =>
  cleanText(left).toLocaleLowerCase() === cleanText(right).toLocaleLowerCase();

const normalizeKind = (value) => cleanText(value, 48)
  .toLocaleLowerCase()
  .replace(/[_\s]+/g, "-")
  .replace(/[^a-z0-9-]/g, "");

const objectName = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return firstText(value.name, value.title, value.label);
};

const readBoolean = (...values) => values.some((value) => value === true);

// One opaque token identifies one deliberate ticket-post publish attempt. The
// composer keeps it for its lifetime so retrying a request whose response was
// lost reaches the server's idempotent-create path instead of looking like a
// second ticket post for the same event.
export function createAttendanceTicketClientMutationId(now = Date.now(), random = Math.random()) {
  const stamp = Math.max(0, Number(now) || 0).toString(36);
  const entropy = Math.max(0, Math.min(0.9999999999999999, Number(random) || 0))
    .toString(36)
    .slice(2, 14)
    .padEnd(8, "0");
  return `p_local_ticket_${stamp}_${entropy}`.slice(0, 120);
}

const safeInteger = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};

const stripArtistPrefix = (title, artistName) => {
  const label = cleanText(title);
  const artist = cleanText(artistName);
  if (!label || !artist) return label;
  const escapedArtist = artist.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return label.replace(new RegExp(`^${escapedArtist}\\s*(?:[:\u2013\u2014\\-]|\\bat\\b)\\s*`, "i"), "").trim() || label;
};

const isSpecialEvent = (kind) => SPECIAL_EVENT_KINDS.has(kind)
  || kind.includes("festival")
  || kind.includes("fair")
  || kind.includes("rodeo");

const sentenceTourTitle = (value) => {
  const title = cleanText(value);
  if (!title || /^the\b/i.test(title) || !/\btour\b/i.test(title)) return title;
  return `the ${title}`;
};

const wallClockParts = (value) => {
  const text = cleanText(value, 100);
  if (!text) return null;
  const match = text.match(/(?:^|T|\s)([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\s*(AM|PM)?(?:\s|$|Z|[+\-]\d{2}:?\d{2})/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const meridiem = match[3]?.toLocaleUpperCase();
  if (meridiem === "PM" && hours < 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;
  return { hours, minutes: Number(match[2]) };
};

const formatClockParts = ({ hours, minutes }) => {
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(minutes).padStart(2, "0")} ${suffix}`;
};

const absoluteClock = (value, timeZone) => {
  if (!timeZone) return null;
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone,
    }).format(timestamp);
  } catch {
    return null;
  }
};

const calendarParts = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? null
      : { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  }
  const text = cleanText(value, 100);
  const match = text.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
};

const validCalendarParts = (parts) => {
  if (!parts) return false;
  const { year, month, day } = parts;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

export function safeAttendanceTicketImageUri(value) {
  const candidate = typeof value === "object" && value !== null
    ? firstText(value.uri, value.url)
    : cleanText(value, 2_000);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    const localHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !localHttp) return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function normalizeAttendanceTicketPhotoAttribution(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.source !== "licensed-media") return null;
  const title = cleanText(value.title, 240);
  const creator = cleanText(value.creator, 120);
  const license = cleanText(value.license, 40);
  const sourcePage = safeAttendanceTicketImageUri(value.sourcePage);
  const licenseUrl = safeAttendanceTicketImageUri(value.licenseUrl);
  const modificationNotice = cleanText(value.modificationNotice, 160);
  if (!title || !creator || !license || !sourcePage || !licenseUrl || !modificationNotice) return null;
  return { source: "licensed-media", title, creator, license, sourcePage, licenseUrl, modificationNotice };
}

export function formatAttendanceTicketDate(value) {
  const parts = calendarParts(value);
  if (!validCalendarParts(parts)) return null;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  return `${WEEKDAYS[date.getUTCDay()]} \u00b7 ${MONTHS[parts.month - 1]} ${parts.day} \u00b7 ${parts.year}`;
}

export function formatAttendanceTicketTime(value, { timeZone = null } = {}) {
  if (value == null || value === "") return null;
  const text = typeof value === "string" ? value.trim() : "";
  const hasAbsoluteOffset = /(?:Z|[+\-]\d{2}:?\d{2})$/i.test(text);
  if (hasAbsoluteOffset || value instanceof Date || typeof value === "number") {
    return absoluteClock(value, cleanText(timeZone, 80));
  }
  const wallClock = wallClockParts(value);
  return wallClock ? formatClockParts(wallClock) : null;
}

export function normalizeSharedSeatLocation(value, { shared = false } = {}) {
  if (shared !== true || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const section = firstText(value.section, value.sectionName).slice(0, MAX_SEAT_PART_LENGTH);
  const row = firstText(value.row, value.rowName).slice(0, MAX_SEAT_PART_LENGTH);
  const seat = firstText(value.seat, value.seatNumber).slice(0, MAX_SEAT_PART_LENGTH);
  if (!section && !row && !seat) return null;
  return {
    ...(section ? { section } : {}),
    ...(row ? { row } : {}),
    ...(seat ? { seat } : {}),
  };
}

export function normalizeAttendanceTicketShow(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const eventKind = normalizeKind(firstText(value.eventKind, value.kind, value.category, value.type));
  const special = isSpecialEvent(eventKind);
  const artistName = firstText(value.artistName, objectName(value.artist), value.artist, value.headlinerName, objectName(value.headliner));
  const providerEventName = firstText(value.eventName, value.officialEventName, value.eventTitle, value.title, value.name);
  const eventTitle = special ? firstText(providerEventName, artistName) : firstText(artistName, providerEventName);
  if (!eventTitle) return null;

  // `officialTitle` remains input-only compatibility for older local drafts.
  // Output uses a provenance-neutral name because tour_name can be a cautious
  // derivation from the provider's event title rather than a dedicated field.
  const tourTitle = firstText(value.tourName, objectName(value.tour), value.tourTitle, value.contextTitle, value.officialTitle, value.tour);
  const contextCandidate = firstText(tourTitle, providerEventName);
  const contextTitle = contextCandidate && !sameText(contextCandidate, eventTitle) ? contextCandidate : null;
  const isTourTitle = !!contextTitle && (
    !!firstText(value.tourName, objectName(value.tour), value.tourTitle, value.tour)
    || readBoolean(value.isTourTitle, value.tourTitleVerified, value.verifiedTourTitle)
  );
  const venue = firstText(value.venueName, objectName(value.venue), value.venue);
  const city = firstText(value.cityName, objectName(value.city), value.city, value.locality);
  const timeZone = firstText(value.timeZone, value.timezone, value.eventTimezone, value.venueTimeZone);
  const dateSource = value.date ?? value.startDate ?? value.localDate ?? value.startDateTime ?? value.dateTime ?? value.start;
  const startSource = value.startTime ?? value.showStartTime ?? value.startLocalTime ?? value.localTime ?? value.startDateTime ?? value.dateTime;
  const doorsSource = value.doorsOpenTime
    ?? value.doorsTime
    ?? value.doorsAt
    ?? value.doorsOpen
    ?? value.doors;
  const dateLabel = formatAttendanceTicketDate(dateSource);
  const startLabel = formatAttendanceTicketTime(startSource, { timeZone });
  const doorsVerified = readBoolean(value.doorsVerified, value.doorsOpenVerified, value.verifiedDoors)
    && doorsSource != null;
  const doorsLabel = doorsVerified ? formatAttendanceTicketTime(doorsSource, { timeZone }) : null;
  // Ticketmaster's `dates.access` is the time fans may access the event. It is
  // not proof of a venue's doors time. Legacy snapshots briefly used doorsAt
  // for this provider field, so unverified doorsAt values are downgraded here.
  const accessSource = value.accessStartDateTime
    ?? (!doorsVerified ? value.doorsAt : null);
  const accessApproximate = value.accessStartApproximate
    ?? (!doorsVerified ? value.doorsApproximate : null);
  const accessLabel = !doorsVerified && accessSource != null
    ? formatAttendanceTicketTime(accessSource, { timeZone })
    : null;

  const tourStopNumber = safeInteger(value.tourStopNumber ?? value.tourDayNumber);
  const tourStopTotal = safeInteger(value.tourStopTotal ?? value.tourDateCount);
  const providedTourStop = firstText(value.tourStopLabel, value.tourStop, value.dayOfTour);
  const builtTourStop = tourStopNumber
    ? `Tour stop ${tourStopNumber}${tourStopTotal ? ` of ${tourStopTotal}` : ""}`
    : "";
  const tourStopLabel = readBoolean(value.tourStopVerified, value.verifiedTourStop)
    ? firstText(providedTourStop, builtTourStop)
    : null;

  const artistImageUri = safeAttendanceTicketImageUri(firstText(
    value.artistImageUri,
    value.artistProfileImageUri,
    value.artistAvatarUri,
    value.artistPhotoUri,
    typeof value.artistImage === "object" ? firstText(value.artistImage.uri, value.artistImage.url) : value.artistImage,
  ));
  const artistPhotoAttribution = artistImageUri
    ? normalizeAttendanceTicketPhotoAttribution(value.artistPhotoAttribution ?? value.artistImageAttribution)
    : null;

  return {
    eventTitle,
    ...(contextTitle ? { contextTitle } : {}),
    isTourTitle,
    ...(artistName && !sameText(artistName, eventTitle) ? { artistName } : {}),
    ...(eventKind ? { eventKind } : {}),
    isSpecialEvent: special,
    ...(venue ? { venue } : {}),
    ...(city ? { city } : {}),
    ...(dateLabel ? { dateLabel } : {}),
    timing: [
      ...(doorsLabel ? [{ kind: "doors", label: "VERIFIED DOORS", value: doorsLabel }] : []),
      ...(accessLabel ? [{
        kind: "access",
        label: accessApproximate === true ? "ACCESS TIME · APPROX." : "ACCESS TIME",
        value: accessLabel,
      }] : []),
      ...(startLabel ? [{ kind: "start", label: "SHOW START", value: startLabel }] : []),
    ],
    ...(tourStopLabel ? { tourStopLabel } : {}),
    ...(artistImageUri ? { artistImageUri } : {}),
    ...(artistPhotoAttribution ? { artistPhotoAttribution } : {}),
  };
}

const authorName = (value) => {
  if (typeof value === "string") return cleanText(value, 80);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return firstText(
    value.name,
    value.displayName,
    value.handle ? `@${cleanText(value.handle, 60).replace(/^@/, "")}` : "",
  );
};

export function attendanceTicketAuthorSentence({ author, show } = {}) {
  const normalized = show?.eventTitle ? show : normalizeAttendanceTicketShow(show);
  if (!normalized) return null;
  const subject = authorName(author) || "A Mshpit fan";
  if (normalized.isSpecialEvent) return `${subject} is going to ${normalized.eventTitle}.`;
  if (!normalized.isTourTitle) return `${subject} is going to ${normalized.eventTitle}.`;
  const tourTitle = sentenceTourTitle(stripArtistPrefix(normalized.contextTitle, normalized.eventTitle));
  return tourTitle && !sameText(tourTitle, normalized.eventTitle)
    ? `${subject} is going to ${normalized.eventTitle} for ${tourTitle}.`
    : `${subject} is going to ${normalized.eventTitle}.`;
}

export function buildAttendanceTicketPreview(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const wrapped = input.show && typeof input.show === "object" ? input : { show: input, author: input.author };
  const show = normalizeAttendanceTicketShow(wrapped.show);
  if (!show) return null;
  const shared = wrapped.shareSeatLocation === true
    || wrapped.seatLocationShared === true
    || wrapped.show?.shareSeatLocation === true
    || wrapped.show?.seatLocationShared === true;
  const seatLocation = normalizeSharedSeatLocation(
    wrapped.seatLocation || wrapped.show?.seatLocation,
    { shared },
  );
  const authorSentence = attendanceTicketAuthorSentence({ author: wrapped.author, show });
  const place = [show.venue, show.city].filter(Boolean).join(", ");
  const timingText = show.timing.map((item) => `${item.label.toLocaleLowerCase()} ${item.value}`).join(", ");
  const seatText = seatLocation
    ? [
        seatLocation.section && `section ${seatLocation.section}`,
        seatLocation.row && `row ${seatLocation.row}`,
        seatLocation.seat && `seat ${seatLocation.seat}`,
      ].filter(Boolean).join(", ")
    : "";
  const accessibilityLabel = [
    authorSentence,
    show.contextTitle,
    place,
    show.dateLabel,
    timingText,
    seatText,
  ].filter(Boolean).join(" ");

  return {
    kind: "attendance-ticket",
    version: 1,
    eventTitle: show.eventTitle,
    ...(show.contextTitle ? { contextTitle: show.contextTitle } : {}),
    isTourTitle: show.isTourTitle,
    ...(show.artistName ? { artistName: show.artistName } : {}),
    ...(show.eventKind ? { eventKind: show.eventKind } : {}),
    isSpecialEvent: show.isSpecialEvent,
    ...(show.venue ? { venue: show.venue } : {}),
    ...(show.city ? { city: show.city } : {}),
    ...(show.dateLabel ? { dateLabel: show.dateLabel } : {}),
    timing: show.timing,
    ...(show.tourStopLabel ? { tourStopLabel: show.tourStopLabel } : {}),
    ...(show.artistImageUri ? { imageUri: show.artistImageUri } : {}),
    ...(show.artistPhotoAttribution ? { artistPhotoAttribution: show.artistPhotoAttribution } : {}),
    ...(seatLocation ? { seatLocation } : {}),
    authorSentence,
    accessibilityLabel,
  };
}
