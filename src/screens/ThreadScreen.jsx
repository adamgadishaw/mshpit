import { Fragment, useState, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator, useWindowDimensions } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import IOSPostKeyboardView from "../components/IOSPostKeyboardView";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import MentionText from "../components/MentionText";
import useLiveChat from "../lib/useLiveChat";
import useChatScroll from "../lib/useChatScroll";
import { accountTargetScope, scopedScreenValue } from "../domain/screenScope.mjs";
import { latestIncomingDirectMessageId } from "../domain/directMessageRead.mjs";
import VinylRefreshBoundary from "../components/VinylRefreshBoundary";
import useScopedRefresh from "../hooks/useScopedRefresh";
import { refreshScope } from "../domain/scopedRefresh.mjs";
import { createIOSThreadLoad } from "../domain/iosThreadLoad.mjs";
import useIOSThreadControls from "../hooks/useIOSThreadControls";
import useIOSThreadRefreshAnnouncement from "../hooks/useIOSThreadRefreshAnnouncement";
import {
  messageRelationshipChips,
  messageRelationshipSummary,
  normalizeMessageRelationshipContext,
} from "../domain/messageRelationshipContext.mjs";

const ThreadContainer = Platform.OS === "ios" ? IOSPostKeyboardView : KeyboardAvoidingView;
const ThreadBody = Platform.OS === "ios" ? View : Fragment;

const THREAD_READ_ERROR = "Messages could not update. Check your connection and try again.";
const EMPTY_COMPOSER = Object.freeze({ text: "", sending: false });
const subscribeLocalComposer = () => () => {};
const readLocalComposer = () => EMPTY_COMPOSER;

