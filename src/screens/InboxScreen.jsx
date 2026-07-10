import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Avatar from "../components/Avatar";

export default function InboxScreen({ onClose, onOpenThread }) {
  const { mainThreads, requestThreads, session } = useStore();
  const [tab, setTab] = useState("main");
  const main = session ? mainThreads() : [];
  const requests = session ? requestThreads() : [];
  const threads = tab === "requests" ? requests : main;

  const Row = (t) => (
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
  );

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker="MESSAGES" title="Inbox" onBack={onClose} />

      {session && (
        <View style={styles.tabs}>
          <Pressable style={[styles.tab, tab === "main" && styles.tabOn]} onPress={() => setTab("main")}>
            <Text style={[styles.tabTxt, tab === "main" && styles.tabTxtOn]}>Messages</Text>
          </Pressable>
          <Pressable style={[styles.tab, tab === "requests" && styles.tabOn]} onPress={() => setTab("requests")}>
            <Text style={[styles.tabTxt, tab === "requests" && styles.tabTxtOn]}>Requests</Text>
            {requests.length > 0 && <View style={styles.tabCount}><Text style={styles.tabCountTxt}>{requests.length}</Text></View>}
          </Pressable>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!session && <Text style={styles.empty}>Log in to message people.</Text>}

        {session && tab === "requests" && (
          <Text style={styles.hint}>Messages from people you don't follow. Reply to accept, the chat then moves to Messages.</Text>
        )}

        {session && threads.length === 0 && (
          <Text style={styles.empty}>
            {tab === "requests"
              ? "No message requests."
              : "No messages yet. Open someone's profile and tap Message to start a chat."}
          </Text>
        )}

        {threads.map(Row)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  tab: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, flex: 1, paddingVertical: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  tabOn: { borderColor: colors.amber, backgroundColor: colors.bgElev },
  tabTxt: { color: colors.textDim, fontSize: 13.5, fontWeight: "700" },
  tabTxtOn: { color: colors.amber, fontWeight: "800" },
  tabCount: { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.magenta, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  tabCountTxt: { color: "#fff", fontSize: 10.5, fontWeight: "800", fontFamily: mono },
  content: { padding: 16, paddingBottom: 40 },
  hint: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginBottom: 12 },
  empty: { color: colors.textDim, fontSize: 14, lineHeight: 21, fontStyle: "italic", marginTop: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginBottom: 10 },
  name: { color: colors.text, fontSize: 15, fontWeight: "700" },
  snippet: { color: colors.textDim, fontSize: 13, marginTop: 3 },
  snippetUnread: { color: colors.text, fontWeight: "600" },
  ts: { color: colors.textFaint, fontSize: 11, fontFamily: mono },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.magenta, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  badgeTxt: { color: "#fff", fontSize: 11, fontWeight: "800", fontFamily: mono },
});
