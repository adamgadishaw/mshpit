import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import useLiveChat from "../lib/useLiveChat";
import { unifiedSearchRequestOptions } from "../domain/unifiedSearch.mjs";
import { accountTargetScope, scopedScreenValue } from "../domain/screenScope.mjs";
import VinylRefreshBoundary from "../components/VinylRefreshBoundary";
import useScopedRefresh from "../hooks/useScopedRefresh";
import { refreshScope } from "../domain/scopedRefresh.mjs";
import { messageRelationshipChips } from "../domain/messageRelationshipContext.mjs";

const EMPTY_PEOPLE_SEARCH = Object.freeze({ status: "idle", rows: [], error: "" });

export default function InboxScreen({ onClose, onOpenThread }) {
  const { mainThreads, requestThreads, searchPeople, loadInboxThreads, session, chatAuthEpoch } = useStore();
  const [tab, setTab] = useState("main");
  const [composing, setComposing] = useState(false);
  const [query, setQuery] = useState("");
  const [searchRevision, setSearchRevision] = useState(0);
  const normalizedQuery = query.trim();
  const peopleScope = accountTargetScope(session?.id, `inbox-people:${chatAuthEpoch}:${composing ? normalizedQuery.toLowerCase() : "closed"}`);
  const peopleScopeRef = useRef(peopleScope);
  peopleScopeRef.current = peopleScope;
  const [peopleSearchState, setPeopleSearchState] = useState(() => ({ scope: peopleScope, value: EMPTY_PEOPLE_SEARCH }));
  const peopleSearch = scopedScreenValue(peopleSearchState, peopleScope, EMPTY_PEOPLE_SEARCH);
  const people = peopleSearch.rows;
  const main = session ? mainThreads() : [];
  const requests = session ? requestThreads() : [];
  const threads = tab === "requests" ? requests : main;

  useLiveChat(
    ({ signal }) => loadInboxThreads({ signal }),
    { channelKey: `inbox:${chatAuthEpoch}:${session?.id || "guest"}`, enabled: !!session, intervalMs: 8000 },
  );
  const inboxRefreshScope = refreshScope(session?.id, "inbox", chatAuthEpoch);
  const { refresh: refreshInbox, refreshing: inboxRefreshing } = useScopedRefresh({
    scope: inboxRefreshScope,
    enabled: !!session,
    task: ({ signal }) => loadInboxThreads({ signal, strict: true }),
  });

  useEffect(() => {
    const controller = new AbortController();
    const requestScope = peopleScope;
    if (!composing || !normalizedQuery) {
      setPeopleSearchState({ scope: requestScope, value: EMPTY_PEOPLE_SEARCH });
      return () => controller.abort();
    }
    setPeopleSearchState({ scope: requestScope, value: { status: "loading", rows: [], error: "" } });
    const timer = setTimeout(async () => {
      try {
        const found = await searchPeople(normalizedQuery, unifiedSearchRequestOptions(controller));
        if (controller.signal.aborted || peopleScopeRef.current !== requestScope) return;
        setPeopleSearchState({
          scope: requestScope,
          value: { status: "ready", rows: (found || []).filter((person) => person.id !== session?.id).slice(0, 12), error: "" },
        });
      } catch (error) {
        if (!controller.signal.aborted && error?.name !== "AbortError" && peopleScopeRef.current === requestScope) {
          setPeopleSearchState({ scope: requestScope, value: { status: "error", rows: [], error: "People search could not update. Check your connection and try again." } });
        }
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
    // searchPeople is a store action whose identity changes with store state;
    // the account/chat epoch/query scope is the durable request owner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composing, normalizedQuery, peopleScope, searchRevision, session?.id]);

  const closeComposer = () => { setComposing(false); setQuery(""); };
  const openPerson = (person) => { closeComposer(); onOpenThread?.(person.id); };

  const Row = (t) => {
    const relationshipChips = messageRelationshipChips(t.relationshipContext).slice(0, 3);
    return (
      <Pressable key={t.otherId} style={styles.row} onPress={() => onOpenThread?.(t.otherId)} accessibilityRole="button" accessibilityLabel={`Open conversation with ${t.otherUser?.name || "member"}${t.unread ? `, ${t.unread} unread` : ""}`}>
        <Avatar user={t.otherUser} size={48} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name}>{t.otherUser?.name}</Text>
          {relationshipChips.length > 0 && (
            <View style={styles.contextChips}>
              {relationshipChips.map((chip) => (
                <View key={chip.key} style={styles.contextChip}>
                  <Text style={styles.contextChipText} numberOfLines={1}>{chip.label}</Text>
                </View>
              ))}
            </View>
          )}
          <Text style={[styles.snippet, t.unread > 0 && styles.snippetUnread]} numberOfLines={1}>
            {t.last?.failed ? "Not sent: " : t.last?.from === session.id ? "You: " : ""}{t.last?.text}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <Text style={styles.ts}>{t.last?.ts}</Text>
          {t.unread > 0 && <View style={styles.badge}><Text style={styles.badgeTxt}>{t.unread}</Text></View>}
        </View>
      </Pressable>
    );
  };

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
              accessibilityState={{ busy: peopleSearch.status === "loading" }}
            />
          </View>
          {!normalizedQuery && <Text style={styles.searchHint}>Find a member, then start the conversation directly from here.</Text>}
          {!!normalizedQuery && peopleSearch.status === "loading" && <Text style={styles.searchHint} accessibilityLiveRegion="polite">Looking through the crowd...</Text>}
          {!!normalizedQuery && peopleSearch.status === "ready" && people.length === 0 && <Text style={styles.searchHint} accessibilityLiveRegion="polite">No member matched that search.</Text>}
          {peopleSearch.status === "error" && (
            <View style={styles.searchError} accessibilityLiveRegion="assertive">
              <Text style={styles.searchErrorText} selectable>{peopleSearch.error}</Text>
              <Pressable style={styles.retrySearch} onPress={() => setSearchRevision((value) => value + 1)} accessibilityRole="button" accessibilityLabel={`Retry people search for ${normalizedQuery}`}>
                <Text style={styles.retrySearchText}>Try again</Text>
              </Pressable>
            </View>
          )}
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
          <Pressable style={[styles.tab, tab === "main" && styles.tabOn]} onPress={() => setTab("main")} accessibilityRole="tab" accessibilityState={{ selected: tab === "main" }} accessibilityLabel="Messages">
            <Text style={[styles.tabTxt, tab === "main" && styles.tabTxtOn]}>Messages</Text>
          </Pressable>
          <Pressable style={[styles.tab, tab === "requests" && styles.tabOn]} onPress={() => setTab("requests")} accessibilityRole="tab" accessibilityState={{ selected: tab === "requests" }} accessibilityLabel={`Message requests${requests.length ? `, ${requests.length}` : ""}`}>
            <Text style={[styles.tabTxt, tab === "requests" && styles.tabTxtOn]}>Requests</Text>
            {requests.length > 0 && <View style={styles.tabCount}><Text style={styles.tabCountTxt}>{requests.length}</Text></View>}
          </Pressable>
        </View>
      )}

      <VinylRefreshBoundary
        refreshing={inboxRefreshing}
        onRefresh={refreshInbox}
        accessibilityLabel="Refresh inbox"
        enabled={!!session}
      >
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
      </VinylRefreshBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  composeBar: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 16, paddingTop: 12 },
  composeBtn: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: colors.amberStrong, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 9 },
  composeBtnOn: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line },
  composeBtnTxt: { color: "#1A1206", fontSize: 13, fontWeight: "900" },
  composeBtnTxtOn: { color: colors.text },
  composePanel: { marginHorizontal: 16, marginTop: 10, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.md, padding: 12 },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingHorizontal: 12 },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 11 },
  searchHint: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, paddingHorizontal: 4, paddingTop: 10, paddingBottom: 2 },
  searchError: { gap: 8, paddingHorizontal: 4, paddingTop: 10 },
  searchErrorText: { color: colors.danger, fontSize: 12.5, lineHeight: 18 },
  retrySearch: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber },
  retrySearchText: { color: colors.amber, fontSize: 12.5, fontWeight: "800" },
  personRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 4, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  personHandle: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  tab: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, flex: 1, paddingVertical: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
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
  contextChips: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 5 },
  contextChip: { maxWidth: "100%", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev, paddingHorizontal: 7, paddingVertical: 2 },
  contextChipText: { color: colors.amber, fontSize: 9.5, fontWeight: "800" },
  snippet: { color: colors.textDim, fontSize: 13, marginTop: 3 },
  snippetUnread: { color: colors.text, fontWeight: "600" },
  ts: { color: colors.textFaint, fontSize: 11, fontFamily: mono },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.magenta, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  badgeTxt: { color: "#fff", fontSize: 11, fontWeight: "800", fontFamily: mono },
});
