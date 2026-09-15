import { artistBiographyIdentity } from "./artistBiography.mjs";

const LICENSE = "CC BY-SA 4.0";
const LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/";
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;
const wikidataId = (value) => typeof value === "string" && /^Q[1-9][0-9]{0,15}$/.test(value) ? value : null;

function wikipediaUrl(value) {
  if (typeof value !== "string" || value.length > 1600 || !value.startsWith("https://en.wikipedia.org/")
    || /[\u0000-\u0020\u007f<>"\\]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.origin !== "https://en.wikipedia.org" || url.username || url.password || url.hash) return null;
    return url;
  } catch { return null; }
}

function articleTitle(url) {
  if (!url || url.search || !url.pathname.startsWith("/wiki/")) return null;
  try {
    const title = decodeURIComponent(url.pathname.slice(6)).replace(/_/g, " ");
    return title && !/[:\u0000-\u001f\u007f<>"\\]/u.test(title) && title.trim() === title ? title : null;
  } catch { return null; }
}

function revisionUrl(value, title) {
  const url = wikipediaUrl(value);
  if (!url) return null;
  if (/^\/wiki\/Special:PermanentLink\/[1-9][0-9]{0,15}$/.test(url.pathname) && !url.search) return url.href;
  if (url.pathname !== "/w/index.php") return null;
  const keys = [...url.searchParams.keys()];
  if (!/^[1-9][0-9]{0,15}$/.test(url.searchParams.get("oldid") || "")
    || keys.some((key) => key !== "oldid" && key !== "title")
    || new Set(keys).size !== keys.length) return null;
  const revisionTitle = url.searchParams.get("title");
  return revisionTitle == null || revisionTitle.replace(/_/g, " ") === title ? url.href : null;
}

// This validates only the public, allowlisted citation. Callers must separately
// prove the displayed biography is the exact text covered by this citation.
export function validateArtistKnowledgeSource(value, { mbid } = {}) {
  const source = object(value);
  const identity = artistBiographyIdentity(mbid);
  if (!source || !identity || source.mbid !== identity || source.provider !== "wikipedia"
    || !wikidataId(source.wikidataId) || source.license !== LICENSE
    || source.licenseUrl !== LICENSE_URL || source.modified !== true) return null;
  const url = wikipediaUrl(source.url);
  const title = articleTitle(url);
  const revision = title && revisionUrl(source.revisionUrl, title);
  const retrieved = source.retrievedAt;
  const validRetrieved = Number.isSafeInteger(retrieved) && retrieved >= 0;
  if (!title || !revision || !validRetrieved) return null;
  return Object.freeze({ provider: "wikipedia", url: url.href, revisionUrl: revision,
    license: LICENSE, licenseUrl: LICENSE_URL, modified: true, mbid: identity,
    wikidataId: source.wikidataId, retrievedAt: retrieved });
}

// Stored provider data is never copied to the public API. In particular a later
// staff/owner rewrite, or a corrected MusicBrainz identity, must not inherit the
// old import's attribution simply because that record is still retained.
export function projectArtistKnowledgeSource(data, { mbid, bio } = {}) {
  const knowledge = object(object(data)?.artistKnowledge);
  const identity = artistBiographyIdentity(mbid);
  if (!knowledge || knowledge.version !== 1 || !identity || knowledge.mbid !== identity
    || !wikidataId(knowledge.wikidataId)
    || knowledge.wikidataUrl !== `https://www.wikidata.org/wiki/${knowledge.wikidataId}`
    || typeof bio !== "string" || !bio.trim() || knowledge.bio !== bio) return null;
  const source = validateArtistKnowledgeSource(knowledge.bioSource, { mbid: identity });
  return source?.wikidataId === knowledge.wikidataId ? source : null;
}

// Once text is recognized as an automatic import, invalidated provenance must
// hide the text as well as its citation. An identity correction must not leave
// another artist's imported biography displayed without attribution.
export function artistKnowledgeDisplayBio(data, { mbid, bio } = {}) {
  const knowledge = object(object(data)?.artistKnowledge);
  return knowledge && typeof bio === "string" && knowledge.bio === bio
    && !projectArtistKnowledgeSource(data, { mbid, bio }) ? null : bio;
}

export function artistKnowledgeFieldIsStale(data, { mbid, field, value } = {}) {
  const knowledge = object(object(data)?.artistKnowledge);
  return ["bio", "country"].includes(field) && !!knowledge && typeof value === "string"
    && !!value.trim() && knowledge[field] === value
    && !!artistBiographyIdentity(knowledge.mbid) && knowledge.mbid !== artistBiographyIdentity(mbid);
}

export function artistKnowledgeDisplayCountry(data, { mbid, country } = {}) {
  return artistKnowledgeFieldIsStale(data, { mbid, field: "country", value: country }) ? null : country;
}

// The API has already checked the private import record. Hydrated screens still
// bind its public citation to the same artist and the exact chosen display text.
export function publicArtistKnowledgeSource(artist, { bio } = {}) {
  const meta = object(artist);
  return meta && typeof bio === "string" && !!bio.trim() && meta.bio === bio
    ? validateArtistKnowledgeSource(meta.bioSource, { mbid: meta.mbid }) : null;
}
