import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import useLiveChat from "../lib/useLiveChat";

export default function InboxScreen({ onClose, onOpenThread }) {
  const { mainThreads, requestThreads, searchPeople, loadInboxThreads, session } = useStore();
  const [tab, setTab] = useState("main");
  const [composing, setComposing] = useState(false);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState([]);
  const [searching, setSearching] = useState(false);
  const main = session ? mainThreads() : [];
  const requests = session ? requestThreads() : [];
  const threads = tab === "requests" ? requests : main;

  useLiveChat(
    ({ signal }) => loadInboxThreads({ signal }),
    { channelKey: `inbox:${session?.id || "guest"}`, enabled: !!session, intervalMs: 8000 },
  );

  useEffect(() => {
    const q = query.trim();
    if (!composing || !q) { setPeople([]); setSearching(false); return undefined; }
    let current = true;
    setSearching(true);
    const timer = setTimeout(async () => {
      const found = await searchPeople(q);
      if (!current) return;
      setPeople((found || []).filter((person) => person.id !== session?.id).slice(0, 12));
      setSearching(false);
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [composing, query, session?.id]);

  const closeComposer = () => { setComposing(false); setQuery(""); setPeople([]); };
  const openPerson = (person) => { closeComposer(); onOpenThread?.(person.id); };

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
        <View style={styles.composeBar}>
          <Pressable style={[styles.composeBtn, composing && styles.composeBtnOn]} onPress={() => (composing ? closeComposer() : setComposing(true))} accessibilityRole="button" accessibilityState={{ expanded: composing }}>
            <Icon name={composing ? "x" : "plus"} size={16} color={composing ? colors.text : "#1A1206"} />
            <Text style={[styles.composeBtnTxt, composing && styles.composeBtnTxtOn]}>{composing ? "Close" : "New message"}</Text>
          </Pressable>
        </View>
      )}

      {session && composing && (
        <View style={styles.composePanel}>
          <View style={styles.searchBox}>
            <Icon name="search" size={17} color={colors.textDim} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search people by name or @handle"
              placeholderTextColor={colors.textFaint}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Find someone to message"
            />
          </View>
          {!query.trim() && <Text style={styles.searchHint}>Find a member, then start the conversation directly from here.</Text>}
          {!!query.trim() && searching && <Text style={styles.searchHint}>Looking through the crowd...</Text>}
          {!!query.trim() && !searching && people.length === 0 && <Text style={styles.searchHint}>No member matched that search.</Text>}
          {people.map((person) => (
            <Pressable key={person.id} style={styles.personRow} onPress={() => openPerson(person)} accessibilityRole="button" accessibilityLabel={`Message ${person.name}`}>
              <Avatar user={person} size={40} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name} numberOfLines={1}>{person.name}</Text>
                {!!person.handle && <Text style={styles.personHandle} numberOfLines={1}>@{person.handle}</Text>}
              </View>
              <Icon name="chevron-right" size={17} color={colors.textFaint} />
            </Pressable>
          ))}
        </View>
      )}

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
              : "No messages yet. Tap New message to start a conversation."}
          </Text>
        )}

        {threads.map(Row)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  composeBar: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 16, paddingTop: 12 },
  composeBtn: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: colors.amberStrong, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 9 },
  composeBtnOn: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line },
  composeBtnTxt: { color: "#1A1206", fontSize: 13, fontWeight: "900" },
  composeBtnTxtOn: { color: colors.text },
  composePanel: { marginHorizontal: 16, marginTop: 10, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.md, padding: 12 },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingHorizontal: 12 },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 11, outlineStyle: "none" },
  searchHint: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, paddingHorizontal: 4, paddingTop: 10, paddingBottom: 2 },
  personRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 4, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  personHandle: { color: colors.textDim, fontSize: 12, marginTop: 2 },
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
