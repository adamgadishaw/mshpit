import { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import MentionText from "../components/MentionText";

export default function ThreadScreen({ otherId, onClose, onOpenProfile, onOpenProfileByHandle }) {
  const { session, userById, threadMessages, sendDM, loadThread, markThreadRead, loadUser } = useStore();
  const other = userById(otherId);
  const [text, setText] = useState("");
  const messages = threadMessages(otherId);

  // Live DMs: hydrate on open AND poll, so replies land without a refresh
  // (loadThread merges by id, so re-polling is cheap + dedup-safe).
  useEffect(() => {
    loadThread(otherId);
    const id = setInterval(() => loadThread(otherId), 3500);
    return () => clearInterval(id);
  }, [otherId]);
  // A DM notification can open a chat with someone this device never cached;
  // fetch them so the name + avatar resolve instead of a nameless "Chat".
  useEffect(() => { if (otherId && !userById(otherId)) loadUser(otherId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [otherId]);
  useEffect(() => { markThreadRead(otherId); }, [otherId, messages.length]);

  const send = () => { if (text.trim()) { sendDM(otherId, text); setText(""); } };
  const onMention = (h) => onOpenProfileByHandle?.(h);

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScreenHeader kicker="DIRECT MESSAGE" title={other?.name || "Chat"} onBack={onClose}
        right={<Pressable onPress={() => onOpenProfile?.(otherId)}><Avatar user={other} size={32} /></Pressable>} />

      <ScrollView contentContainerStyle={styles.chat} showsVerticalScrollIndicator={false}>
        {messages.length === 0 && <Text style={styles.empty}>Say hi to {other?.name?.split(" ")[0]}.</Text>}
        {messages.map((m) => {
          const mine = m.from === session?.id;
          return (
            <View key={m.id} style={[styles.row, mine && styles.rowMine]}>
              <View style={[styles.bubble, mine && styles.bubbleMine]}>
                <MentionText text={m.text} style={[styles.msgText, mine && { color: "#1A1206" }]} onMention={onMention} />
                <Text style={[styles.ts, mine && { color: "rgba(26,18,6,0.6)" }]}>{m.ts}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {session ? (
        <View style={styles.inputBar}>
          <TextInput style={styles.input} placeholder={`Message ${other?.name?.split(" ")[0] || ""}…  (use @ to tag)`} placeholderTextColor={colors.textFaint} value={text} onChangeText={setText} onSubmitEditing={send} returnKeyType="send" maxLength={1000} />
          <Pressable style={styles.sendBtn} onPress={send}>
            <Icon name="chevron-right" size={20} color="#1A1206" />
          </Pressable>
        </View>
      ) : (
        <Text style={styles.login}>Log in to message.</Text>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  chat: { padding: 16, paddingBottom: 24, gap: 10 },
  empty: { color: colors.textDim, fontSize: 13, fontStyle: "italic", textAlign: "center", marginTop: 20 },
  row: { maxWidth: "82%", alignSelf: "flex-start" },
  rowMine: { alignSelf: "flex-end" },
  bubble: { backgroundColor: colors.surface, borderRadius: 16, borderTopLeftRadius: 4, borderWidth: 1, borderColor: colors.lineSoft, paddingHorizontal: 13, paddingVertical: 9 },
  bubbleMine: { backgroundColor: colors.amber, borderColor: colors.amber, borderTopLeftRadius: 16, borderTopRightRadius: 4 },
  msgText: { color: colors.text, fontSize: 15, lineHeight: 20 },
  ts: { color: colors.textFaint, fontSize: 10, fontFamily: mono, marginTop: 3, alignSelf: "flex-end" },
  inputBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 8, paddingBottom: Platform.OS === "ios" ? 24 : 12, borderTopWidth: 1, borderTopColor: colors.lineSoft, backgroundColor: colors.bgElev },
  input: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 16, paddingVertical: 11, fontSize: 15 },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center" },
  login: { color: colors.textDim, textAlign: "center", padding: 16, fontStyle: "italic" },
});