export default function ThreadScreen({ otherId, draftLease, isCurrentIOSRoute, onClose, onOpenProfile, onOpenProfileByHandle, onReport }) {
  const {
    session, chatAuthEpoch, userById, threadMessages, sendDM, retryChatMessage,
    cancelChatMessage, loadThread, markThreadRead, loadUser,
  } = useStore();
  const other = userById(otherId);
  const isIOS = Platform.OS === "ios";
  // This is the space below the header AFTER keyboard avoidance, not a device
  // height guess. A long draft stays scrollable without taking over the history.
  const { fontScale } = useWindowDimensions();
  const [composerViewportHeight, setComposerViewportHeight] = useState(360);
  const composerMinHeight = Math.max(44, Math.ceil(22 * fontScale + 22));
  const composerMaxHeight = Math.min(Math.max(44, composerViewportHeight - 17), Math.max(composerMinHeight, Math.min(132, composerViewportHeight * 0.4)));
  const threadRefreshScope = refreshScope(session?.id, "message-thread", `${chatAuthEpoch}:${otherId || ""}`);
  const composerScope = accountTargetScope(session?.id, `dm:${otherId || ""}`);
  const composerScopeRef = useRef(composerScope);
  composerScopeRef.current = composerScope;
  const [composerState, setComposerState] = useState(() => ({ scope: composerScope, value: EMPTY_COMPOSER }));
  const relationshipScope = isIOS ? threadRefreshScope : composerScope;
  const [relationshipState, setRelationshipState] = useState(() => ({ scope: relationshipScope, value: null }));
  const relationshipScopeRef = useRef(composerScope);
  relationshipScopeRef.current = composerScope;
  const relationshipLoadedRef = useRef(false);
  const relationshipOwner = useMemo(() => ({ loaded: false, alive: true }), [relationshipScope]);
  const threadAnnouncement = useIOSThreadRefreshAnnouncement(session?.id, chatAuthEpoch, otherId, relationshipOwner, THREAD_READ_ERROR);
  const activeOwner = useRef(relationshipOwner);
  activeOwner.current = relationshipOwner;
  const [threadLoad, setThreadLoad] = useState(null);
  const threadStatus = threadLoad?.owner === relationshipOwner ? threadLoad.status : "loading";
  const threadLoader = useMemo(() => createIOSThreadLoad((status) => {
    if (activeOwner.current === relationshipOwner && relationshipOwner.alive) setThreadLoad({ owner: relationshipOwner, status });
  }), [relationshipOwner]);
  useEffect(() => {
    relationshipOwner.alive = true;
    return () => { relationshipOwner.alive = false; threadLoader.cancel(); };
  }, [relationshipOwner, threadLoader]);
  const iosDraft = Platform.OS === "ios" ? draftLease : null;
  const admitComposerAction = useIOSThreadControls({
    accountId: session?.id, authEpoch: chatAuthEpoch, otherId, draftLease: iosDraft, isCurrentRoute: isCurrentIOSRoute,
  });
  const retainedComposer = useSyncExternalStore(
    iosDraft?.subscribe || subscribeLocalComposer,
    iosDraft?.read || readLocalComposer,
    readLocalComposer,
  );
  const { text, sending, unavailable } = iosDraft ? retainedComposer : scopedScreenValue(composerState, composerScope, EMPTY_COMPOSER);
  const updateComposer = (changes) => {
    if (!admitComposerAction()) return;
    if (iosDraft) return iosDraft.edit(changes.text);
    setComposerState((current) => ({
      scope: composerScope,
      value: { ...scopedScreenValue(current, composerScope, EMPTY_COMPOSER), ...changes },
    }));
  };
  const messages = threadMessages(otherId);
  const { scrollRef, onScroll, onContentSizeChange, onLayout, onScrollBeginDrag } = useChatScroll({ messageCount: messages.length, scopeKey: `${chatAuthEpoch}:${composerScope}` });
  const incomingReadTarget = latestIncomingDirectMessageId(messages, session?.id);
  const messageRelationshipContext = [...messages].reverse()
    .find((message) => message?.relationshipContext)?.relationshipContext || null;
  const relationshipContext = normalizeMessageRelationshipContext(
    (isIOS
      ? (relationshipState.owner === relationshipOwner ? relationshipState.value : null)
      : scopedScreenValue(relationshipState, relationshipScope, null)) || messageRelationshipContext,
  );
  const relationshipChips = messageRelationshipChips(relationshipContext);
  const relationshipSummary = messageRelationshipSummary(relationshipContext);

  const loadRelationshipThread = async ({ after, signal, strict = false, forceContext = false } = {}) => {
    if (!isIOS) {
      const requestScope = relationshipScopeRef.current;
      const includeContext = forceContext || !relationshipLoadedRef.current;
      const result = await loadThread(otherId, { after, signal, strict, includeContext });
      if (relationshipScopeRef.current === requestScope
        && result
        && Object.prototype.hasOwnProperty.call(result, "relationshipContext")) {
        relationshipLoadedRef.current = true;
        setRelationshipState({
          scope: requestScope,
          value: normalizeMessageRelationshipContext(result.relationshipContext),
        });
      }
      return result;
    }
    const requestScope = relationshipScope;
    const includeContext = forceContext || !relationshipOwner.loaded;
    const result = await loadThread(otherId, { after, signal, strict, includeContext });
    if (activeOwner.current === relationshipOwner && relationshipOwner.alive
      && !signal?.aborted && !result?.stale
      && result
      && Object.prototype.hasOwnProperty.call(result, "relationshipContext")) {
      relationshipOwner.loaded = true;
      setRelationshipState({
        scope: requestScope,
        owner: relationshipOwner,
        value: normalizeMessageRelationshipContext(result.relationshipContext),
      });
    }
    return result;
  };

  useEffect(() => {
    setComposerState({ scope: composerScope, value: EMPTY_COMPOSER });
    if (!isIOS) {
      setRelationshipState({ scope: composerScope, value: null });
      relationshipLoadedRef.current = false;
    }
  }, [composerScope]);

  useLiveChat(
    ({ after, signal }) => isIOS
      ? threadLoader.run({ after, signal, load: loadRelationshipThread })
      : loadRelationshipThread({ after, signal }),
    { channelKey: `dm:${chatAuthEpoch}:${session?.id || "guest"}:${otherId}`, enabled: !!session && !!otherId },
  );
  const { refresh: runThreadRefresh, refreshing: threadRefreshing } = useScopedRefresh({
    scope: threadRefreshScope,
    enabled: !!session && !!otherId,
    task: async ({ signal }) => {
      // The deduped, enabled manual task owns speech from acceptance, not failure.
      const announcementClaim = isIOS ? threadAnnouncement.begin(signal) : null;
      try {
        const reads = [
          isIOS
            ? threadLoader.run({ signal, interactive: true, forceContext: true, load: loadRelationshipThread })
            : loadRelationshipThread({ signal, strict: true, forceContext: true }),
          loadUser(otherId, { signal }),
        ];
        // Let both iOS reads finish before reporting failure so a later history
        // completion cannot immediately erase a failed member refresh.
        const outcomes = isIOS ? await Promise.allSettled(reads) : null;
        const failed = outcomes?.find((outcome) => outcome.status === "rejected");
        if (failed) throw failed.reason;
        const [threadResult, userResult] = outcomes
          ? outcomes.map((outcome) => outcome.value)
          : await Promise.all(reads);
        if (userResult?.status === "error") {
          throw userResult.error instanceof Error ? userResult.error : new Error(userResult.error || "This member could not be refreshed.");
        }
        if (isIOS) threadAnnouncement.finish(announcementClaim, false);
        return { threadResult, userResult };
      } catch (error) {
        if (!isIOS) throw error;
        if (error?.name === "AbortError") threadAnnouncement.finish(announcementClaim, false);
        // onError is a current-render callback; keep the originating owner on
        // the failure as well, including the render-before-effect boundary.
        throw Object.assign(new Error(error?.message || THREAD_READ_ERROR), {
          name: error?.name || "Error", threadOwner: relationshipOwner, threadAnnouncementClaim: announcementClaim,
        });
      }
    },
    onError: isIOS ? (error) => {
      if (error?.threadOwner !== relationshipOwner || activeOwner.current !== relationshipOwner || !relationshipOwner.alive) return;
      setThreadLoad({ owner: relationshipOwner, status: "error" });
      threadAnnouncement.finish(error.threadAnnouncementClaim, true);
    } : null,
  });
  const refreshFlight = useRef(null);
  const refreshThread = () => {
    if (!isIOS) return runThreadRefresh();
    if (refreshFlight.current?.owner === relationshipOwner) return refreshFlight.current.promise;
    const flight = { owner: relationshipOwner, promise: null };
    refreshFlight.current = flight;
    flight.promise = runThreadRefresh().finally(() => {
      if (refreshFlight.current === flight) refreshFlight.current = null;
    });
    return flight.promise;
  };
  // A DM notification can open a chat with someone this device never cached;
  // fetch them so the name + avatar resolve instead of a nameless "Chat".
  useEffect(() => { if (otherId && !userById(otherId)) loadUser(otherId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [otherId]);
  // Opening a thread and receiving a new inbound message advance the durable
  // marker. The viewer's own optimistic send must not manufacture a read write.
  useEffect(() => {
    if (otherId && incomingReadTarget) void markThreadRead(otherId);
    // The Store command is intentionally omitted: Context recreates the facade,
    // while account + thread + latest inbound identity own this mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingReadTarget, otherId, session?.id]);

  const send = async () => {
    if (!admitComposerAction()) return;
    if (iosDraft) {
      // Claim synchronously: keyboard submit + tap cannot enqueue twice, even
      // before React renders. Completion belongs to the owner across navigation.
      const claim = iosDraft.claim();
      if (!claim) return;
      try {
        const result = await sendDM(otherId, claim.text);
        iosDraft.settle(claim, result);
      } catch {
        iosDraft.settle(claim, { ok: false });
      }
      return;
    }
    const submitted = text;
    const draft = submitted.trim();
    if (!draft || sending) return;
    const requestScope = composerScope;
    updateComposer({ sending: true });
    const result = await sendDM(otherId, draft);
    if (composerScopeRef.current !== requestScope) return;
    setComposerState((current) => {
      const value = scopedScreenValue(current, requestScope, EMPTY_COMPOSER);
      return { scope: requestScope, value: { text: result?.ok && value.text === submitted ? "" : value.text, sending: false } };
    });
  };
  const retry = async (message) => {
    if (!admitComposerAction()) return;
    const retainedBefore = iosDraft?.read();
    const requestScope = composerScope;
    const result = await retryChatMessage(message.id);
    if (iosDraft) {
      if (result?.ok) iosDraft.clearMatching(retainedBefore, message.text);
      return;
    }
    if (result?.ok && composerScopeRef.current === requestScope) {
      setComposerState((current) => {
        const value = scopedScreenValue(current, requestScope, EMPTY_COMPOSER);
        return { scope: requestScope, value: { ...value, text: value.text.trim() === message.text ? "" : value.text } };
      });
    }
  };
  const cancel = (message) => {
    if (admitComposerAction()) return cancelChatMessage(message.id);
  };
  const onMention = (h) => onOpenProfileByHandle?.(h);

  return (
    <ThreadContainer style={styles.wrap} testID="message-thread-shell">
      <ScreenHeader kicker="Direct message" title={other?.name || "Chat"} onBack={onClose}
        right={<Pressable style={styles.profileButton} onPress={() => onOpenProfile?.(otherId)} accessibilityRole="button" accessibilityLabel={`View ${other?.name || "member"} profile`}><Avatar user={other} size={32} /></Pressable>} />

      <ThreadBody {...(isIOS ? { style: styles.body, onLayout: (event) => {
        const height = event.nativeEvent.layout.height;
        if (Number.isFinite(height) && height > 0) setComposerViewportHeight(height);
      } } : {})}>
      <VinylRefreshBoundary
        refreshing={threadRefreshing}
        onRefresh={refreshThread}
        accessibilityLabel={`Refresh messages with ${other?.name || "this member"}`}
      >
      <ScrollView ref={scrollRef} contentContainerStyle={styles.chat} showsVerticalScrollIndicator={false}
        onScroll={onScroll} onContentSizeChange={onContentSizeChange} scrollEventThrottle={100}
        {...(isIOS ? { style: styles.history, onLayout, onScrollBeginDrag, keyboardDismissMode: "interactive", keyboardShouldPersistTaps: "handled", automaticallyAdjustKeyboardInsets: false, contentInsetAdjustmentBehavior: "never" } : {})}>
        {(relationshipChips.length > 0 || relationshipSummary) && (
          <View
            style={styles.relationshipCard}
            accessible
            accessibilityLabel={[`About ${other?.name || "this member"}`, ...relationshipChips.map((chip) => chip.label), relationshipSummary].filter(Boolean).join(". ")}
          >
            {relationshipChips.length > 0 && (
              <View style={styles.relationshipChips}>
                {relationshipChips.map((chip) => (
                  <View key={chip.key} style={styles.relationshipChip}>
                    <Text style={styles.relationshipChipText}>{chip.label}</Text>
                  </View>
                ))}
              </View>
            )}
            {!!relationshipSummary && <Text style={styles.relationshipSummary}>{relationshipSummary}</Text>}
          </View>
        )}
        {isIOS && session && threadStatus === "loading" && messages.length === 0 && (
          <View style={styles.readFeedback} accessible accessibilityLabel="Loading messages" accessibilityState={{ busy: true }}>
            <ActivityIndicator color={colors.amber} /><Text style={styles.readText}>Loading messages…</Text>
          </View>
        )}
        {isIOS && session && threadStatus === "error" && (
          <View style={styles.readFeedback}>
            <Text style={styles.readText}>{THREAD_READ_ERROR}</Text>
            <Pressable style={styles.retryRead} onPress={refreshThread} disabled={threadRefreshing} accessibilityRole="button" accessibilityLabel="Retry loading messages" accessibilityState={{ disabled: threadRefreshing, busy: threadRefreshing }}>
              <Text style={styles.retryReadText}>Try again</Text>
            </Pressable>
          </View>
        )}
        {messages.length === 0 && (!isIOS || (session && threadStatus === "ready")) && <Text style={styles.empty}>Say hi to {other?.name?.split(" ")[0]}.</Text>}
        {messages.map((m) => {
          const mine = m.from === session?.id;
          const reportAction = !mine && onReport ? (
            <Pressable
              style={[styles.reportBtn, isIOS && styles.reportBtnIOS]}
              onPress={() => onReport({
                targetType: "message",
                targetId: m.id,
                ownerId: m.from,
                targetName: "direct message",
                title: `Message from ${other?.name || "a member"}`,
                summary: "The message stays private and is reviewed only by the moderation team.",
              })}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Report message from ${other?.name || "this member"}`}
            >
              <Icon name="flag" size={12} color={colors.textFaint} />
            </Pressable>
          ) : null;
          const footer = (
            <View style={[styles.msgFoot, isIOS && styles.msgFootIOS]}>
              <Text style={[styles.ts, mine && !isIOS && { color: "rgba(26,18,6,0.6)" }]}>{m.ts}</Text>
              {mine && m.pending ? <Text style={[styles.deliveryMine, isIOS && styles.deliveryMineIOS]} accessibilityLiveRegion="polite">sending…</Text> : null}
              {mine && m.failed ? (
                <View style={[styles.deliveryActions, isIOS && styles.deliveryActionsIOS]}>
                  <Text style={[styles.deliveryFailed, isIOS && styles.deliveryFailedIOS]} accessibilityRole="alert" accessibilityLiveRegion="assertive" accessibilityLabel="Direct message not sent">not sent</Text>
                  <Pressable style={[styles.deliveryButton, isIOS && styles.deliveryButtonIOS]} onPress={() => retry(m)} accessibilityRole="button" accessibilityLabel="Retry direct message">
                    <Text style={[styles.deliveryAction, isIOS && styles.deliveryActionIOS]}>retry</Text>
                  </Pressable>
                  <Pressable style={[styles.deliveryButton, isIOS && styles.deliveryButtonIOS]} onPress={() => cancel(m)} accessibilityRole="button" accessibilityLabel="Cancel failed direct message">
                    <Text style={[styles.deliveryAction, isIOS && styles.deliveryActionIOS]}>cancel</Text>
                  </Pressable>
                </View>
              ) : null}
              {!isIOS && reportAction}
            </View>
          );
          const bubble = (
            <View style={[styles.bubble, mine && styles.bubbleMine, isIOS && mine && styles.bubbleMineIOS, m.failed && styles.bubbleFailed, isIOS && styles.bubbleIOS]}>
              <MentionText text={m.text} style={[styles.msgText, mine && { color: "#1A1206" }]} mentionStyle={isIOS && mine ? styles.mentionMineIOS : undefined} onMention={onMention} />
              {!isIOS && footer}
            </View>
          );
          return (
            <View key={m.id} style={[styles.row, mine && styles.rowMine, isIOS && styles.rowIOS, isIOS && mine && styles.rowMineIOS]}>
              {isIOS && !mine && <View style={styles.messageAvatar}><Avatar user={other} size={28} /></View>}
              {isIOS ? <View style={[styles.messageColumn, mine && styles.messageColumnMine]}>{bubble}{footer}</View> : bubble}
              {isIOS && reportAction}
            </View>
          );
        })}
      </ScrollView>
      </VinylRefreshBoundary>

      {session ? (
        <View style={[styles.inputBar, isIOS && styles.inputBarIOS]}>
          <TextInput
            style={[styles.input, isIOS && [styles.inputIOS, { minHeight: Math.min(composerMinHeight, composerMaxHeight), maxHeight: composerMaxHeight }]]}
            editable={!unavailable}
            placeholder={unavailable ? "Wait for another message to finish sending" : isIOS ? "Message…" : `Message ${other?.name?.split(" ")[0] || ""}…  (use @ to tag)`}
            placeholderTextColor={colors.textFaint}
            value={text}
            onChangeText={(value) => updateComposer({ text: value })}
            onSubmitEditing={isIOS ? undefined : send}
            returnKeyType={isIOS ? "default" : "send"}
            {...(isIOS ? { multiline: true, submitBehavior: "newline", accessibilityHint: "Write your message, then use Send direct message. Return adds a new line. Use @ to mention someone." } : {})}
            maxLength={1000}
            accessibilityLabel={unavailable ? "Wait for another message to finish sending" : `Message ${other?.name || "this member"}`}
          />
          <Pressable
            style={[styles.sendBtn, sending && { opacity: 0.65 }]}
            onPress={send}
            disabled={sending || unavailable || !text.trim()}
            accessibilityRole="button"
            accessibilityLabel={`Send direct message to ${other?.name || "this member"}`}
            accessibilityState={{ disabled: sending || unavailable || !text.trim(), busy: sending }}
          >
            <Icon name="chevron-right" size={20} color="#1A1206" />
          </Pressable>
        </View>
      ) : (
        <Text style={styles.login}>Log in to message.</Text>
      )}
      </ThreadBody>
    </ThreadContainer>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, minHeight: 0 },
  history: { flex: 1, minHeight: 0 },
  chat: { padding: 16, paddingBottom: 24, gap: 10 },
  relationshipCard: { alignSelf: "stretch", gap: 7, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev, paddingHorizontal: 12, paddingVertical: 10 },
  relationshipChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  relationshipChip: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: 8, paddingVertical: 3 },
  relationshipChipText: { color: colors.amber, fontSize: 10, fontWeight: "800" },
  relationshipSummary: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  empty: { color: colors.textDim, fontSize: 13, fontStyle: "italic", textAlign: "center", marginTop: 20 },
  readFeedback: { alignItems: "center", gap: 8, paddingVertical: 16, paddingHorizontal: 12 },
  readText: { color: colors.textDim, fontSize: 14, textAlign: "center", lineHeight: 20 },
  retryRead: { minHeight: 44, paddingHorizontal: 18, justifyContent: "center" },
  retryReadText: { color: colors.amber, fontSize: 14, fontWeight: "800" },
  row: { maxWidth: "82%", alignSelf: "flex-start" },
  rowMine: { alignSelf: "flex-end" },
  rowIOS: { maxWidth: "100%", alignSelf: "stretch", flexDirection: "row", alignItems: "flex-start", gap: 8 },
  rowMineIOS: { justifyContent: "flex-end" },
  messageAvatar: { paddingTop: 4 },
  messageColumn: { maxWidth: "82%", minWidth: 0, flexShrink: 1, alignItems: "flex-start" },
  messageColumnMine: { alignItems: "flex-end" },
  bubbleIOS: { maxWidth: "100%", paddingHorizontal: 12, paddingVertical: 8 },
  msgFootIOS: { minHeight: 0, maxWidth: "100%", flexWrap: "wrap", marginTop: 4, gap: 6 },
  bubbleMineIOS: { backgroundColor: colors.amberStrong, borderColor: colors.amberStrong },
  mentionMineIOS: { color: "#1A1206", textDecorationLine: "underline" },
  deliveryMineIOS: { color: colors.textDim },
  deliveryFailedIOS: { color: colors.magenta },
  deliveryActionIOS: { color: colors.amber },
  deliveryActionsIOS: { flexWrap: "wrap", flexShrink: 1 },
  deliveryButtonIOS: { marginVertical: 0 },
  reportBtnIOS: { marginVertical: 0, marginRight: 0 },
  bubble: { backgroundColor: colors.surface, borderRadius: 16, borderTopLeftRadius: 4, borderWidth: 1, borderColor: colors.lineSoft, paddingHorizontal: 13, paddingVertical: 9 },
  bubbleMine: { backgroundColor: colors.amber, borderColor: colors.amber, borderTopLeftRadius: 16, borderTopRightRadius: 4 },
  bubbleFailed: { borderColor: colors.magenta, borderWidth: 1.5 },
  msgText: { color: colors.text, fontSize: 15, lineHeight: 20 },
  msgFoot: { minHeight: 24, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, marginTop: 3 },
  ts: { color: colors.textFaint, fontSize: 10, fontFamily: mono },
  deliveryMine: { color: "rgba(26,18,6,0.65)", fontSize: 10, fontFamily: mono },
  deliveryActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  deliveryFailed: { color: "#7B1836", fontSize: 10, fontFamily: mono, fontWeight: "800" },
  deliveryAction: { color: "#1A1206", fontSize: 11, fontWeight: "900", textDecorationLine: "underline" },
  deliveryButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", marginVertical: -10 },
  reportBtn: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", marginVertical: -10, marginRight: -5 },
  profileButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  inputBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 8, paddingBottom: Platform.OS === "ios" ? 24 : 12, borderTopWidth: 1, borderTopColor: colors.lineSoft, backgroundColor: colors.bgElev },
  inputBarIOS: { alignItems: "flex-end", paddingBottom: 8, flexShrink: 0 },
  inputIOS: { minHeight: 44, borderRadius: 22, paddingVertical: 10, fontSize: 16, lineHeight: 22, textAlignVertical: "top" },
  input: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 16, paddingVertical: 11, fontSize: 15 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center" },
  login: { color: colors.textDim, textAlign: "center", padding: 16, fontStyle: "italic" },
});
