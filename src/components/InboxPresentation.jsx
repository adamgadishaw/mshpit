import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { colors, focusRing } from "../theme";
import { inboxPreview, inboxUnreadLabel } from "../domain/inboxPresentation.mjs";
import MessageScreenHeader from "./MessageScreenHeader";
import Avatar from "./Avatar";
import Icon from "./Icon";
import VinylRefreshBoundary from "./VinylRefreshBoundary";

const interactive = (base) => ({ pressed, focused }) => [base, pressed && styles.pressed, focused && focusRing];

// Presentational boundary also lets the real UI be rendered with synthetic data.
// Search, account ownership, live reads and navigation remain in InboxScreen.
export default function InboxPresentation({ session, composing, query, setQuery, inboxQuery, setInboxQuery,
  peopleSearch, people, retryPeople, tab, setTab, requests, threads, inboxStatus,
  inboxRefreshing, refreshInbox, onClose, onCompose, closeComposer, onOpenThread, openPerson }) {
  const largeText = useWindowDimensions().fontScale >= 1.5;
  const search = composing ? query : inboxQuery;
  const setSearch = composing ? setQuery : setInboxQuery;
  const normalized = search.trim();
  const emptyReady = inboxStatus === "ready" && !threads.length;
  return <View style={styles.wrap} testID="messaging-inbox">
    <MessageScreenHeader title={composing ? "New message" : "Messages"} onBack={onClose}
      backLabel={composing ? "Back to messages" : "Go back"}
      right={session && <Pressable onPress={composing ? closeComposer : onCompose}
        style={interactive(styles.compose)} accessibilityRole="button"
        accessibilityLabel={composing ? "Close new message" : "New message"} accessibilityState={{ expanded: composing }}>
        <Icon name={composing ? "x" : "edit"} size={21} color={colors.amber} />
      </Pressable>} />

    {session && <View style={styles.tools}>
      <View style={styles.searchBox}>
        <Icon name="search" size={19} color={colors.textDim} />
        <TextInput key={composing ? "people" : "conversations"} style={styles.searchInput}
          value={search} onChangeText={setSearch} autoFocus={composing} autoCapitalize="none" autoCorrect={false}
          placeholder={composing ? "Name or @handle" : largeText ? "Search" : "Search conversations"} placeholderTextColor={colors.textFaint}
          accessibilityLabel={composing ? "Find someone to message" : "Search conversations"}
          accessibilityHint={composing ? "Search for a member by name or handle." : "Search names, handles and latest message previews in this folder."}
          returnKeyType="search" accessibilityState={{ busy: composing && peopleSearch.status === "loading" }} />
        {!!search && <Pressable onPress={() => setSearch("")} style={styles.clear} accessibilityRole="button" accessibilityLabel="Clear search">
          <Icon name="x" size={17} color={colors.textDim} />
        </Pressable>}
      </View>
      {!composing && <View style={[styles.tabs, largeText && styles.tabsLarge]} accessibilityRole="tablist" accessibilityLabel="Inbox folders">
        {[{ key: "main", label: "Messages" }, { key: "requests", label: "Requests" }].map(folder => (
          <Pressable key={folder.key} style={interactive([styles.tab, largeText && styles.tabLarge, tab === folder.key && styles.tabOn])}
            onPress={() => setTab(folder.key)} accessibilityRole="tab" accessibilityState={{ selected: tab === folder.key }}
            accessibilityLabel={folder.key === "requests" ? `Message requests${requests.length ? `, ${requests.length}` : ""}` : "Messages"}>
            <Text style={[styles.tabText, tab === folder.key && styles.tabTextOn]}>{folder.label}</Text>
            {folder.key === "requests" && requests.length > 0 && <View style={styles.requestCount}>
              <Text style={styles.requestCountText}>{inboxUnreadLabel(requests.length)}</Text>
            </View>}
          </Pressable>
        ))}
      </View>}
    </View>}

    <VinylRefreshBoundary refreshing={inboxRefreshing} onRefresh={refreshInbox} accessibilityLabel="Refresh inbox" enabled={!!session && !composing}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}>
        {!session ? <Empty title="Your conversations live here" detail="Log in to message people." /> : composing ? <>
          {!normalized && <Empty icon="search" title="Find your people" detail="Search a name or @handle to start a conversation." />}
          {!!normalized && peopleSearch.status === "loading" && <Loading label="Searching people…" />}
          {!!normalized && peopleSearch.status === "ready" && !people.length && <Empty icon="search" title="No people found" detail="Try another name or handle." />}
          {peopleSearch.status === "error" && <Recovery text={peopleSearch.error} label={`Retry people search for ${normalized}`} onPress={retryPeople} />}
          {people.map(person => <Pressable key={person.id} style={interactive(styles.person)} onPress={() => openPerson(person)}
            accessibilityRole="button" accessibilityLabel={`Message ${person.name}`}>
            <Avatar user={person} size={48} />
            <View style={styles.personCopy}><Text style={styles.name} numberOfLines={2}>{person.name}</Text>
              {!!person.handle && <Text style={styles.preview} numberOfLines={1}>@{person.handle}</Text>}</View>
            <Icon name="chevron-right" size={19} color={colors.textFaint} />
          </Pressable>)}
        </> : <>
          {tab === "requests" && <Text style={styles.folderHint}>You decide who joins your inbox. Open a request to accept it, block the sender or report a message.</Text>}
          {!!normalized && <Text style={styles.searchSummary} accessibilityLiveRegion="polite">
            {threads.length} {threads.length === 1 ? "conversation" : "conversations"} · names and latest previews
          </Text>}
          {inboxStatus === "error" && <Recovery text="Inbox couldn’t update. Check your connection and try again." onPress={refreshInbox}
            label="Retry loading inbox" busy={inboxRefreshing} />}
          {!threads.length && inboxStatus === "loading" && <Loading label="Loading conversations…" />}
          {emptyReady && (normalized ? <Empty icon="search" title="No conversations found" detail="Try a name, handle or words from the latest message. You can also check the other folder."
            action="Clear search" onAction={() => setInboxQuery("")} />
            : tab === "requests" ? <Empty title="No message requests" detail="New requests will appear here for you to review." />
              : <Empty title="Start a conversation" detail="Make plans, talk music and keep in touch."
                action="New message" onAction={onCompose} />)}
          {threads.map(thread => {
            const unread = thread.unread > 0;
            const name = thread.otherUser?.name || "Member";
            const preview = inboxPreview(thread, session.id);
            return <Pressable key={thread.otherId} testID="conversation-row" style={interactive(styles.row)} onPress={() => onOpenThread?.(thread.otherId)}
              accessibilityRole="button" accessibilityLabel={`Open conversation with ${name}${unread ? `, ${thread.unread} unread` : ""}. ${preview}${thread.last?.ts ? `. ${thread.last.ts}` : ""}`}>
              <View style={styles.avatar}><Avatar user={thread.otherUser} size={52} /></View>
              <View style={styles.rowCopy}>
                <View style={[styles.rowHeading, largeText && styles.rowHeadingLarge]}>
                  <Text style={[styles.name, largeText && styles.nameLarge, unread && styles.nameUnread]} numberOfLines={2}>{name}</Text>
                  {!!thread.last?.ts && <Text style={[styles.time, unread && styles.timeUnread]}>{thread.last.ts}</Text>}
                </View>
                <View style={styles.previewLine}>
                  <Text style={[styles.preview, unread && styles.previewUnread, thread.last?.failed && styles.previewFailed]} numberOfLines={2}>{preview}</Text>
                  {unread && <View style={styles.unreadBadge}><Text style={styles.unreadText}>{inboxUnreadLabel(thread.unread)}</Text></View>}
                </View>
              </View>
            </Pressable>;
          })}
        </>}
      </ScrollView>
    </VinylRefreshBoundary>
  </View>;
}

