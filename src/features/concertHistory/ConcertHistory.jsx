import { Component, Suspense, lazy, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, focusRing, mono, radius, shadow, space } from "../../theme";
import Icon from "../../components/Icon";
import SmartImage from "../../components/SmartImage";
import { formatDate } from "../../domain/dates.mjs";
import { concertCoordinates, concertHistoryModel, concertHistorySummary } from "./concertHistoryModel.mjs";

const ProfileConcertMap = lazy(() => import("./ProfileConcertMap"));
const PAGE_SIZE = 20;
const EMPTY = Object.freeze([]);

class HistoryMapBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <View style={styles.mapFallback}><Icon name="map" color={colors.textFaint} /><Text style={styles.hint}>The map is unavailable. Every concert is still in the list.</Text></View> : this.props.children;
  }
}

function HistoryButton({ label, onPress, disabled = false, icon, expanded, style }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, ...(typeof expanded === "boolean" ? { expanded } : {}) }} {...(Platform.OS === "web" && typeof expanded === "boolean" ? { "aria-expanded": expanded } : {})} onPress={onPress} disabled={disabled} style={({ pressed, focused }) => [styles.button, style, focused && focusRing, pressed && styles.pressed, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text>{icon ? <Icon name={icon} size={15} color={colors.amber} /> : null}</Pressable>;
}

function ConcertRow({ concert, selected, onSelect, onOpen, opening }) {
  const date = formatDate(concert.date, "Date not recorded");
  const openLabel = concert.postId ? "Open review" : "Open show";
  const hasRating = typeof concert.rating === "number" && Number.isFinite(concert.rating) && concert.rating >= 0 && concert.rating <= 5;
  const coordinates = concertCoordinates(concert);
  return <View style={[styles.row, selected && styles.selectedRow]} testID={`concert-history-row-${concert.id}`}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${concert.artist || "Artist not recorded"}, ${concert.venue || "Venue not recorded"}, ${date}. Select concert on map.`} accessibilityState={{ selected }} {...(Platform.OS === "web" ? { "aria-pressed": selected } : {})} onPress={onSelect} onHoverIn={onSelect} onFocus={onSelect} style={({ pressed, focused }) => [styles.rowMain, focused && focusRing, pressed && styles.pressed]}>
      <View style={styles.thumbnail}>{concert.photo ? <SmartImage uri={concert.photo} mediaKind="image" style={StyleSheet.absoluteFill} contain={false} previewWidth={144} accessible={false} /> : <Icon name="ticket" size={22} color={colors.amber} />}</View>
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={styles.artist}>{concert.artist || "Artist not recorded"}</Text>
        <Text numberOfLines={1} style={styles.venue}>{concert.venue || "Venue not recorded"}{concert.city ? ` · ${concert.city}` : ""}</Text>
        <View style={styles.rowMeta}><Text style={styles.date}>{date}</Text>{hasRating ? <View style={styles.rating}><Icon name="star" size={11} color={colors.gold} filled /><Text style={styles.ratingText}>{concert.rating.toFixed(1)}</Text></View> : null}</View>
        {!coordinates || coordinates.precision === "city" ? <Text style={styles.locationHint}>{coordinates ? "Approximate city location" : "Location not mapped"}</Text> : null}
      </View>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`${opening ? "Opening" : `${openLabel} for`} ${concert.artist || "concert"} at ${concert.venue || "unknown venue"}`} accessibilityState={{ disabled: opening || !onOpen, busy: opening }} disabled={opening || !onOpen} onPress={onOpen} style={({ pressed, focused }) => [styles.openReview, focused && focusRing, pressed && styles.pressed, opening && styles.disabled]}>
      {opening ? <ActivityIndicator size="small" color={colors.amber} /> : <Icon name="chevron-right" size={17} color={colors.amber} />}
      <Text style={styles.openReviewText}>{opening ? "Opening…" : openLabel}</Text>
    </Pressable>
  </View>;
}

export default function ConcertHistory({ concerts = EMPTY, status = "loading", complete = false, loadingMore = false, error = null, onRetry, onLoadMore, onOpenConcert, mapVisible = true, openingId = null, openingError = "" }) {
  const [width, setWidth] = useState(0), [expanded, setExpanded] = useState(false), [limit, setLimit] = useState(PAGE_SIZE);
  const [selection, setSelection] = useState({ venueKey: null, concertId: null, filter: false });
  const model = useMemo(() => concertHistoryModel(concerts), [concerts]);
  const desktop = width >= 680;
  const selectedVenue = model.venues.find((venue) => venue.key === selection.venueKey);
  const filtered = selection.filter && selectedVenue ? selectedVenue.concerts : model.concerts;
  const previewCount = desktop ? 5 : 3;
  const visible = filtered.slice(0, expanded ? limit : previewCount);
  const hasLocalMore = visible.length < filtered.length;
  const hasRemoteMore = !complete;
  const loading = status === "loading" && !model.concertCount;
  const selectRow = (concert) => setSelection((current) => ({ ...current, venueKey: concert.venueIdentity, concertId: concert.id }));
  const selectVenue = (venueKey) => { setSelection({ venueKey, concertId: null, filter: true }); setExpanded(false); setLimit(PAGE_SIZE); };
  const loadMore = () => {
    setLimit((value) => value + PAGE_SIZE);
    if (!hasLocalMore && !loadingMore) onLoadMore?.();
  };
  const expand = () => {
    setExpanded(true);
    if (filtered.length <= previewCount && !complete && !loadingMore) onLoadMore?.();
  };
  return (
    <View testID="profile-concert-history" style={styles.ticket} onLayout={(event) => { const next = event.nativeEvent.layout.width; if (next > 0) setWidth(next); }}>
      <View style={styles.heading}>
        <View style={styles.headingIcon}><Icon name="ticket" size={23} color={colors.amber} /></View>
        <View style={styles.headingText}><Text style={styles.eyebrow}>THE LIVE ARCHIVE</Text><Text style={styles.title} accessibilityRole="header">Concert history</Text><Text style={styles.subheading}>Logged nights, place by place.</Text></View>
        <View style={styles.countStamp}><Text style={styles.count}>{model.concertCount.toLocaleString("en")}{complete ? "" : "+"}</Text><Text style={styles.countLabel}>LOGGED</Text></View>
      </View>
      <View style={styles.tearLine} />
      <Text selectable style={styles.summary}>{loading ? "Loading concert history…" : concertHistorySummary(model, complete)}</Text>
      <View style={[styles.body, desktop && mapVisible && styles.bodyWide]}>
        {mapVisible ? <View style={[styles.mapColumn, desktop && styles.mapColumnWide]}><HistoryMapBoundary><Suspense fallback={<View style={styles.mapFallback}><ActivityIndicator size="small" color={colors.amber} /><Text style={styles.hint}>Loading the concert map…</Text></View>}><ProfileConcertMap model={model} selectedVenueKey={selectedVenue?.key || null} compact={!desktop} onSelectVenue={selectVenue} onPreviewVenue={selectVenue} /></Suspense></HistoryMapBoundary></View> : null}
        <View style={styles.listColumn}>
          <View style={styles.listHeading}><Text style={styles.listTitle}>{selection.filter && selectedVenue ? "AT THIS VENUE" : "RECENT CONCERTS"}</Text>{selection.filter ? <HistoryButton label="All concerts" onPress={() => setSelection((current) => ({ ...current, filter: false }))} /> : null}</View>
          {selectedVenue ? <View style={styles.selectionDetail} accessibilityLiveRegion="polite"><Icon name="pin" size={14} color={colors.amber} /><View style={styles.selectionText}><Text style={styles.selectionTitle}>{selectedVenue.name}</Text><Text style={styles.hint}>{selectedVenue.concerts.length} logged {selectedVenue.concerts.length === 1 ? "concert" : "concerts"}{selectedVenue.city ? ` · ${selectedVenue.city}` : ""}{selectedVenue.coordinates?.precision === "city" ? " · approximate city location" : ""}</Text></View>{!selection.filter ? <HistoryButton label="View here" onPress={() => selectVenue(selectedVenue.key)} /> : null}</View> : null}
          {openingError ? <Text selectable accessibilityRole="alert" style={styles.error}>{openingError}</Text> : null}
          {status === "error" ? <View style={styles.feedback} accessibilityLiveRegion="polite"><Text selectable style={styles.error}>{typeof error === "string" && error ? error : "Concert history could not be loaded. Your saved concerts have not changed."}</Text>{onRetry ? <HistoryButton label="Retry concert history" onPress={onRetry} /> : null}</View> : null}
          {loading ? <View style={styles.feedback} accessibilityLiveRegion="polite"><ActivityIndicator size="small" color={colors.amber} /><Text style={styles.hint}>Finding logged concerts…</Text></View> : null}
          {!loading && status !== "error" && !model.concertCount ? <View style={styles.empty}><Icon name="ticket" size={27} color={colors.textFaint} /><Text style={styles.emptyTitle}>{complete ? "No concerts logged yet" : "No concerts in this part of the history"}</Text><Text style={styles.hint}>{complete ? "Concert reviews will appear here with their dates and venues." : "Load more history to check for older concert logs."}</Text></View> : null}
          <View style={styles.rows}>{visible.map((concert) => <ConcertRow key={concert.id} concert={concert} selected={concert.id === selection.concertId || !selection.concertId && concert.venueIdentity === selection.venueKey} onSelect={() => selectRow(concert)} onOpen={onOpenConcert ? () => onOpenConcert(concert) : undefined} opening={openingId === concert.id || !!openingId && openingId === concert.postId} />)}</View>
          {!expanded && (hasLocalMore || hasRemoteMore) && !loading && (status !== "error" || model.concertCount > 0) ? <HistoryButton label="See all concerts" icon="chevron-down" expanded={false} onPress={expand} style={styles.expandButton} /> : null}
          {expanded ? <View style={styles.listFooter}>{hasLocalMore || hasRemoteMore ? <HistoryButton label={loadingMore ? "Loading more concerts…" : "Load more concerts"} disabled={loadingMore || !hasLocalMore && !onLoadMore} onPress={loadMore} style={styles.loadMoreButton} /> : null}<HistoryButton label="See less" expanded onPress={() => { setExpanded(false); setLimit(PAGE_SIZE); }} /></View> : null}
          {selection.filter && !complete ? <Text style={styles.hint}>Venue results cover the loaded history. Load more to include older concerts.</Text> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ticket: { marginHorizontal: space(4), marginTop: space(6), borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, overflow: "hidden", ...shadow.card },
  heading: { flexDirection: "row", alignItems: "center", gap: space(3), padding: space(4) },
  headingIcon: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.bgElev, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line },
  headingText: { flex: 1, minWidth: 0, gap: space(1) },
  eyebrow: { fontSize: 9, fontFamily: mono, fontWeight: "700", color: colors.amber, letterSpacing: 1.5 },
  title: { color: colors.text, fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  subheading: { color: colors.textDim, fontSize: 12 },
  countStamp: { alignItems: "center", paddingLeft: space(3), borderLeftWidth: 1, borderLeftColor: colors.line },
  count: { color: colors.amber, fontFamily: mono, fontSize: 25, fontWeight: "800", fontVariant: ["tabular-nums"] },
  countLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 8, letterSpacing: 1 },
  tearLine: { borderTopWidth: 1, borderTopColor: colors.line, borderStyle: "dashed", marginHorizontal: space(4) },
  summary: { color: colors.textDim, fontSize: 11, lineHeight: 17, paddingHorizontal: space(4), paddingVertical: space(3) },
  body: { gap: space(3), paddingHorizontal: space(3), paddingBottom: space(3) },
  bodyWide: { flexDirection: "row", alignItems: "flex-start" },
  mapColumn: { minWidth: 0 },
  mapColumnWide: { flex: 1 },
  mapFallback: { minHeight: 272, backgroundColor: colors.bgElev, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", padding: space(4), gap: space(3) },
  listColumn: { flex: 1, minWidth: 0, gap: space(2) },
  listHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 36 },
  listTitle: { color: colors.textFaint, fontSize: 9, fontFamily: mono, letterSpacing: 1.4, fontWeight: "700" },
  selectionDetail: { flexDirection: "row", alignItems: "center", gap: space(2), padding: space(2), borderRadius: radius.sm, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line },
  selectionText: { flex: 1, minWidth: 0 },
  selectionTitle: { color: colors.text, fontSize: 12, fontWeight: "700" },
  rows: { gap: space(2) },
  row: { flexDirection: "row", alignItems: "center", borderRadius: radius.sm, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft },
  selectedRow: { borderColor: colors.amber, backgroundColor: colors.surfaceAlt },
  rowMain: { flex: 1, minWidth: 0, minHeight: 82, flexDirection: "row", alignItems: "center", padding: space(2), gap: space(2), borderRadius: radius.sm },
  thumbnail: { width: 44, height: 52, flexShrink: 0, backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, minWidth: 0, gap: space(1) },
  artist: { color: colors.text, fontSize: 13, fontWeight: "800" },
  venue: { color: colors.textDim, fontSize: 11 },
  rowMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space(2) },
  date: { color: colors.textFaint, fontSize: 9, fontFamily: mono },
  rating: { flexDirection: "row", alignItems: "center", gap: space(1) },
  ratingText: { color: colors.gold, fontFamily: mono, fontSize: 10, fontWeight: "700" },
  locationHint: { color: colors.textFaint, fontSize: 9 },
  openReview: { minWidth: 44, minHeight: 60, width: 60, alignItems: "center", justifyContent: "center", gap: space(1), padding: space(1), borderLeftWidth: 1, borderLeftColor: colors.lineSoft, borderRadius: radius.sm },
  openReviewText: { color: colors.amber, fontSize: 9, fontWeight: "700", textAlign: "center" },
  button: { minHeight: 44, minWidth: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space(2), paddingHorizontal: space(2), borderRadius: radius.sm },
  buttonText: { color: colors.amber, fontSize: 11, fontWeight: "800" },
  expandButton: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev },
  listFooter: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space(2) },
  loadMoreButton: { flexGrow: 1, borderWidth: 1, borderColor: colors.line },
  feedback: { alignItems: "flex-start", padding: space(2), gap: space(2) },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  hint: { color: colors.textDim, fontSize: 11, lineHeight: 16 },
  empty: { paddingVertical: space(5), paddingHorizontal: space(3), alignItems: "flex-start", gap: space(3) },
  emptyTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
});
