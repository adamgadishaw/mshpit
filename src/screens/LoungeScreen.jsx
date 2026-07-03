import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore, isStaff } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import MentionText from "../components/MentionText";

// The Concert Lounge - a Discord/YouTube-style chat for everyone at a show.
// Gated: you have to tap in, so it feels like a room you enter.
export default function LoungeScreen({ log, onClose, onOpenProfile, onOpenProfileByHandle }) {
  const { session, concertKey, loungeFor, addLoungeMessage, attendeesFor, userById, removeLoungeMessage } = useStore();
  const staff = isStaff(session?.role);
  const key = concertKey(log);
  const [entered, setEntered] = useState(false);
  const [text, setText] = useState("");

  const messages = loungeFor(key);
  const attendees = attendeesFor(key);

  const send = () => { if (text.trim()) { addLoungeMessage(key, text); setText(""); } };

  if (!entered) {
    return (
      <View style={styles.wrap}>
        <ScreenHeader kicker="LOUNGE" title={log.artist} onBack={onClose} />
        <View style={styles.gate}>
          <View style={styles.gateIcon}><Icon name="comment" size={30} color={colors.amber} /></View>
          <Text style={styles.gateTitle}>Concert Lounge</Text>
          <Text style={styles.gateSub}>
            A live chat for everyone at{"\n"}
            <Text style={{ color: colors.text, fontWeight: "700" }}>{log.artist}</Text> · {log.venue}
          </Text>
          <Text style={styles.gateMeta}>{messages.length} messages · {attendees.length} going</Text>
          <Pressable style={styles.enterBtn} onPress={() => setEntered(true)}>
            <Text style={styles.enterTxt}>I'm going - enter the lounge</Text>
          </Pressable>
          <Text style={styles.gateNote}>Be decent. Mods can remove anyone.</Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScreenHeader kicker={`LOUNGE · ${log.venue}`} title={log.artist} onBack={onClose} />
      <ScrollView contentContainerStyle={styles.chat} showsVerticalScrollIndicator={false}>
        {messages.length === 0 && <Text style={styles.empty}>No messages yet - say hi.</Text>}
        {messages.map((m) => {
          const mine = m.userId === session?.id;
          const u = userById(m.userId) || { initials: m.initials, name: m.name };
          return (
            <View key={m.id} style={[styles.msgRow, mine && styles.msgRowMine]}>
              {!mine && <Avatar user={u} size={30} onPress={() => onOpenProfile?.(m.userId)} />}
              <View style={[styles.bubble, mine && styles.bubbleMine]}>
                {!mine && <Text style={styles.msgName}>{m.name}</Text>}
                <MentionText text={m.text} style={[styles.msgText, mine && { color: "#1A1206" }]} onMention={onOpenProfileByHandle} />
                <View style={styles.msgFoot}>
                  <Text style={[styles.msgTs, mine && { color: "rgba(26,18,6,0.6)" }]}>{m.ts}</Text>
                  {staff && (
                    <Pressable onPress={() => removeLoungeMessage(key, m.id)} hitSlop={8}>
                      <Icon name="trash" size={12} color={mine ? "rgba(26,18,6,0.6)" : colors.textFaint} />
                    </Pressable>
                  )}
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {session ? (
        <View style={styles.inputBar}>
          <TextInput style={styles.input} placeholder="Message the lounge…" placeholderTextColor={colors.textFaint} value={text} onChangeText={setText} onSubmitEditing={send} returnKeyType="send" maxLength={1000} />
          <Pressable style={styles.sendBtn} onPress={send}>
            <Icon name="chevron-right" size={20} color="#1A1206" />
          </Pressable>
        </View>
      ) : (
        <Text style={styles.loginNote}>Log in to chat.</Text>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  gate: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 10 },
  gateIcon: { width: 70, height: 70, borderRadius: 35, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.amber, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  gateTitle: { color: colors.text, fontSize: 24, fontWeight: "900" },
  gateSub: { color: colors.textDim, fontSize: 15, lineHeight: 22, textAlign: "center" },
  gateMeta: { color: colors.textFaint, fontFamily: mono, fontSize: 12, marginTop: 4 },
  enterBtn: { backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 15, paddingHorizontal: 28, marginTop: 18 },
  enterTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 0.5 },
  gateNote: { color: colors.textFaint, fontSize: 12, marginTop: 8 },

  chat: { padding: 16, paddingBottom: 24, gap: 12 },
  empty: { color: colors.textDim, fontSize: 13, fontStyle: "italic", textAlign: "center", marginTop: 20 },
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, maxWidth: "85%" },
  msgRowMine: { alignSelf: "flex-end", flexDirection: "row-reverse" },
  bubble: { backgroundColor: colors.surface, borderRadius: 14, borderTopLeftRadius: 4, borderWidth: 1, borderColor: colors.lineSoft, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMine: { backgroundColor: colors.amber, borderColor: colors.amber, borderTopLeftRadius: 14, borderTopRightRadius: 4 },
  msgName: { color: colors.amber, fontSize: 11, fontWeight: "800", marginBottom: 2 },
  msgText: { color: colors.text, fontSize: 14, lineHeight: 19 },
  msgFoot: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-end", marginTop: 3 },
  msgTs: { color: colors.textFaint, fontSize: 10, fontFamily: mono },
  inputBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 8, paddingBottom: Platform.OS === "ios" ? 24 : 12, borderTopWidth: 1, borderTopColor: colors.lineSoft, backgroundColor: colors.bgElev },
  input: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 16, paddingVertical: 11, fontSize: 15 },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center" },
  loginNote: { color: colors.textDim, textAlign: "center", padding: 16, fontStyle: "italic" },
});
