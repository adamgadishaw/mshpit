const text = (value) => typeof value === "string" ? value.trim() : "";
const finiteCount = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const optionalCount = (value) => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Math.max(0, Number(value));

const boundedLimit = (value, fallback, maximum) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(maximum, Math.trunc(parsed))) : fallback;
};

export function normalizeDiscoverArtistRows(rows, limit = 60) {
  const maximum = boundedLimit(limit, 60, 60);
  const normalized = [];
  const seen = new Set();
  for (const candidate of Array.isArray(rows) ? rows : []) {
    if (!candidate || typeof candidate !== "object") continue;
    const name = text(candidate.name).slice(0, 120);
    const identity = name.toLocaleLowerCase();
    if (!name || seen.has(identity)) continue;
    seen.add(identity);
    const topTrack = candidate.topTrack && typeof candidate.topTrack === "object" && text(candidate.topTrack.title)
      ? { ...candidate.topTrack, title: text(candidate.topTrack.title).slice(0, 200) }
      : null;
    normalized.push({
      ...candidate,
      name,
      genre: text(candidate.genre).slice(0, 60) || null,
      country: text(candidate.country).slice(0, 60) || null,
      topTrack,
    });
    if (normalized.length >= maximum) break;
  }
  return normalized;
}

export function normalizeFriendsListening(rows, limit = 20) {
  const maximum = boundedLimit(limit, 20, 30);
  const normalized = [];
  const seen = new Set();
  for (const candidate of Array.isArray(rows) ? rows : []) {
    const user = candidate?.user;
    const track = candidate?.track;
    const id = text(user?.id).slice(0, 160);
    const title = text(track?.title).slice(0, 200);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    normalized.push({
      ...candidate,
      user: {
        ...user,
        id,
        name: text(user?.name).slice(0, 120) || text(user?.handle).slice(0, 80) || "Pit member",
      },
      track: {
        ...track,
        title,
        artist: text(track?.artist).slice(0, 120) || "Unknown artist",
      },
    });
    if (normalized.length >= maximum) break;
  }
  return normalized;
}

export function selectDiscoverPhotos(feed, { removedIds = [], blockedIds = [], limit = 10 } = {}) {
  const maximum = boundedLimit(limit, 10, 30);
  if (!maximum) return [];
  const removed = new Set(Array.isArray(removedIds) ? removedIds.map(String) : []);
  const blocked = new Set(Array.isArray(blockedIds) ? blockedIds.map(String) : []);
  const selected = [];
  const seen = new Set();
  let order = 0;
  for (const post of (Array.isArray(feed) ? feed : []).slice(0, 1000)) {
    if (!post || removed.has(String(post.id)) || (post.userId && blocked.has(String(post.userId)))) continue;
    for (const candidate of (Array.isArray(post.photos) ? post.photos : []).slice(0, 20)) {
      const uri = text(candidate);
      const identity = `${String(post.id || "")}:${uri}`;
      if (!uri || seen.has(identity)) continue;
      seen.add(identity);
      selected.push({
        uri,
        artist: text(post.artist).slice(0, 120) || null,
        venue: text(post.venue).slice(0, 160) || null,
        by: text(post.user?.name).slice(0, 120),
        likes: finiteCount(post.likes),
        logId: post.id || null,
        ownerId: post.userId || null,
        _order: order++,
      });
    }
  }
  return selected
    .sort((left, right) => right.likes - left.likes || left._order - right._order)
    .slice(0, maximum)
    .map(({ _order, ...photo }) => photo);
}

