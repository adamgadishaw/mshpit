import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, Image } from "react-native";
import { colors, radius, mono } from "../theme";
import { useStore } from "../store";
import Icon from "../components/Icon";
import SheetHeader from "../components/SheetHeader";
import { PLAYLIST_VISIBILITY_OPTIONS, normalizePlaylistVisibility } from "../domain/playlistVisibility.mjs";
import { playlistCandidateVarietyNote, playlistHasTrack, playlistTrackIdentity, playlistVarietySummary } from "../domain/playlist-insights.mjs";
import { accountTargetScope, scopedScreenValue } from "../domain/screenScope.mjs";

const EMPTY_PICKER_STATE = Object.freeze({ name: "", busy: false, done: null, visibility: "public" });

// Add a single song to a playlist: pick an existing one, or type a name to start a
// new one. This is the "build a playlist one song at a time" flow (the Save-as-
// playlist button on the player still snapshots a whole session).
export default function PlaylistPickerScreen({ track, onClose }) {
  const { session, myPlaylists, loadMyPlaylists, createPlaylist, addToPlaylist } = useStore();
  const pickerScope = accountTargetScope(session?.id, `playlist:${playlistTrackIdentity(track) || "empty"}`);
  const pickerScopeRef = useRef(pickerScope);
  pickerScopeRef.current = pickerScope;
  const closeTimerRef = useRef(null);
  const [pickerState, setPickerState] = useState(() => ({ scope: pickerScope, value: EMPTY_PICKER_STATE }));
  const { name, busy, done, visibility } = scopedScreenValue(pickerState, pickerScope, EMPTY_PICKER_STATE);
  const updatePicker = (changes) => setPickerState((current) => ({
    scope: pickerScope,
    value: {
      ...scopedScreenValue(current, pickerScope, EMPTY_PICKER_STATE),
      ...(typeof changes === "function"
        ? changes(scopedScreenValue(current, pickerScope, EMPTY_PICKER_STATE))
        : changes),
    },
  }));

  useEffect(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    setPickerState({ scope: pickerScope, value: EMPTY_PICKER_STATE });
    loadMyPlaylists();
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    };
    // loadMyPlaylists is supplied by the store; this screen scope owns refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerScope]);

  if (!session) {
    return (
      <View style={styles.wrap}>
        <SheetHeader title="Add to playlist" onClose={onClose} />
        <View style={styles.content}><Text style={styles.hint}>Sign in to build playlists.</Text></View>
      </View>
    );
  }

  const addTo = async (pl) => {
    if (busy || playlistHasTrack(pl, track)) return;
    const requestScope = pickerScope;
    updatePicker({ busy: true });
    const ok = await addToPlaylist(pl.id, track);
    if (pickerScopeRef.current !== requestScope) return;
    updatePicker({ busy: false, done: ok ? pl.name : null });
    if (ok) {
      closeTimerRef.current = setTimeout(() => {
        if (pickerScopeRef.current === requestScope) onClose?.();
      }, 900);
    }
  };
  const create = async () => {
    const nm = name.trim();
    if (busy || !nm) return;
    const requestScope = pickerScope;
    updatePicker({ busy: true });
    const pl = await createPlaylist(nm, track, normalizePlaylistVisibility(visibility));
    if (pickerScopeRef.current !== requestScope) return;
    updatePicker({ busy: false, done: pl ? nm : null });
    if (pl) {
      closeTimerRef.current = setTimeout(() => {
        if (pickerScopeRef.current === requestScope) onClose?.();
      }, 900);
    }
  };

  return (
    <View style={styles.wrap}>
      <SheetHeader title="Add to playlist" onClose={onClose} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {track ? (
          <View style={styles.track}>
            {track.art ? <Image source={{ uri: track.art }} style={styles.art} /> : <View style={[styles.art, styles.artEmpty]}><Icon name="music" size={16} color={colors.textFaint} /></View>}
            <View style={{ flex: 1 }}>
              <Text style={styles.trackTitle} numberOfLines={1}>{track.title}</Text>
              {!!track.artist && <Text style={styles.trackArtist} numberOfLines={1}>{track.artist}</Text>}
            </View>
          </View>
        ) : null}

        {done ? (
          <View style={styles.doneBox}>
            <Icon name="check" size={26} color={colors.good} />
            <Text style={styles.doneTxt}>Added to {done}</Text>
          </View>
        ) : (
          <>
            <Text style={styles.label}>NEW PLAYLIST</Text>
            <View style={styles.newRow}>
              <TextInput
                style={styles.input}
                placeholder="Name it..."
                placeholderTextColor={colors.textFaint}
                value={name}
                onChangeText={(value) => updatePicker({ name: value })}
                onSubmitEditing={create}
                returnKeyType="done"
                maxLength={80}
              />
              <Pressable
                style={[styles.createBtn, !name.trim() && styles.createOff]}
                onPress={create}
                disabled={!name.trim() || busy}
                accessibilityRole="button"
                accessibilityLabel="Create playlist and add this song"
                accessibilityState={{ disabled: !name.trim() || busy, busy }}
              >
                <Icon name="plus" size={15} color="#1A1206" />
                <Text style={styles.createTxt}>Create</Text>
              </Pressable>
            </View>

            <Text style={[styles.label, styles.visibilityLabel]}>WHO CAN SEE IT</Text>
            <View style={styles.visibilityOptions} accessibilityRole="radiogroup">
              {PLAYLIST_VISIBILITY_OPTIONS.map((option) => {
                const selected = visibility === option.value;
                return (
                  <Pressable
                    key={option.value}
                    style={[styles.visibilityOption, selected && styles.visibilitySelected]}
                    onPress={() => updatePicker({ visibility: option.value })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${option.label}. ${option.description}`}
                  >
                    <View style={[styles.radio, selected && styles.radioSelected]}>
                      {selected && <View style={styles.radioDot} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.visibilityName, selected && styles.visibilityNameSelected]}>{option.label}</Text>
                      <Text style={styles.visibilityCopy}>{option.description}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {myPlaylists.length > 0 && <Text style={[styles.label, { marginTop: 20 }]}>YOUR PLAYLISTS · {myPlaylists.length}</Text>}
            {myPlaylists.map((pl) => {
              const duplicate = playlistHasTrack(pl, track);
              const summary = playlistVarietySummary(pl);
              const varietyNote = playlistCandidateVarietyNote(pl, track);
              const rowLabel = duplicate
                ? `${pl.name}. ${summary}. Already added.`
                : `${pl.name}. ${summary}.${varietyNote ? ` ${varietyNote}` : ""} Add this song.`;
              return (
                <Pressable
                  key={pl.id}
                  style={[styles.row, duplicate && styles.rowDuplicate]}
                  onPress={() => addTo(pl)}
                  disabled={busy || duplicate}
                  accessibilityRole="button"
                  accessibilityLabel={rowLabel}
                  accessibilityState={{ disabled: busy || duplicate }}
                >
                  <View style={[styles.rowIcon, duplicate && styles.rowIconDuplicate]}><Icon name={duplicate ? "check" : "play"} size={15} color={duplicate ? colors.good : colors.amber} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName} numberOfLines={1}>{pl.name}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>{summary}</Text>
                    {varietyNote ? <Text style={[styles.rowInsight, duplicate && styles.rowAlready]}>{varietyNote}</Text> : null}
                  </View>
                  <Icon name={duplicate ? "check" : "plus"} size={16} color={duplicate ? colors.good : colors.textDim} />
                </Pressable>
              );
            })}
            {myPlaylists.length === 0 && <Text style={styles.hint}>No playlists yet. Name one above to start.</Text>}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16 },
  track: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginBottom: 20 },
  art: { width: 44, height: 44, borderRadius: 8, backgroundColor: colors.surfaceAlt },
  artEmpty: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line },
  trackTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
  trackArtist: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  label: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "800", marginBottom: 8 },
  newRow: { flexDirection: "row", gap: 8 },
  input: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  createBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingHorizontal: 14, justifyContent: "center" },
  createOff: { opacity: 0.4 },
  createTxt: { color: "#1A1206", fontSize: 14, fontWeight: "800" },
  visibilityLabel: { marginTop: 18 },
  visibilityOptions: { gap: 8 },
  visibilityOption: { flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 11 },
  visibilitySelected: { borderColor: colors.amber, backgroundColor: colors.bgElev },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: colors.textFaint, alignItems: "center", justifyContent: "center" },
  radioSelected: { borderColor: colors.amber },
  radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.amber },
  visibilityName: { color: colors.text, fontSize: 13.5, fontWeight: "800" },
  visibilityNameSelected: { color: colors.amber },
  visibilityCopy: { color: colors.textDim, fontSize: 11.5, lineHeight: 17, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginBottom: 8 },
  rowDuplicate: { borderColor: colors.good, opacity: 0.82 },
  rowIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.bgElev },
  rowIconDuplicate: { borderColor: colors.good },
  rowName: { color: colors.text, fontSize: 14.5, fontWeight: "800" },
  rowSub: { color: colors.textDim, fontSize: 11.5, marginTop: 2, fontFamily: mono },
  rowInsight: { color: colors.amber, fontSize: 11.5, lineHeight: 16, marginTop: 4 },
  rowAlready: { color: colors.good, fontWeight: "800" },
  hint: { color: colors.textDim, fontSize: 13, marginTop: 8 },
  doneBox: { alignItems: "center", gap: 12, marginTop: 30 },
  doneTxt: { color: colors.text, fontSize: 16, fontWeight: "700" },
});
