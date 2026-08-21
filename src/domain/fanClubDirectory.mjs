const text = (value) => typeof value === "string" ? value.trim() : "";
const count = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;

const normalizedClub = (club) => {
  const artist = text(club?.artist);
  return artist ? { ...club, artist, members: count(club?.members), messages: count(club?.messages) } : null;
};

const sortClubs = (a, b) => b.members - a.members || b.messages - a.messages || a.artist.localeCompare(b.artist);

export function normalizeFanClubDirectory(rows) {
  const byArtist = new Map();
  for (const candidate of Array.isArray(rows) ? rows : []) {
    const club = normalizedClub(candidate);
    if (!club) continue;
    const key = club.artist.toLocaleLowerCase();
    const current = byArtist.get(key);
    if (!current || club.members > current.members || (club.members === current.members && club.messages > current.messages)) {
      byArtist.set(key, club);
    }
  }
  return [...byArtist.values()].sort(sortClubs);
}

export function applyFanClubMembership(rows, { artist, joined, wasMember } = {}) {
  const name = text(artist);
  if (!name || joined === wasMember) return normalizeFanClubDirectory(rows);
  const key = name.toLocaleLowerCase();
  const next = normalizeFanClubDirectory(rows);
  const index = next.findIndex((club) => club.artist.toLocaleLowerCase() === key);
  const current = index >= 0 ? next[index] : { artist: name, members: 0, messages: 0 };
  const updated = { ...current, members: Math.max(0, current.members + (joined ? 1 : -1)) };
  if (index >= 0) next[index] = updated;
  else next.push(updated);
  return next.filter((club) => club.members > 0 || club.messages > 0).sort(sortClubs);
}

// The directory is public, but a request still belongs to the app identity that
// initiated it. This prevents a slow guest/account-A snapshot from overwriting a
// refresh started after login, logout, or account switching.
export function createFanClubDirectoryReadCoordinator() {
  let epoch = 0;
  let sequence = 0;
  const scope = (accountId) => typeof accountId === "string" && accountId ? accountId : null;
  return {
    claim(accountId) {
      return { epoch, sequence: ++sequence, accountId: scope(accountId) };
    },
    isCurrent(claim, accountId) {
      return !!claim
        && claim.epoch === epoch
        && claim.sequence === sequence
        && claim.accountId === scope(accountId);
    },
    reset() {
      epoch += 1;
      sequence = 0;
    },
  };
}

// The active rows are intentionally supplied on every render. Join/leave
// changes therefore replace the snapshot instead of getting trapped in a
// mount-only memo, while catalog artists remain available as zero-member clubs.
export function fanClubSearchResults(activeRows, artistRows, query, limit = 40) {
  const needle = text(query).toLocaleLowerCase();
  if (!needle) return [];
  const maximum = Number.isFinite(Number(limit)) ? Math.max(0, Math.min(100, Math.trunc(Number(limit)))) : 40;
  if (!maximum) return [];
  const seen = new Set();
  const results = [];

  for (const candidate of Array.isArray(activeRows) ? activeRows : []) {
    const club = normalizedClub(candidate);
    const identity = club?.artist.toLocaleLowerCase();
    if (!club || !identity.includes(needle) || seen.has(identity)) continue;
    seen.add(identity);
    results.push(club);
    if (results.length >= maximum) return results;
  }

  for (const candidate of Array.isArray(artistRows) ? artistRows : []) {
    const artist = text(candidate?.name);
    const identity = artist.toLocaleLowerCase();
    if (!artist || !identity.includes(needle) || seen.has(identity)) continue;
    seen.add(identity);
    results.push({ artist, members: 0, messages: 0 });
    if (results.length >= maximum) break;
  }
  return results;
}
