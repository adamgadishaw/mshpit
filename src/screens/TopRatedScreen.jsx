import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, View, Text, StyleSheet, ScrollView, TextInput, Pressable } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore } from "../store";
import Stars from "../components/Stars";
import Icon from "../components/Icon";
import SheetHeader from "../components/SheetHeader";
import VinylRefreshBoundary from "../components/VinylRefreshBoundary";
import { refreshScope } from "../domain/scopedRefresh.mjs";
import useScopedRefresh from "../hooks/useScopedRefresh";
import {
  normalizeTopRatedShows,
  topRatedShowCities,
  topRatedShowMatchesCity,
  topRatedShowNavigation,
} from "../domain/topRatedShows.mjs";

export default function TopRatedScreen({ initialRegion = "Worldwide", onClose, onOpen }) {
  const { loadDiscoverOverview, session } = useStore();
  const requestedRegion = String(initialRegion || "Worldwide").trim() || "Worldwide";
  const loaderRef = useRef(loadDiscoverOverview);
  loaderRef.current = loadDiscoverOverview;
  const requestRef = useRef({ sequence: 0 });
  const [resource, setResource] = useState({ status: "loading", rows: [] });
  const [retryRevision, setRetryRevision] = useState(0);
  const [loc, setLoc] = useState("");

  const readTopRated = async ({ signal, force }) => {
    const sequence = requestRef.current.sequence + 1;
    requestRef.current = { sequence };
    setResource((current) => ({ status: current.rows.length ? "refreshing" : "loading", rows: current.rows }));
    try {
      const payload = await loaderRef.current({ country: requestedRegion, signal, force });
      if (signal.aborted || requestRef.current.sequence !== sequence) return { stale: true };
      const rows = normalizeTopRatedShows(payload?.topRatedShows);
      setResource({ status: "ready", rows });
      return rows;
    } catch (error) {
      if (!signal.aborted && requestRef.current.sequence === sequence) {
        setResource((current) => ({ ...current, status: "error" }));
      }
      throw error;
    }
  };
  const topRatedRefreshScope = refreshScope(session?.id, "top-rated-shows", requestedRegion);
  const { refresh: refreshTopRated, refreshing: topRatedRefreshing } = useScopedRefresh({
    scope: topRatedRefreshScope,
    task: ({ signal }) => readTopRated({ signal, force: true }),
  });

  useEffect(() => {
    setLoc("");
  }, [requestedRegion]);

  useEffect(() => {
    const controller = new AbortController();
    void readTopRated({ signal: controller.signal, force: retryRevision > 0 }).catch(() => {
      // The resource already retains visible rows and exposes its retry state.
    });
    return () => controller.abort();
    // Store actions are intentionally accessed through loaderRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedRegion, retryRevision]);

  const cityNames = useMemo(() => topRatedShowCities(resource.rows), [resource.rows]);

  // Resolve the typed location to a known city (best prefix match).
  const resolved = useMemo(() => {
    const q = loc.trim().toLowerCase();
    if (!q) return null;
    const exact = cityNames.find((city) => city.toLowerCase() === q);
    if (exact) return exact;
    const prefixMatches = cityNames.filter((city) => city.toLowerCase().startsWith(q));
    return prefixMatches.length === 1 ? prefixMatches[0] : null;
  }, [cityNames, loc]);

  const ranked = useMemo(() => (
    resolved ? resource.rows.filter((row) => topRatedShowMatchesCity(row, resolved)) : resource.rows
  ), [resolved, resource.rows]);
  const invalidCity = !!loc.trim() && !resolved;

  return (
    <View style={styles.wrap}>
      <SheetHeader title="Top-rated shows" onBack={onClose} />

      <VinylRefreshBoundary
        refreshing={topRatedRefreshing}
        onRefresh={refreshTopRated}
        accessibilityLabel="Refresh top-rated shows"
      >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={styles.h1}>{requestedRegion === "Worldwide" ? "Top-rated shows" : `Top-rated shows in ${requestedRegion}`}</Text>

        <View style={styles.locField}>
          <Icon name="pin" size={16} color={colors.amber} />
          <TextInput
            style={styles.locInput}
            value={loc}
            onChangeText={setLoc}
            placeholder="Filter by city (optional)"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="words"
            autoCorrect={false}
            editable={cityNames.length > 0}
            accessibilityLabel="City"
            accessibilityHint="Enter or choose one of the listed cities"
            aria-invalid={invalidCity}
          />
        </View>
        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Available cities">
          {cityNames.length > 0 && (
            <Pressable style={[styles.chip, !loc.trim() && styles.chipOn]} onPress={() => setLoc("")} accessibilityRole="radio" accessibilityState={{ checked: !loc.trim() }}>
              <Text style={[styles.chipTxt, !loc.trim() && styles.chipTxtOn]}>All {requestedRegion === "Worldwide" ? "cities" : requestedRegion}</Text>
            </Pressable>
          )}
          {cityNames.map((c) => (
            <Pressable key={c} style={[styles.chip, resolved === c && styles.chipOn]} onPress={() => setLoc(c)} accessibilityRole="radio" accessibilityState={{ checked: resolved === c }}>
              <Text style={[styles.chipTxt, resolved === c && styles.chipTxtOn]}>{c}</Text>
            </Pressable>
          ))}
        </View>

        {invalidCity && <Text style={styles.cityError} accessibilityRole="alert" accessibilityLiveRegion="polite">Choose a listed city. Pit will not substitute a different location.</Text>}
        {resource.status === "loading" && (
          <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel="Loading top-rated shows" accessibilityState={{ busy: true }}>
            <ActivityIndicator size="small" color={colors.amber} />
            <Text style={styles.cityHint}>Loading real community ratings…</Text>
          </View>
        )}
        {resource.status === "error" && (
          <View style={styles.errorState} accessibilityRole="alert">
            <Text style={styles.cityError}>Top-rated shows could not refresh.</Text>
            <Pressable style={styles.retry} onPress={() => setRetryRevision((value) => value + 1)} accessibilityRole="button" accessibilityLabel="Retry top-rated shows">
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        )}

        {ranked.map((s, i) => (
          <Pressable
            key={s.key}
            style={styles.row}
            accessibilityRole="button"
            accessibilityLabel={`Number ${i + 1}, ${s.artist} at ${s.venue}, ${s.avgRating.toFixed(1)} stars from ${s.ratingCount} ratings`}
            onPress={() => onOpen?.(topRatedShowNavigation(s))}
          >
            <Text style={styles.rank}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.artist}>{s.artist}</Text>
              <Text style={styles.venue}>{s.venue}{s.venueCity || s.city ? ` · ${s.venueCity || s.city}` : ""} · {s.date}</Text>
              <View style={styles.metaRow}>
                <Stars value={s.avgRating} size={12} />
                <Text style={styles.meta}>{s.avgRating.toFixed(1)} · {s.ratingCount} {s.ratingCount === 1 ? "rating" : "ratings"}{s.reviewCount ? ` · ${s.reviewCount} reviews` : ""}</Text>
              </View>
            </View>
          </Pressable>
        ))}

        {resource.status === "ready" && ranked.length === 0 && (
          <Text style={styles.empty} accessibilityLiveRegion="polite">
            {resolved
              ? `No rated concert nights are indexed for ${resolved} yet.`
              : `No real public show ratings are indexed for ${requestedRegion} yet.`}
          </Text>
        )}

        {ranked.length > 0 && (
          <Text style={styles.note}>
            Ranked from real public Mshpit ratings. Each account counts once per show, and rating confidence keeps one perfect score from overpowering a well-supported crowd result.
          </Text>
        )}
      </ScrollView>
      </VinylRefreshBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 10 },
  backBtn: { flexDirection: "row", alignItems: "center", width: 72 },
  back: { color: colors.amber, fontSize: 15 },
  topTitle: { color: colors.textFaint, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  content: { padding: 16, paddingBottom: 48 },
  h1: { color: colors.text, fontSize: 26, fontWeight: "800" },

  locField: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    marginTop: 16,
  },
  locInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12, marginBottom: 8 },
  chip: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  chipOn: { borderColor: colors.amber, backgroundColor: colors.bgElev },
  chipTxt: { color: colors.textDim, fontSize: 12 },
  chipTxtOn: { color: colors.amber, fontWeight: "700" },
  cityError: { color: colors.danger, fontSize: 12.5, lineHeight: 18, marginTop: 6 },
  cityHint: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 6 },
  loading: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 12 },
  errorState: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 10 },
  retry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber },
  retryText: { color: colors.amber, fontSize: 12, fontWeight: "800" },
  empty: { color: colors.textDim, fontSize: 13, lineHeight: 20, textAlign: "center", paddingVertical: 28 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    padding: 14,
    marginTop: 10,
  },
  rank: { color: colors.gold, fontFamily: mono, fontSize: 22, fontWeight: "800", width: 26, textAlign: "center" },
  artist: { color: colors.text, fontSize: 17, fontWeight: "700" },
  venue: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  meta: { color: colors.textFaint, fontFamily: mono, fontSize: 11 },
  note: { color: colors.textFaint, fontSize: 12, lineHeight: 18, marginTop: 18, fontStyle: "italic" },
});
