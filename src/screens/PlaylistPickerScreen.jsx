import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, Image } from "react-native";
import { colors, radius, mono } from "../theme";
import { useStore } from "../store";
import Icon from "../components/Icon";
import SheetHeader from "../components/SheetHeader";

// Add a single song to a playlist: pick an existing one, or type a name to start a
// new one. This is the "build a playlist one song at a time" flow (the Save-as-
// playlist button on the player still snapshots a whole session).
export default function PlaylistPickerScreen({ track, onClose }) {
  const { session, myPlaylists, loadMyPlaylists, createPlaylist, addToPlaylist } = useStore();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // playlist name it landed in

  useEffect(() => { loadMyPlaylists(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (!session) {
    return (
      <View style={styles.wrap}>
        <SheetHeader title="Add to playlist" onClose={onClose} />
        <View style={styles.content}><Text style={styles.hint}>Sign in to build playlists.</Text></View>
      </View>
    );
  }

  const addTo = async (pl) => {
    if (busy) return;
    setBusy(true);
    const ok = await addToPlaylist(pl.id, track);
    setBusy(false);
    if (ok) { setDone(pl.name); setTimeout(onClose, 900); }
  };
  const create = async () => {
    const nm = name.trim();
    if (busy || !nm) return;
    setBusy(true);
    const pl = await createPlaylist(nm, track);
    setBusy(false);
    if (pl) { setDone(nm); setTimeout(onClose, 900); }
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
                onChangeText={setName}
                onSubmitEditing={create}
                returnKeyType="done"
                maxLength={80}
              />
              <Pressable style={[styles.createBtn, !name.trim() && styles.createOff]} onPress={create} disabled={!name.trim() || busy}>
                <Icon name="plus" size={15} color="#1A1206" />
                <Text style={styles.createTxt}>Create</Text>
              </Pressable>
            </View>

            {myPlaylists.length > 0 && <Text style={[styles.label, { marginTop: 20 }]}>YOUR PLAYLISTS · {myPlaylists.length}</Text>}
            {myPlaylists.map((pl) => (
              <Pressable key={pl.id} style={styles.row} onPress={() => addTo(pl)} disabled={busy}>
                <View style={styles.rowIcon}><Icon name="play" size={15} color={colors.amber} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{pl.name}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>{pl.tracks.length} song{pl.tracks.length === 1 ? "" : "s"}</Text>
                </View>
                <Icon name="plus" size={16} color={colors.textDim} />
              </Pressable>
            ))}
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
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginBottom: 8 },
  rowIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.bgElev },
  rowName: { color: colors.text, fontSize: 14.5, fontWeight: "800" },
  rowSub: { color: colors.textDim, fontSize: 11.5, marginTop: 2, fontFamily: mono },
  hint: { color: colors.textDim, fontSize: 13, marginTop: 8 },
  doneBox: { alignItems: "center", gap: 12, marginTop: 30 },
  doneTxt: { color: colors.text, fontSize: 16, fontWeight: "700" },
});
