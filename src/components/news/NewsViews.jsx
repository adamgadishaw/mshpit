import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import Button from "../Button";
import Icon from "../Icon";
import ScreenHeader from "../ScreenHeader";
import SmartImage from "../SmartImage";
import { fetchArtistNews, fetchNews } from "../../lib/newsApi";
import { newsDateLabel, releaseAvailability, releaseTypeLabel } from "../../domain/artistNews.mjs";
import { localCalendarIso } from "../../domain/dates.mjs";
import { colors, displayFont, radius, space, CONTENT_COLUMN_MAX_WIDTH } from "../../theme";
import NewsStoryCard from "./NewsStoryCard";
import useNewsDeskStories from "./useNewsDeskStories";
import LiveEventPanel from "./LiveEventPanel";
import LiveCoverageCard from "./LiveCoverageCard";
import NewsRegionBar from "./NewsRegionBar";

// The News screen and the artist-page update rows share this lazy chunk.
// "Music news" is the Mshpit News desk: stories independent outlets confirmed.
// "Your artists" is different: new releases and tour dates from the artists
// you follow, which also arrive as notifications.

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
  // Only a card that opens something is a button.
  const Card = onOpenArtist ? Pressable : View;
  const cardProps = onOpenArtist
    ? { style: ({ pressed, hovered }) => [styles.card, hovered && styles.cardHover, pressed && styles.cardPressed], onPress: () => onOpenArtist(item.artist), accessibilityRole: "button", accessibilityLabel: `${label}. Open ${item.artist.name}.` }
    : { style: styles.card, accessible: true, accessibilityLabel: label };
  return (
    <Card {...cardProps}>
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
      {onOpenArtist ? <Icon name="chevron-right" size={16} color={colors.textFaint} /> : null}
    </Card>
  );
}

function NewsLoadError({ retained = false, more = false, onRetry }) {
  const message = more ? "Couldn't load more news. Your earlier updates are still here."
    : retained ? "Couldn't refresh news. Showing your last loaded updates."
      : "News didn't load. Check your connection and try again.";
  return <View style={styles.panel} accessibilityLiveRegion="polite">
    <Text style={styles.panelText}>{message}</Text>
    <Button small variant="secondary" title="Try again" onPress={onRetry} style={{ marginTop: space(3) }} />
  </View>;
}

