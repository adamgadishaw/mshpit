import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import Button from "../Button";
import Icon from "../Icon";
import ScreenHeader from "../ScreenHeader";
import SmartImage from "../SmartImage";
import { fetchArtistNews, fetchNews } from "../../lib/newsApi";
import { newsDateLabel, releaseAvailability, releaseTypeLabel } from "../../domain/artistNews.mjs";
import { localCalendarIso } from "../../domain/dates.mjs";
import { colors, displayFont, radius, space } from "../../theme";

// Every news view lives in this one module so the screens that show news
// (the News screen, artist pages, Discover) share a single lazy chunk and
// nothing is added to the first page load.

function openListen(url) {
  if (!/^https:\/\//u.test(String(url || ""))) return;
  // architecture: allow-ambiguous-result -- opening a store page is best effort and nothing waits on it
  Linking.openURL(url).catch(() => null);
}

function datesLine(dates) {
  const shown = dates.slice(0, 3).map((item) => `${newsDateLabel(item.date, { withYear: false })}${item.city ? ` ${item.city}` : ""}`);
  return `${shown.join(" · ")}${dates.length > 3 ? ` +${dates.length - 3}` : ""}`;
}

export function NewsCard({ item, onOpenArtist, showArtist = true }) {
  const today = localCalendarIso();
  const release = item.release;
  const kicker = release
    ? `New ${releaseTypeLabel(release.type)} · ${releaseAvailability(release.releaseDate, today) || newsDateLabel(release.releaseDate)}`
    : item.title;
  const label = release
    ? `${item.artist.name}, new ${releaseTypeLabel(release.type)}: ${release.title}`
    : `${item.artist.name}: ${item.title}`;
  return (
    <Pressable style={({ pressed, hovered }) => [styles.card, hovered && styles.cardHover, pressed && styles.cardPressed]}
      onPress={() => onOpenArtist?.(item.artist)} accessibilityRole="button" accessibilityLabel={`${label}. Open ${item.artist.name}.`}>
      <View style={styles.art}>
        {release?.cover ? (
          <SmartImage uri={release.cover} style={StyleSheet.absoluteFill} contain={false} accessibilityLabel={`${release.title} cover art`} accessible={false} />
        ) : (
          <View style={styles.artBlank}>
            <Icon name={release ? "music" : "calendar"} size={22} color={colors.amber} />
            {!release ? <Text style={styles.artCount}>{item.shows.count}</Text> : null}
          </View>
        )}
      </View>
      <View style={styles.body}>
        <Text style={styles.kicker} numberOfLines={1}>{kicker.toUpperCase()}</Text>
        {showArtist ? <Text style={styles.artist} numberOfLines={1}>{item.artist.name}</Text> : null}
        <Text style={styles.detail} numberOfLines={2}>{release ? release.title : datesLine(item.shows.dates)}</Text>
        {release?.url ? (
          <Pressable onPress={() => openListen(release.url)} hitSlop={8} accessibilityRole="link" accessibilityLabel={`Listen to ${release.title} on Deezer`}>
            <Text style={styles.listen}>Listen on Deezer</Text>
          </Pressable>
        ) : null}
      </View>
      <Icon name="chevron-right" size={16} color={colors.textFaint} />
    </Pressable>
  );
}

// The full News screen: everyone's news, or just the artists you follow.
export function NewsScreen({ session = null, onClose, onOpenArtist, onRequireAuth }) {
  const [scope, setScope] = useState("all");
  const [state, setState] = useState({ status: "loading", items: [], cursor: null });
  const request = useRef(0);

  const load = useCallback(async ({ more = false } = {}) => {
    const ticket = ++request.current;
    setState((current) => ({ ...current, status: more ? "more" : "loading", ...(more ? {} : { items: [] }) }));
    try {
      const result = await fetchNews({ scope, cursor: more ? state.cursor : null });
      if (ticket !== request.current) return;
      setState((current) => ({ status: "ready", items: more ? [...current.items, ...(result?.items || [])] : result?.items || [], cursor: result?.nextCursor || null }));
    } catch {
      if (ticket === request.current) setState((current) => ({ ...current, status: "error" }));
    }
  }, [scope, state.cursor]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [scope, session?.id]);

  return (
    <View style={styles.screen}>
      <ScreenHeader kicker="News" title="New music & tour dates" onBack={onClose} />
      <View style={styles.tabs} accessibilityRole="tablist">
        {[["all", "Everyone"], ["following", "Artists you follow"]].map(([id, label]) => (
          <Pressable key={id} style={[styles.tab, scope === id && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: scope === id }}
            onPress={() => { if (id === "following" && !session) { onRequireAuth?.(); return; } setScope(id); }}>
            <Text style={[styles.tabText, scope === id && styles.tabTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {state.status === "loading" ? <ActivityIndicator color={colors.amber} style={{ marginTop: space(10) }} /> : null}
        {state.status === "error" ? (
          <View style={styles.panel}>
            <Text style={styles.panelText}>News didn't load. Check your connection and try again.</Text>
            <Button small variant="secondary" title="Try again" onPress={() => load()} style={{ marginTop: space(3) }} />
          </View>
        ) : null}
        {state.status === "ready" && !state.items.length ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>{scope === "following" ? "Nothing new from your artists yet" : "No news yet"}</Text>
            <Text style={styles.panelText}>{scope === "following"
              ? "Follow artists from their pages. New albums, singles and tour dates show up here, and you get a note when they land."
              : "New releases and tour dates appear here as artists announce them."}</Text>
          </View>
        ) : null}
        {state.items.map((item) => <NewsCard key={item.id} item={item} onOpenArtist={onOpenArtist} />)}
        {state.cursor && state.items.length ? (
          <Button small variant="secondary" title="Show more" loading={state.status === "more"} onPress={() => load({ more: true })} style={{ alignSelf: "center", marginTop: space(2) }} />
        ) : null}
      </ScrollView>
    </View>
  );
}

// "Latest news" on an artist page, with the reason to follow right beside it.
export function ArtistNewsSection({ artistName, following = false, onFollow }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!artistName) return undefined;
    const controller = new AbortController();
    fetchArtistNews(artistName, { signal: controller.signal })
      .then((result) => setItems(result?.items || []))
      // No news is simply no section; the rest of the page is unaffected.
      .catch(() => setItems([]));
    return () => controller.abort();
  }, [artistName]);
  if (!items.length && following) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionKicker}>LATEST NEWS</Text>
      {items.map((item) => <NewsCard key={item.id} item={item} showArtist={false} />)}
      {!following && onFollow ? (
        <View style={styles.followRow}>
          <Icon name="bell" size={16} color={colors.amber} />
          <Text style={styles.followText}>Follow {artistName} to hear first about new music and tour dates.</Text>
          <Button small title="Follow" onPress={onFollow} />
        </View>
      ) : null}
    </View>
  );
}

