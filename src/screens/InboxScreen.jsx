import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Avatar from "../components/Avatar";

export default function InboxScreen({ onClose, onOpenThread }) {
  const { inboxThreads, session } = useStore();
  const threads = inboxThreads();

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker="MESSAGES" title="Inbox" onBack={onClose} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!session && <Text style={styles.empty}>Log in to message people.</Text>}
        {session && threads.length === 0 && <Text style={styles.empty}>No messages yet. Open someone's profile and tap Message to start a chat.</Text>}
        {threads.map((t) => (
          <Pressable key={t.otherId} style={styles.row} onPress={() => onOpenThread?.(t.otherId)}>
            <Avatar user={t.otherUser} size={48} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{t.otherUser?.name}</Text>
              <Text style={[styles.snippet, t.unread > 0 && styles.snippetUnread]} numberOfLines={1}>
                {t.last?.from === session.id ? "You: " : ""}{t.last?.text}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 6 }}>
              <Text style={styles.ts}>{t.last?.ts}</Text>
              {t.unread > 0 && <View style={styles.badge}><Text style={styles.badgeTxt}>{t.unread}</Text></View>}
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  empty: { color: colors.textDim, fontSize: 14, lineHeight: 21, fontStyle: "italic", marginTop: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginBottom: 10 },
  name: { color: colors.text, fontSize: 15, fontWeight: "700" },
  snippet: { color: colors.textDim, fontSize: 13, marginTop: 3 },
  snippetUnread: { color: colors.text, fontWeight: "600" },
  ts: { color: colors.textFaint, fontSize: 11, fontFamily: mono },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.magenta, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  badgeTxt: { color: "#fff", fontSize: 11, fontWeight: "800", fontFamily: mono },
});
