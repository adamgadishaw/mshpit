const MUSIC = /^(?:music)$/iu;
const FESTIVAL = /\b(?:festival|fest)\b/iu;
const FAIR = /\b(?:fair|exhibition|exposition)\b/iu;
const RODEO = /\brodeo\b/iu;

const line = (value, max = 180) => {
  const text = typeof value === "string" ? value.normalize("NFKC").replace(/\s+/gu, " ").trim() : "";
  return text && [...text].length <= max ? text : null;
};

function classificationLabels(value) {
  const labels = [];
  for (const classification of Array.isArray(value) ? value.slice(0, 20) : []) {
    for (const field of ["segment", "genre", "subGenre", "type", "subType"]) {
      const name = line(classification?.[field]?.name, 80);
      if (name) labels.push(name);
    }
  }
  return labels;
}

function boundedNames(values) {
  const names = [];
  const seen = new Set();
  for (const value of (Array.isArray(values) ? values : []).slice(0, 50)) {
    const name = line(typeof value === "string" ? value : value?.name, 160);
    const key = name?.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= 20) break;
  }
  return names;
}

function kindFor(name, labels, startDate, endDate) {
  const evidence = [name, ...labels].filter(Boolean).join(" ");
  if (RODEO.test(evidence)) return "rodeo";
  if (FAIR.test(evidence)) return "fair";
  if (FESTIVAL.test(evidence)) return "festival";
  if (startDate && endDate && endDate > startDate) return "multi_day";
  return "concert";
}

export function ticketmasterMusicEvent(event, { requestedArtist = null } = {}) {
  if (!event || typeof event !== "object") return null;
  const labels = classificationLabels(event.classifications);
  const billedArtists = boundedNames(event._embedded?.attractions);
  const primarySegment = line(event.classifications?.[0]?.segment?.name, 80);
  const providerMusicClassification = Boolean(primarySegment && MUSIC.test(primarySegment));
  const explicitNonMusicSegment = Boolean(primarySegment && !providerMusicClassification);
  const requested = line(requestedArtist, 160)?.toLowerCase() || null;
  const requestedArtistMatch = requested
    ? billedArtists.some((name) => name.toLowerCase() === requested)
    : false;
  // City/country discovery fails closed on the response's explicit taxonomy.
  // Artist-specific lookup may recover a missing provider classification only
  // when the returned billing exactly matches the requested artist.
  if (!providerMusicClassification && (!requestedArtistMatch || explicitNonMusicSegment)) return null;
  const startDate = line(event.dates?.start?.localDate, 10);
  const endDate = line(event.dates?.end?.localDate, 10);
  return Object.freeze({
    kind: kindFor(line(event.name), labels, startDate, endDate),
    evidence: providerMusicClassification
      ? "ticketmaster:classification:music"
      : "ticketmaster:artist-search:matched-attraction",
    billedArtists,
    endDate: endDate && /^\d{4}-\d{2}-\d{2}$/u.test(endDate) && endDate >= startDate ? endDate : null,
  });
}

export function bandsintownMusicEvent(event, { requestedArtist = null } = {}) {
  if (!event || typeof event !== "object") return null;
  const billedArtists = boundedNames([
    requestedArtist,
    ...(Array.isArray(event.lineup) ? event.lineup : []),
    event.artist,
  ]);
  if (!billedArtists.length) return null;
  return Object.freeze({
    kind: kindFor(line(event.title), [], line(event.datetime)?.slice(0, 10), null),
    evidence: "bandsintown:billed-lineup",
    billedArtists,
    endDate: null,
  });
}
