import { accountTargetScope } from "./screenScope.mjs";

export const MAX_FOLLOWED_ARTISTS = 50;

const cleanArtistName = (value) => String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
const artistIdentity = (value) => cleanArtistName(value).toLocaleLowerCase();

const uniqueArtistNames = (values, limit = MAX_FOLLOWED_ARTISTS) => {
  const names = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const name = cleanArtistName(value);
    const identity = artistIdentity(name);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    names.push(name);
    if (names.length >= limit) break;
  }
  return names;
};

export function artistFollowScope(accountId, { artistKey = null, name = null } = {}) {
  const identity = artistIdentity(artistKey) || artistIdentity(name);
  return accountTargetScope(accountId, `artist-follow:${identity}`);
}

export function isArtistFollowed(values, name) {
  const target = artistIdentity(name);
  return !!target && (Array.isArray(values) ? values : []).some((value) => artistIdentity(value) === target);
}

export function nextArtistFollowSelection(values, name, { following, limit = MAX_FOLLOWED_ARTISTS } = {}) {
  const targetName = cleanArtistName(name);
  const target = artistIdentity(targetName);
  const artists = uniqueArtistNames(values, limit);
  const alreadyFollowing = !!target && artists.some((value) => artistIdentity(value) === target);

  if (!target) return { artists, changed: false, limitReached: false };
  if (!following) {
    const next = artists.filter((value) => artistIdentity(value) !== target);
    return { artists: next, changed: next.length !== artists.length, limitReached: false };
  }
  if (alreadyFollowing) return { artists, changed: false, limitReached: false };
  if (artists.length >= limit) return { artists, changed: false, limitReached: true };
  return { artists: [...artists, targetName], changed: true, limitReached: false };
}

export function shouldOfferFanClubInvite({ followSucceeded = false, following = false, member = false } = {}) {
  return !!followSucceeded && !!following && !member;
}
