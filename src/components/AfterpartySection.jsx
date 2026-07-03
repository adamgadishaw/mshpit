import { useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, Linking } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore } from "../store";
import { afterpartySpots, mapsDir, uberTo } from "../lib/afterparty";
import Icon from "./Icon";
import Avatar from "./Avatar";

const typeIcon = (t) => (t === "food" ? "food" : t === "activity" ? "star" : "drink");
const typeLabel = (t) => (t === "food" ? "Food" : t === "bar" ? "Bar" : t === "club" ? "Club" : "Activity");

export default function AfterpartySection({ log, coord, onOpenProfile, onRequireAuth }) {
  const { session, commentsFor, addComment, likeInfo, toggleLike } = useStore();
  const [draft, setDraft] = useState("");
  const spots = afterpartySpots(coord);
  const thread = commentsFor(log.id);
  const { count, liked } = likeInfo(log.id, log.likes || 0);

  const post = () => {
    if (!session) return onRequireAuth?.();
    if (!draft.trim()) return;
    addComment(log.id, draft);
    setDraft("");
  };

  return (
    <View>
      <View style={styles.headRow}>
        <Text style={styles.afterTitle}>AFTERPARTY</Text>
        <Pressable style={styles.likeBtn} onPress={() => (session ? toggleLike(log.id, log.likes || 0) : onRequireAuth?.())}>
          <Icon name="heart" filled={liked} size={16} color={liked ? colors.magenta : colors.textDim} />
          <Text style={[styles.likeTxt, liked && { color: colors.magenta }]}>{count}</Text>
        </Pressable>
      </View>

      {/* still open near you */}
      {spots.length > 0 && (
        <>
          <Text style={styles.sub}>STILL OPEN NEARBY</Text>
          {spots.map((s) => (
            <View key={s.id} style={styles.spot}>
              <View style={styles.spotIcon}>
                <Icon name={typeIcon(s.type)} size={16} color={colors.amber} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.spotName}>{s.name}</Text>
                <Text style={styles.spotMeta}>{typeLabel(s.type)} · open till {s.openUntil} · {s.walk} min walk</Text>
              </View>
              <Pressable style={styles.linkBtn} onPress={() => Linking.openURL(mapsDir(s.lat, s.lng))} hitSlop={6}>
                <Icon name="pin" size={13} color={colors.amber} />
                <Text style={styles.linkTxt}>Directions</Text>
              </Pressable>
              <Pressable style={styles.uberBtn} onPress={() => Linking.openURL(uberTo(s.lat, s.lng, s.name))} hitSlop={6}>
                <Text style={styles.uberTxt}>Uber</Text>
              </Pressable>
            </View>
          ))}
        </>
      )}

      {/* discussion */}
      <Text style={styles.sub}>DISCUSSION · {thread.length}</Text>
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder={session ? "Add to the afterparty…" : "Log in to comment"}
          placeholderTextColor={colors.textFaint}
          value={draft}
          onChangeText={setDraft}
          editable={!!session}
          onSubmitEditing={post}
          returnKeyType="send"
        />
        <Pressable style={[styles.send, !draft.trim() && { opacity: 0.4 }]} onPress={post}>
          <Icon name="chevron-right" size={18} color="#1A1206" />
        </Pressable>
      </View>

      {thread.length === 0 && <Text style={styles.empty}>No comments yet - start the afterparty.</Text>}
      {thread.map((c) => (
        <View key={c.id} style={styles.comment}>
          <Avatar user={{ initials: c.initials, name: c.name }} size={30} onPress={c.userId ? () => onOpenProfile?.(c.userId) : undefined} />
          <View style={{ flex: 1 }}>
            <Text style={styles.cName}>{c.name}</Text>
            <Text style={styles.cText}>{c.text}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  afterTitle: { color: colors.text, fontSize: 18, fontWeight: "900", letterSpacing: 0.5 },
  likeBtn: { flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7 },
  likeTxt: { color: colors.textDim, fontFamily: mono, fontSize: 13, fontWeight: "700" },
  sub: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginTop: 18, marginBottom: 10 },
  spot: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginBottom: 8 },
  spotIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  spotName: { color: colors.text, fontSize: 14, fontWeight: "700" },
  spotMeta: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 7 },
  linkTxt: { color: colors.amber, fontSize: 12, fontWeight: "700" },
  uberBtn: { backgroundColor: colors.text, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7 },
  uberTxt: { color: "#000", fontSize: 12, fontWeight: "800" },
  composer: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14 },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center" },
  empty: { color: colors.textDim, fontSize: 13, fontStyle: "italic", marginTop: 10 },
  comment: { flexDirection: "row", gap: 10, marginTop: 14 },
  cName: { color: colors.text, fontSize: 13, fontWeight: "700" },
  cText: { color: colors.textDim, fontSize: 14, lineHeight: 20, marginTop: 2 },
});