// The full News screen: confirmed music news, or updates from your artists.
// `liveSlug` (from /news/live/<slug>) opens with that event's full coverage.
export function NewsScreen({ session = null, liveSlug = null, onClose, onOpenArtist, onOpenProfile, onReport, onOpenStory, onRequireAuth }) {
  const [scope, setScope] = useState("news");
  const news = useNewsDeskStories({ enabled: scope === "news", limit: 20 });
  const [state, setState] = useState({ status: "loading", items: [], cursor: null });
  const request = useRef(0);
  const followingController = useRef(null);
  const followingPending = useRef(false);
  const followingRetryMore = useRef(false);

  const load = useCallback(async ({ more = false } = {}) => {
    if (scope !== "following") return;
    if (more && (followingPending.current || !state.cursor)) return;
    followingController.current?.abort();
    const controller = new AbortController();
    followingController.current = controller;
    followingPending.current = true;
    followingRetryMore.current = false;
    const ticket = ++request.current;
    setState((current) => ({ ...current, status: more ? "more" : "loading" }));
    try {
      const result = await fetchNews({ scope, cursor: more ? state.cursor : null, signal: controller.signal });
      if (controller.signal.aborted || ticket !== request.current) return;
      setState((current) => {
        const seen = new Set(more ? current.items.map((item) => item.id) : []);
        const incoming = (result?.items || []).filter((item) => {
          if (seen.has(item.id)) return false;
          seen.add(item.id); return true;
        });
        return { status: "ready", items: more ? [...current.items, ...incoming] : incoming, cursor: result?.nextCursor || null };
      });
    } catch {
      if (!controller.signal.aborted && ticket === request.current) {
        followingRetryMore.current = more;
        setState((current) => ({ ...current, status: "error" }));
      }
    } finally {
      if (ticket === request.current) followingPending.current = false;
    }
  }, [scope, state.cursor]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    void load();
    return () => {
      request.current++;
      followingController.current?.abort();
      followingPending.current = false;
    };
  }, [scope, session?.id]);

  return (
    <View style={styles.screen} testID="news-content-shell">
      <ScreenHeader kicker="Mshpit News" title="Music news" onBack={onClose} />
      <View style={styles.tabs} accessibilityRole="tablist">
        {[["news", "Music news"], ["following", "Your artists"]].map(([id, label]) => (
          <Pressable key={id} style={[styles.tab, scope === id && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: scope === id }}
            onPress={() => { if (id === "following" && !session) { onRequireAuth?.(); return; } setScope(id); }}>
            <Text style={[styles.tabText, scope === id && styles.tabTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {scope === "news" ? (
        <ScrollView contentContainerStyle={styles.content}>
          <NewsRegionBar accountId={session?.id || null} onChanged={news.reload} />
          {liveSlug ? <LiveEventPanel slug={liveSlug} /> : <View style={{ marginBottom: space(3) }}><LiveCoverageCard /></View>}
          {news.status === "loading" && !news.stories.length ? <ActivityIndicator color={colors.amber} style={{ marginTop: space(10) }} /> : null}
          {news.status === "error" && !news.failedMore ? <NewsLoadError retained={!!news.stories.length} onRetry={news.retry} /> : null}
          {news.status === "ready" && !news.stories.length ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>No stories yet</Text>
              <Text style={styles.panelText}>New music and tour stories will appear here. Check back soon.</Text>
            </View>
          ) : null}
          {news.stories.map((story) => <NewsStoryCard key={story.id} story={story} accountId={session?.id || null} onOpen={onOpenStory} onOpenArtist={onOpenArtist} onOpenProfile={onOpenProfile} onReport={onReport} onRequireAuth={onRequireAuth} />)}
          {news.status === "error" && news.failedMore ? <NewsLoadError more onRetry={news.retry} /> : null}
          {news.nextCursor && !(news.status === "error" && news.failedMore) ? (
            <Button small variant="secondary" title="Show more" loading={news.status === "loading"} onPress={news.loadMore} style={{ alignSelf: "center", marginTop: space(2) }} />
          ) : null}
        </ScrollView>
      ) : (
      <ScrollView contentContainerStyle={styles.content}>
        {state.status === "loading" ? <ActivityIndicator color={colors.amber} style={{ marginTop: space(10) }} /> : null}
        {state.status === "error" && !followingRetryMore.current ? <NewsLoadError retained={!!state.items.length} onRetry={() => load()} /> : null}
        {state.status === "ready" && !state.items.length && !state.cursor ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Nothing new from your artists yet</Text>
            <Text style={styles.panelText}>Follow artists from their pages. New albums, singles and tour dates show up here, and you get a note when they land.</Text>
          </View>
        ) : null}
        {state.items.map((item) => <NewsCard key={item.id} item={item} onOpenArtist={onOpenArtist} />)}
        {state.status === "error" && followingRetryMore.current ? <NewsLoadError more onRetry={() => load({ more: true })} /> : null}
        {state.cursor && state.status !== "loading" && !(state.status === "error" && followingRetryMore.current) ? (
          <Button small variant="secondary" title="Show more" loading={state.status === "more"} onPress={() => load({ more: true })} style={{ alignSelf: "center", marginTop: space(2) }} />
        ) : null}
      </ScrollView>
      )}
    </View>
  );
}

// "Latest news" on an artist page, with the reason to follow right beside it.
// The artist page's news: Mshpit News stories about the artist ("In the
// news"), then their new releases and tour dates, then the reason to follow.
export function ArtistNewsSection({ artistName, artistKey = null, following = false, onFollow, onOpenStory }) {
  const [items, setItems] = useState([]);
  const headlines = useNewsDeskStories({ enabled: !!artistKey, limit: 3, artist: artistKey });
  useEffect(() => {
    if (!artistName) return undefined;
    const controller = new AbortController();
    fetchArtistNews(artistName, { signal: controller.signal })
      .then((result) => setItems(result?.items || []))
      // No news is simply no section; the rest of the page is unaffected.
      .catch(() => setItems([]));
    return () => controller.abort();
  }, [artistName]);
  const stories = artistKey ? headlines.stories : [];
  if (!items.length && !stories.length && following) return null;
  return (
    <View style={styles.section}>
      {stories.length ? (
        <>
          <Text style={styles.sectionKicker}>IN THE NEWS</Text>
          {stories.map((story) => <NewsStoryCard key={story.id} story={story} compact onOpen={onOpenStory} />)}
        </>
      ) : null}
      {items.length || !following ? <Text style={styles.sectionKicker}>NEW MUSIC AND TOUR DATES</Text> : null}
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

const styles = StyleSheet.create({
  screen: { flex: 1, minWidth: 0, width: "100%", maxWidth: CONTENT_COLUMN_MAX_WIDTH, alignSelf: "center", backgroundColor: colors.bg },
  content: { padding: space(4), paddingBottom: space(16), gap: space(3) },
  tabs: { flexDirection: "row", gap: space(2), paddingHorizontal: space(4), paddingTop: space(3) },
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
});