export function normalizeDiscoverOverview(payload, requestedSource = "popularity") {
  const chart = payload?.chart && typeof payload.chart === "object" ? payload.chart : {};
  const declaredSource = chart.source === "plays" || chart.source === "popularity"
    ? chart.source
    : payload?.source === "plays" || payload?.source === "popularity"
      ? payload.source
      : null;
  const source = declaredSource || (requestedSource === "plays" ? "plays" : "popularity");
  const genreRows = new Map();
  for (const row of (Array.isArray(payload?.genres) ? payload.genres : []).slice(0, 100)) {
    const genre = text(row?.genre).slice(0, 60);
    const identity = genre.toLocaleLowerCase();
    if (!genre || !identity) continue;
    const existing = genreRows.get(identity);
    if (existing) {
      existing.count += finiteCount(row.count);
      existing.pct = Math.min(1, existing.pct + Math.min(1, Math.max(0, Number(row.pct) || 0)));
    } else {
      genreRows.set(identity, {
        ...row,
        genre,
        count: finiteCount(row.count),
        pct: Math.min(1, Math.max(0, Number(row.pct) || 0)),
      });
    }
  }
  return {
    chart: {
      rows: normalizeDiscoverArtistRows(chart.rows),
      source,
      label: text(chart.label || payload?.label) || (source === "plays" ? "Most played on Pit" : "By popularity"),
      live: chart.live !== false && payload?.live !== false,
    },
    genres: [...genreRows.values()].slice(0, 13),
    genreTotal: finiteCount(payload?.genreTotal ?? payload?.total),
    distinctGenres: optionalCount(payload?.distinctGenres),
    catalogTotal: optionalCount(payload?.catalogTotal),
    memberTotal: optionalCount(payload?.memberTotal),
    countries: (Array.isArray(payload?.countries) ? payload.countries : [])
      .filter((row) => text(row?.country) && text(row.country) !== "Worldwide")
      .map((row) => ({ country: text(row.country), count: finiteCount(row.count) })),
  };
}

export function orderDiscoverCountries(countries, homeCountry, limit = 12) {
  const source = Array.isArray(countries) ? countries : [];
  const home = text(homeCountry);
  const ordered = [{ country: "Worldwide", count: null }];
  const homeRow = source.find((row) => text(row?.country).toLocaleLowerCase() === home.toLocaleLowerCase());
  if (home) ordered.push(homeRow || { country: home, count: null });
  ordered.push(...source.filter((row) => text(row?.country).toLocaleLowerCase() !== home.toLocaleLowerCase()));
  const seen = new Set();
  return ordered.filter((row) => {
    const country = text(row?.country);
    const identity = country.toLocaleLowerCase();
    if (!country || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).slice(0, Math.max(1, limit));
}

export function filterDiscoverRows(rows, query) {
  const source = Array.isArray(rows) ? rows : [];
  const needle = text(query).toLocaleLowerCase();
  if (!needle) return source;
  return source.filter((row) => [row?.name, row?.genre, row?.country, row?.topTrack?.title]
    .some((value) => text(value).toLocaleLowerCase().includes(needle)));
}

export function discoverSectionState({ status, rows, query = "" } = {}) {
  if ((status === "loading" || status === "idle" || status === "refreshing") && !(Array.isArray(rows) && rows.length)) return "loading";
  if (status === "error" && !(Array.isArray(rows) && rows.length)) return "error";
  if (text(query) && !(Array.isArray(rows) && rows.length)) return "no-results";
  if (!(Array.isArray(rows) && rows.length)) return "empty";
  return "ready";
}

export function hasDiscoverOverviewContent(overview) {
  return !!(
    (Array.isArray(overview?.chart?.rows) && overview.chart.rows.length)
    || (Array.isArray(overview?.genres) && overview.genres.length)
    || finiteCount(overview?.genreTotal) > 0
  );
}

export function cancelDiscoverRequest(active) {
  active?.controller?.abort?.();
  const sequence = Number.isSafeInteger(active?.sequence) ? active.sequence : 0;
  return { sequence: sequence + 1, controller: null };
}

export function isCurrentDiscoverAccountRequest(active, sequence, accountId) {
  return active?.sequence === sequence && String(active?.accountId || "") === String(accountId || "");
}

export function compactDiscoverNumber(value) {
  const count = finiteCount(value);
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 100_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(count);
}
