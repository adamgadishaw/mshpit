const LIMIT_MAX = 8;

const cleanText = (value, max = 200) => {
  const text = typeof value === "string" || typeof value === "number"
    ? String(value).replace(/\s+/g, " ").trim()
    : "";
  return text ? text.slice(0, max) : null;
};

const safeCount = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
};

const safeHttps = (value) => {
  const text = cleanText(value, 1_000);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    // architecture: allow-ambiguous-result -- an invalid optional public image is presentation absence; required artist identity and reason still fail closed
    return null;
  }
};

export function artistRecommendationRequest({ accountId = null, limit = 6 } = {}) {
  const scopedAccount = cleanText(accountId, 200);
  if (!scopedAccount) throw new TypeError("Artist recommendations require an account");
  const requested = Number(limit);
  const take = Number.isSafeInteger(requested) ? Math.max(1, Math.min(LIMIT_MAX, requested)) : 6;
  return {
    path: `/api/me/artist-recommendations?limit=${take}`,
    expectedAccountId: scopedAccount,
  };
}

function personFromResponse(value) {
  const id = cleanText(value?.id, 200);
  if (!id) return null;
  return Object.freeze({
    id,
    name: cleanText(value?.name, 100),
    handle: cleanText(value?.handle, 40),
    initials: cleanText(value?.initials, 8),
    avatarUri: safeHttps(value?.avatarUri),
    avatarColor: cleanText(value?.avatarColor, 40),
    verified: value?.verified === true,
    profileUpdatedAt: safeCount(value?.profileUpdatedAt),
  });
}

function recommendationFromResponse(value) {
  const key = cleanText(value?.artist?.key, 200);
  const name = cleanText(value?.artist?.name, 160);
  const reason = cleanText(value?.reason?.label, 240);
  if (!key || !name || !reason) return null;
  const nextDateValue = value?.nextDate;
  const nextDate = nextDateValue && /^\d{4}-\d{2}-\d{2}$/u.test(String(nextDateValue.date || ""))
    ? Object.freeze({
      id: cleanText(nextDateValue.id, 240),
      date: String(nextDateValue.date),
      startDateTime: cleanText(nextDateValue.startDateTime, 80),
      startLocalTime: cleanText(nextDateValue.startLocalTime, 40),
      eventName: cleanText(nextDateValue.eventName, 160),
      tourName: cleanText(nextDateValue.tourName, 160),
      venue: cleanText(nextDateValue.venue, 160),
      city: cleanText(nextDateValue.city, 120),
      country: cleanText(nextDateValue.country, 80),
    })
    : null;
  const people = (Array.isArray(value?.socialProof?.people) ? value.socialProof.people : [])
    .map(personFromResponse)
    .filter(Boolean)
    .slice(0, 3);
  const liveRating = safeCount(value?.liveRating);
  return Object.freeze({
    artist: Object.freeze({
      key,
      name,
      publicSlug: cleanText(value.artist.publicSlug, 200),
      photo: safeHttps(value.artist.photo),
      genre: cleanText(value.artist.genre, 80),
      country: cleanText(value.artist.country, 80),
    }),
    reason: Object.freeze({
      code: cleanText(value?.reason?.code, 80) || "taste",
      label: reason,
      anchorArtist: cleanText(value?.reason?.anchorArtist, 160),
      genre: cleanText(value?.reason?.genre, 80),
    }),
    liveRating: liveRating > 0 ? Math.min(5, liveRating) : null,
    reviewCount: Math.floor(safeCount(value?.reviewCount)),
    nextDate,
    socialProof: Object.freeze({
      count: Math.floor(safeCount(value?.socialProof?.count)),
      friendCount: Math.floor(safeCount(value?.socialProof?.friendCount)),
      label: cleanText(value?.socialProof?.label, 240),
      basis: cleanText(value?.socialProof?.basis, 160),
      people: Object.freeze(people),
    }),
  });
}

export function artistRecommendationsFromResponse(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Artist recommendation response must be an object");
  }
  const recommendations = (Array.isArray(payload.recommendations) ? payload.recommendations : [])
    .map(recommendationFromResponse)
    .filter(Boolean)
    .slice(0, LIMIT_MAX);
  return Object.freeze({
    recommendations: Object.freeze(recommendations),
    personalized: payload.personalized === true,
    signalCount: Math.floor(safeCount(payload.signalCount)),
  });
}
