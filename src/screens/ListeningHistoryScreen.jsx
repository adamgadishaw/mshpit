import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useStore } from "../store";
import { colors, mono, radius } from "../theme";
import ScreenHeader from "../components/ScreenHeader";
import SmartImage from "../components/SmartImage";
import Icon from "../components/Icon";
import { relativeTime } from "../domain/dates.mjs";
import {
  listeningHistoryReplayTrack,
  listeningHistoryRowKey,
  listeningHistoryScopeCopy,
  listeningHistoryViewState,
} from "../domain/listeningHistoryView.mjs";

const absoluteTime = (value) => {
  const date = new Date(Number(value));
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Time unavailable";
};

export default function ListeningHistoryScreen({ onClose, onPlay }) {
  const { session, playHistory, playHistoryAccountId, playHistoryStatus, playHistoryErrorMode, playHistoryNextCursor, loadPlayHistory } = useStore();
  const accountId = session?.id || null;
  const scoped = accountId === (playHistoryAccountId || null);
  const rows = scoped && Array.isArray(playHistory) ? playHistory : [];
  const cursor = scoped ? playHistoryNextCursor : null;
  const state = listeningHistoryViewState({ signedIn: !!session, scoped, status: playHistoryStatus, errorMode: playHistoryErrorMode, rows });
  const refresh = () => accountId && loadPlayHistory({ more: false, accountId });
  const loadOlder = () => accountId && cursor && playHistoryStatus !== "loading-more" && loadPlayHistory({ more: true, accountId });

  const refreshAction = session ? (
    <Pressable style={styles.headerAction} onPress={refresh} disabled={playHistoryStatus === "loading" || playHistoryStatus === "loading-more"} accessibilityRole="button" accessibilityLabel="Refresh listening history" accessibilityState={{ disabled: playHistoryStatus === "loading" || playHistoryStatus === "loading-more" }}>
      <Text style={styles.headerActionText}>Refresh</Text>
    </Pressable>
  ) : null;

  const renderRow = ({ item, index }) => {
    const track = listeningHistoryReplayTrack(item);
    const when = absoluteTime(item?.at);
    const relative = relativeTime(item?.at);
    const playedWhen = relative === "now" ? "played just now" : `played ${relative} ago`;
    return (
      <Pressable
        style={styles.row}
        onPress={() => track && onPlay?.(track)}
        disabled={!track || !onPlay}
        accessibilityRole="button"
        accessibilityLabel={track ? `Play ${track.title} by ${track.artist}, ${playedWhen}` : "Unavailable listening-history entry"}
        accessibilityHint={when}
        accessibilityState={{ disabled: !track || !onPlay }}
      >
        {track?.art ? <SmartImage uri={track.art} style={styles.art} contain={false} accessible={false} /> : <View style={[styles.art, styles.artEmpty]}><Icon name="music" size={18} color={colors.textFaint} /></View>}
        <View style={styles.rowCopy}>
          <Text style={styles.title} numberOfLines={1}>{track?.title || "Unavailable track"}</Text>
          <Text style={styles.artist} numberOfLines={1}>{track?.artist || "Artist unavailable"}</Text>
          <Text style={styles.when} numberOfLines={1}>{when}</Text>
        </View>
        {!!track && <View style={styles.play}><Icon name="play" size={13} color={colors.amber} /></View>}
      </Pressable>
    );
  };

  const footer = rows.length && state !== "refreshing" && state !== "refresh-error" ? (
    <View style={styles.footer}>
      {state === "loading-more" ? (
        <View style={styles.loadingLine} accessibilityLiveRegion="polite"><ActivityIndicator size="small" color={colors.amber} /><Text style={styles.stateText}>Loading older plays...</Text></View>
      ) : state === "page-error" ? (
        <View style={styles.pageError} accessibilityLiveRegion="assertive">
          <Text style={styles.errorText} selectable>Older listening history could not be loaded.</Text>
          {!!cursor && <Pressable style={styles.retry} onPress={loadOlder} accessibilityRole="button" accessibilityLabel="Retry loading older listening history"><Text style={styles.retryText}>Try again</Text></Pressable>}
        </View>
      ) : cursor ? (
        <Pressable style={styles.loadMore} onPress={loadOlder} accessibilityRole="button" accessibilityLabel="Load older listening history">
          <Text style={styles.loadMoreText}>Load older plays</Text>
          <Icon name="chevron-down" size={15} color={colors.amber} />
        </Pressable>
      ) : <Text style={styles.complete}>You have reached the end of the history currently available on Pit.</Text>}
    </View>
  ) : null;

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker="YOUR SOUND" title="Listening history" onBack={onClose} right={refreshAction} />
      {state === "signed-out" ? (
        <View style={styles.center}><Icon name="lock" size={24} color={colors.textFaint} /><Text style={styles.stateTitle}>Log in to view listening history</Text></View>
      ) : state === "loading" ? (
        <View style={styles.center} accessibilityLiveRegion="polite"><ActivityIndicator color={colors.amber} /><Text style={styles.stateText}>Loading your listening history...</Text></View>
      ) : state === "error" ? (
        <View style={styles.center} accessibilityLiveRegion="assertive">
          <Text style={styles.errorText} selectable>Your listening history could not be loaded. Check your connection and try again.</Text>
          <Pressable style={styles.retry} onPress={refresh} accessibilityRole="button" accessibilityLabel="Retry loading listening history"><Text style={styles.retryText}>Try again</Text></Pressable>
        </View>
      ) : state === "empty" ? (
        <View style={styles.center} accessibilityLiveRegion="polite"><Icon name="music" size={26} color={colors.textFaint} /><Text style={styles.stateTitle}>No plays yet</Text><Text style={styles.stateText}>Songs you play on Pit will appear here.</Text></View>
      ) : (
        <FlatList
          data={rows}
          renderItem={renderRow}
          keyExtractor={listeningHistoryRowKey}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={(
            <View>
              <Text style={styles.scope} selectable>{listeningHistoryScopeCopy(rows.length, !!cursor)}</Text>
              {state === "refreshing" && <View style={styles.refreshState} accessibilityLiveRegion="polite"><ActivityIndicator size="small" color={colors.amber} /><Text style={styles.stateText}>Refreshing history...</Text></View>}
              {state === "refresh-error" && (
                <View style={styles.refreshError} accessibilityLiveRegion="assertive">
                  <Text style={styles.errorText} selectable>Listening history could not refresh. Showing the last available window.</Text>
                  <Pressable style={styles.retry} onPress={refresh} accessibilityRole="button" accessibilityLabel="Retry refreshing listening history"><Text style={styles.retryText}>Try again</Text></Pressable>
                </View>
              )}
            </View>
          )}
          ListFooterComponent={footer}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  headerAction: { minHeight: 44, minWidth: 56, alignItems: "center", justifyContent: "center", paddingHorizontal: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line },
  headerActionText: { color: colors.amber, fontSize: 11.5, fontWeight: "800" },
  list: { width: "100%", maxWidth: 760, alignSelf: "center", padding: 16, paddingBottom: 48 },
  scope: { color: colors.textDim, fontSize: 12, lineHeight: 18, paddingBottom: 12 },
  refreshState: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 10, borderRadius: radius.md, backgroundColor: colors.bgElev },
  refreshError: { alignItems: "center", gap: 9, marginBottom: 10, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.bgElev },
  row: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12, padding: 10, marginBottom: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  art: { width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.bgElev },
  artEmpty: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line },
  rowCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 14.5, fontWeight: "800" },
  artist: { color: colors.textDim, fontSize: 12.5, marginTop: 2 },
  when: { color: colors.textFaint, fontFamily: mono, fontSize: 9.5, marginTop: 5 },
  play: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.amber },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 9, padding: 28 },
  stateTitle: { color: colors.text, fontSize: 16, fontWeight: "800", textAlign: "center" },
  stateText: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, textAlign: "center" },
  errorText: { color: colors.danger, fontSize: 12.5, lineHeight: 18, textAlign: "center" },
  retry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 16, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber },
  retryText: { color: colors.amber, fontSize: 12.5, fontWeight: "800" },
  footer: { minHeight: 72, alignItems: "center", justifyContent: "center", paddingTop: 10 },
  loadingLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  pageError: { alignItems: "center", gap: 9 },
  loadMore: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, alignSelf: "stretch", borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  loadMoreText: { color: colors.amber, fontSize: 13, fontWeight: "800" },
  complete: { color: colors.textFaint, fontSize: 11.5, lineHeight: 17, textAlign: "center" },
});