function Empty({ title, detail, icon = "mail", action, onAction }) {
  return <View style={styles.empty}>
    <View style={styles.emptyIcon}><Icon name={icon} size={27} color={colors.amber} /></View>
    <Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyDetail}>{detail}</Text>
    {!!action && <Pressable onPress={onAction} style={interactive(styles.emptyAction)} accessibilityRole="button" accessibilityLabel={action}>
      <Text style={styles.actionText}>{action}</Text>
    </Pressable>}
  </View>;
}
function Loading({ label }) {
  return <View style={styles.loading} accessibilityLabel={label} accessibilityState={{ busy: true }}>
    <ActivityIndicator color={colors.amber} /><Text style={styles.emptyDetail}>{label}</Text>
  </View>;
}
function Recovery({ text, label, onPress, busy = false }) {
  return <View style={styles.recovery} accessibilityLiveRegion="polite"><Text style={styles.folderHint}>{text}</Text>
    <Pressable onPress={onPress} style={interactive(styles.emptyAction)} disabled={busy} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: busy, busy }}>
      <Text style={styles.actionText}>Try again</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  compose: { width: 44, minHeight: 44, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceAlt },
  pressed: { opacity: 0.65 },
  tools: { paddingHorizontal: 16, paddingTop: 4 },
  searchBox: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 14, paddingRight: 4, backgroundColor: colors.surfaceAlt, borderRadius: 14 },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 12, paddingRight: 8, fontSize: 15, color: colors.text },
  clear: { width: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  tabs: { flexDirection: "row", gap: 24, marginTop: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.lineSoft },
  tab: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: "transparent", flexShrink: 1 },
  tabsLarge: { gap: 16 },
  tabLarge: { flex: 1, minWidth: 0, flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 4 },
  rowHeadingLarge: { flexDirection: "column", alignItems: "flex-start", gap: 3 },
  nameLarge: { flex: 0, alignSelf: "stretch" },
  tabOn: { borderBottomColor: colors.amber },
  tabText: { fontSize: 14, fontWeight: "600", color: colors.textDim, flexShrink: 1 },
  tabTextOn: { color: colors.text },
  requestCount: { minWidth: 22, minHeight: 22, borderRadius: 11, paddingHorizontal: 6, paddingVertical: 2, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceAlt },
  requestCountText: { fontSize: 11, fontWeight: "700", color: colors.amber },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 32, paddingTop: 4 },
  row: { minHeight: 80, flexDirection: "row", alignItems: "center", gap: 13, paddingVertical: 12 },
  avatar: { flexShrink: 0 },
  rowCopy: { flex: 1, minWidth: 0, gap: 5 },
  rowHeading: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  name: { flex: 1, minWidth: 0, color: colors.text, fontSize: 16, fontWeight: "600" },
  nameUnread: { fontWeight: "800" },
  time: { color: colors.textFaint, fontSize: 12, flexShrink: 0 },
  timeUnread: { color: colors.amber },
  previewLine: { flexDirection: "row", alignItems: "center", gap: 10 },
  preview: { flex: 1, minWidth: 0, color: colors.textDim, fontSize: 14, lineHeight: 20 },
  previewUnread: { color: colors.text, fontWeight: "600" },
  previewFailed: { color: colors.danger },
  unreadBadge: { minWidth: 23, minHeight: 23, borderRadius: 12, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  unreadText: { color: "#1A1206", fontSize: 11, fontWeight: "800" },
  folderHint: { color: colors.textDim, fontSize: 13, lineHeight: 19, paddingVertical: 10 },
  searchSummary: { color: colors.textDim, fontSize: 12, paddingVertical: 12 },
  person: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13 },
  personCopy: { flex: 1, minWidth: 0, gap: 4 },
  empty: { paddingTop: 38, paddingBottom: 24, paddingHorizontal: 20, alignItems: "center", gap: 10 },
  emptyIcon: { width: 58, height: 58, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "700", textAlign: "center", marginTop: 6 },
  emptyDetail: { color: colors.textDim, fontSize: 14, lineHeight: 21, textAlign: "center", maxWidth: 290 },
  emptyAction: { minHeight: 44, justifyContent: "center", alignSelf: "center", paddingHorizontal: 16, paddingVertical: 10 },
  actionText: { color: colors.amber, fontSize: 14, fontWeight: "700" },
  recovery: { paddingVertical: 8 },
  loading: { alignItems: "center", gap: 12, paddingVertical: 28 },
});