// A small "New this week" strip for Discover.
export function NewsStrip({ onOpenNews, onOpenArtist }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const controller = new AbortController();
    fetchNews({ limit: 3, signal: controller.signal })
      .then((result) => setItems(result?.items || []))
      .catch(() => setItems([]));
    return () => controller.abort();
  }, []);
  if (!items.length) return null;
  return (
    <View style={styles.strip}>
      <View style={styles.stripHead}>
        <Text style={styles.stripTitle}>New this week</Text>
        <Pressable onPress={onOpenNews} hitSlop={8} accessibilityRole="button" accessibilityLabel="Open all music news">
          <Text style={styles.link}>All news</Text>
        </Pressable>
      </View>
      {items.map((item) => <NewsCard key={item.id} item={item} onOpenArtist={onOpenArtist} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), paddingBottom: space(16), gap: space(3), width: "100%", maxWidth: 680, alignSelf: "center" },
  tabs: { flexDirection: "row", gap: space(2), paddingHorizontal: space(4), paddingTop: space(3), width: "100%", maxWidth: 680, alignSelf: "center" },
  tab: { flex: 1, minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  tabOn: { backgroundColor: colors.surfaceAlt, borderColor: colors.line },
  tabText: { color: colors.textDim, fontWeight: "700", fontSize: 13.5 },
  tabTextOn: { color: colors.text },
  card: { flexDirection: "row", alignItems: "center", gap: space(3), padding: space(3), borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  cardHover: { borderColor: colors.line },
  cardPressed: { opacity: 0.85 },
  art: { width: 64, height: 64, borderRadius: radius.sm, overflow: "hidden", backgroundColor: colors.surfaceAlt },
  artBlank: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2 },
  artCount: { color: colors.text, fontFamily: displayFont, fontWeight: "800", fontSize: 13 },
  body: { flex: 1, gap: 2 },
  kicker: { color: colors.amber, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  artist: { color: colors.text, fontFamily: displayFont, fontSize: 16, fontWeight: "800" },
  detail: { color: colors.textDim, fontSize: 13.5, lineHeight: 19 },
  listen: { color: colors.amber, fontSize: 12.5, fontWeight: "700", marginTop: 2 },
  panel: { padding: space(4), borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  panelTitle: { color: colors.text, fontSize: 16, fontWeight: "800", marginBottom: space(1) },
  panelText: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
  section: { gap: space(2), marginTop: space(4) },
  sectionKicker: { color: colors.textFaint, fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  followRow: { flexDirection: "row", alignItems: "center", gap: space(3), padding: space(3), borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev },
  followText: { flex: 1, color: colors.textDim, fontSize: 13.5, lineHeight: 19 },
  strip: { gap: space(2), marginBottom: space(4) },
  stripHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stripTitle: { color: colors.text, fontFamily: displayFont, fontSize: 18, fontWeight: "800" },
  link: { color: colors.amber, fontWeight: "700", fontSize: 13 },
});
