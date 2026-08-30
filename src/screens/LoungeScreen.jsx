import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore, isStaff } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import MentionText from "../components/MentionText";
import useLiveChat from "../lib/useLiveChat";
import useChatScroll from "../lib/useChatScroll";
import { api } from "../lib/api";
import { accountTargetScope, scopedScreenValue } from "../domain/screenScope.mjs";
import { normalizeLoungeMeta } from "../domain/showSocial.mjs";
import VinylRefreshBoundary from "../components/VinylRefreshBoundary";
import useScopedRefresh from "../hooks/useScopedRefresh";
import { refreshScope } from "../domain/scopedRefresh.mjs";

const EMPTY_LOUNGE_ACTIONS = Object.freeze({ enteredRoom: null, entering: false, sending: false, text: "" });

// One persistent Lounge belongs to this exact show before, during, and after.
// Gated: you have to tap in, so conversation reads and polling stay off until
// the member deliberately enters the room.
export default function LoungeScreen({ log, onClose, onOpenProfile, onOpenProfileByHandle, onOpenFanClub, onReport }) {
  const {
    session, chatAuthEpoch, concertKey, loungeFor, enterLounge, addLoungeMessage,
    retryChatMessage, cancelChatMessage, loadLounge, attendeesFor, userById, removeLoungeMessage,
    clearLounge,
  } = useStore();
  const staff = isStaff(session?.role);
  const key = concertKey(log);
  const roomIdentity = session && key ? `${session.id}:${key}` : null;
  const actionScope = accountTargetScope(session?.id, `lounge:${key || ""}`);
  const actionScopeRef = useRef(actionScope);
  actionScopeRef.current = actionScope;
  const [actionState, setActionState] = useState(() => ({ scope: actionScope, value: EMPTY_LOUNGE_ACTIONS }));
  const { enteredRoom, entering, sending, text } = scopedScreenValue(actionState, actionScope, EMPTY_LOUNGE_ACTIONS);
  const updateActions = (changes) => setActionState((current) => ({
    scope: actionScope,
    value: { ...scopedScreenValue(current, actionScope, EMPTY_LOUNGE_ACTIONS), ...changes },
  }));
  const entered = !!roomIdentity && enteredRoom === roomIdentity;
  const [gateMeta, setGateMeta] = useState(null);
  const [metaRefresh, setMetaRefresh] = useState(0);
  const { scrollRef, onScroll, onContentSizeChange } = useChatScroll();
  const messages = loungeFor(key);
  const attendees = attendeesFor(key);
  const currentGateMeta = gateMeta?.key === key ? gateMeta : null;
  const loungeOpen = currentGateMeta?.status === "open";

  const readLoungeMessages = async ({ after, signal, strict = false }) => {
      const result = await loadLounge(key, { after, signal, strict });
      if (result?.closed && !signal?.aborted) {
        clearLounge(key);
        setGateMeta((current) => current?.key === key
          ? { ...current, status: "closed", messageCount: 0 }
          : current);
      }
      return result;
  };
  useLiveChat(
    readLoungeMessages,
    {
      channelKey: `lounge:${chatAuthEpoch}:${session?.id || "guest"}:${key}`,
      enabled: !!key && entered && loungeOpen,
    },
  );
  const loungeRefreshScope = refreshScope(session?.id, "lounge", `${chatAuthEpoch}:${key}`);
  const { refresh: refreshLounge, refreshing: loungeRefreshing } = useScopedRefresh({
    scope: loungeRefreshScope,
    enabled: !!key && entered && loungeOpen,
    task: ({ signal }) => readLoungeMessages({ signal, strict: true }),
  });

  useEffect(() => {
    setActionState({ scope: actionScope, value: EMPTY_LOUNGE_ACTIONS });
  }, [actionScope]);

  // The gate reads aggregate-only metadata. Conversation polling remains off
  // until this account's attendance write has been confirmed by the server.
  useEffect(() => {
    if (!key) return undefined;
    const controller = new AbortController();
    setGateMeta({ key, status: "loading" });
    api(`/api/lounges/${encodeURIComponent(key)}/meta`, {
      signal: controller.signal,
      silent: true,
      context: "Loading concert-lounge details",
    })
      .then((payload) => {
        if (controller.signal.aborted) return;
        const meta = normalizeLoungeMeta(payload);
        if (!meta) {
          setGateMeta({ key, status: "error" });
          return;
        }
        const alreadyClosed = meta.cutoffAt != null && Date.now() >= meta.cutoffAt;
        setGateMeta({ ...meta, key, status: alreadyClosed ? "closed" : meta.status });
      })
      .catch(() => {
        if (!controller.signal.aborted) setGateMeta({ key, status: "error" });
      });
    return () => controller.abort();
  }, [key, entered, metaRefresh, session?.id]);

  // The server is authoritative, while this timer closes an already-open screen
  // at the exact same instant and disables useLiveChat before another poll can
  // be scheduled. Long-future rooms use one bounded native timer, not an interval.
  useEffect(() => {
    if (!key || currentGateMeta?.status !== "open" || currentGateMeta.cutoffAt == null) return undefined;
    let timer;
    const arm = () => {
      const remaining = currentGateMeta.cutoffAt - Date.now();
      if (remaining <= 0) {
        clearLounge(key);
        setGateMeta((current) => current?.key === key
          ? { ...current, status: "closed", messageCount: 0 }
          : current);
        return;
      }
      timer = setTimeout(arm, Math.min(remaining, 2_147_000_000));
    };
    arm();
    return () => clearTimeout(timer);
  }, [clearLounge, currentGateMeta?.cutoffAt, currentGateMeta?.status, key]);

  const enter = async () => {
    if (entering || !session || !roomIdentity || !loungeOpen) return;
    const requestScope = actionScope;
    updateActions({ entering: true });
    const result = await enterLounge(log);
    if (actionScopeRef.current !== requestScope) return;
    updateActions({ enteredRoom: result?.ok && !result?.guest ? roomIdentity : null, entering: false });
  };

  if (currentGateMeta?.status === "closed") {
    const fanClubArtist = currentGateMeta.fanClubArtist || log.artist;
    const fallbackCopy = currentGateMeta.cutoffSource === "show_start"
      ? "Doors time was not available, so this Lounge closed 24 hours after show start."
      : "This Lounge closed 24 hours after doors opened.";
    return (
      <View style={styles.wrap}>
        <ScreenHeader kicker="LOUNGE CLOSED" title={log.artist} onBack={onClose} />
        <View style={styles.gate} accessibilityRole="summary">
          <View style={styles.gateIcon}><Icon name="lock" size={30} color={colors.amber} /></View>
          <Text style={styles.gateTitle}>This show's Lounge has closed</Text>
          <Text style={styles.gateSub}>{fallbackCopy}</Text>
          <Text style={styles.gateNote}>The conversation is no longer public. Moderation records stay protected for authorized review.</Text>
          {fanClubArtist && onOpenFanClub ? (
            <Pressable
              style={styles.enterBtn}
              onPress={() => onOpenFanClub(fanClubArtist)}
              accessibilityRole="button"
              accessibilityLabel={`Open the ${fanClubArtist} Fan Club`}
            >
              <Text style={styles.enterTxt}>Continue in the artist Fan Club</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  const send = async () => {
    const submitted = text;
    const draft = submitted.trim();
    if (!draft || sending) return;
    const requestScope = actionScope;
    updateActions({ sending: true });
    const result = await addLoungeMessage(key, draft);
    if (actionScopeRef.current !== requestScope) return;
    setActionState((current) => {
      const value = scopedScreenValue(current, requestScope, EMPTY_LOUNGE_ACTIONS);
      return { scope: requestScope, value: { ...value, text: result?.ok && value.text === submitted ? "" : value.text, sending: false } };
    });
  };
  const retry = async (message) => {
    const requestScope = actionScope;
    const result = await retryChatMessage(message.id);
    if (result?.ok && actionScopeRef.current === requestScope) {
      setActionState((current) => {
        const value = scopedScreenValue(current, requestScope, EMPTY_LOUNGE_ACTIONS);
        return { scope: requestScope, value: { ...value, text: value.text.trim() === message.text ? "" : value.text } };
      });
    }
  };

  if (!entered) {
    return (
      <View style={styles.wrap}>
        <ScreenHeader kicker="LOUNGE" title={log.artist} onBack={onClose} />
        <View style={styles.gate}>
          <View style={styles.gateIcon}><Icon name="comment" size={30} color={colors.amber} /></View>
          <Text style={styles.gateTitle}>Concert Lounge</Text>
          <Text style={styles.gateSub}>
            One room for this exact show — before, during, and after.{"\n"}
            <Text style={{ color: colors.text, fontWeight: "700" }}>{log.artist}</Text> · {log.venue}
          </Text>
          {currentGateMeta?.status === "error" ? (
            <Pressable style={styles.retryBtn} onPress={() => setMetaRefresh((value) => value + 1)} accessibilityRole="button">
              <Text style={styles.retryTxt}>Try checking the Lounge again</Text>
            </Pressable>
          ) : (
            <>
              <Text style={styles.gateMeta}>{currentGateMeta?.messageCount ?? messages.length} messages · {currentGateMeta?.attendeeCount ?? attendees.length} going</Text>
              <Pressable style={[styles.enterBtn, (entering || !session || !loungeOpen) && { opacity: 0.65 }]} onPress={enter} disabled={entering || !session || !loungeOpen} accessibilityRole="button" accessibilityState={{ disabled: entering || !session || !loungeOpen, busy: entering }}>
                <Text style={styles.enterTxt}>{!session ? "Log in to enter the Lounge" : !loungeOpen ? "Checking this Lounge…" : entering ? "Saving your spot…" : "I'm going — enter this show's Lounge"}</Text>
              </Pressable>
            </>
          )}
          <Text style={styles.gateNote}>This is the only Lounge for this show. Be decent; moderators can remove messages.</Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScreenHeader kicker={`LOUNGE · ${log.venue}`} title={log.artist} onBack={onClose} />
      <VinylRefreshBoundary
        refreshing={loungeRefreshing}
        onRefresh={refreshLounge}
        accessibilityLabel={`Refresh the ${log.artist} concert Lounge`}
      >
      <ScrollView ref={scrollRef} contentContainerStyle={styles.chat} showsVerticalScrollIndicator={false}
        onScroll={onScroll} onContentSizeChange={onContentSizeChange} scrollEventThrottle={100}>
        {messages.length === 0 && <Text style={styles.empty}>No messages yet - say hi.</Text>}
        {messages.map((m) => {
          const mine = m.userId === session?.id;
          const u = userById(m.userId) || { initials: m.initials, name: m.name };
          return (
            <View key={m.id} style={[styles.msgRow, mine && styles.msgRowMine]}>
              {!mine && <Avatar user={u} size={30} onPress={() => onOpenProfile?.(m.userId)} />}
              <View style={[styles.bubble, mine && styles.bubbleMine, m.failed && styles.bubbleFailed]}>
                {!mine && <Text style={styles.msgName}>{m.name}</Text>}
                <MentionText text={m.text} style={[styles.msgText, mine && { color: "#1A1206" }]} onMention={onOpenProfileByHandle} />
                <View style={styles.msgFoot}>
                  <Text style={[styles.msgTs, mine && { color: "rgba(26,18,6,0.6)" }]}>{m.ts}</Text>
                  {mine && m.pending ? <Text style={styles.deliveryMine} accessibilityLiveRegion="polite">sending…</Text> : null}
                  {mine && m.failed ? (
                    <View style={styles.deliveryActions}>
                      <Text style={styles.deliveryFailed} accessibilityRole="alert" accessibilityLiveRegion="assertive" accessibilityLabel="Lounge message not sent">not sent</Text>
                      <Pressable onPress={() => retry(m)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Retry lounge message">
                        <Text style={styles.deliveryAction}>retry</Text>
                      </Pressable>
                      <Pressable onPress={() => cancelChatMessage(m.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel failed lounge message">
                        <Text style={styles.deliveryAction}>cancel</Text>
                      </Pressable>
                    </View>
                  ) : null}
                  {!mine && onReport ? (
                    <Pressable
                      style={styles.reportBtn}
                      onPress={() => onReport({
                        targetType: "lounge_message",
                        targetId: m.id,
                        ownerId: m.userId,
                        targetName: "lounge message",
                        title: `${m.name || "A member"} in the ${log.artist} lounge`,
                        summary: m.text,
                      })}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Report ${m.name || "this member"}'s lounge message`}
                    >
                      <Icon name="flag" size={12} color={mine ? "rgba(26,18,6,0.6)" : colors.textFaint} />
                    </Pressable>
                  ) : null}
                  {staff && !m.pending && !m.failed && (
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
      </VinylRefreshBoundary>

      {session ? (
        <View style={styles.inputBar}>
          <TextInput style={styles.input} placeholder="Message the lounge…" placeholderTextColor={colors.textFaint} value={text} onChangeText={(value) => updateActions({ text: value })} onSubmitEditing={send} returnKeyType="send" maxLength={1000} />
          <Pressable
            style={[styles.sendBtn, sending && { opacity: 0.65 }]}
            onPress={send}
            disabled={sending || !text.trim()}
            accessibilityRole="button"
            accessibilityLabel={`Send message to the ${log.artist} lounge`}
            accessibilityState={{ disabled: sending || !text.trim(), busy: sending }}
          >
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
  retryBtn: { minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", marginTop: 12 },
  retryTxt: { color: colors.amber, fontSize: 14, fontWeight: "800" },

  chat: { padding: 16, paddingBottom: 24, gap: 12 },
  empty: { color: colors.textDim, fontSize: 13, fontStyle: "italic", textAlign: "center", marginTop: 20 },
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, maxWidth: "85%" },
  msgRowMine: { alignSelf: "flex-end", flexDirection: "row-reverse" },
  bubble: { backgroundColor: colors.surface, borderRadius: 14, borderTopLeftRadius: 4, borderWidth: 1, borderColor: colors.lineSoft, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMine: { backgroundColor: colors.amber, borderColor: colors.amber, borderTopLeftRadius: 14, borderTopRightRadius: 4 },
  bubbleFailed: { borderColor: colors.magenta, borderWidth: 1.5 },
  msgName: { color: colors.amber, fontSize: 11, fontWeight: "800", marginBottom: 2 },
  msgText: { color: colors.text, fontSize: 14, lineHeight: 19 },
  msgFoot: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-end", marginTop: 3 },
  msgTs: { color: colors.textFaint, fontSize: 10, fontFamily: mono },
  deliveryMine: { color: "rgba(26,18,6,0.65)", fontSize: 10, fontFamily: mono },
  deliveryActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  deliveryFailed: { color: "#7B1836", fontSize: 10, fontFamily: mono, fontWeight: "800" },
  deliveryAction: { color: "#1A1206", fontSize: 11, fontWeight: "900", textDecorationLine: "underline" },
  reportBtn: { minWidth: 28, minHeight: 28, alignItems: "center", justifyContent: "center", marginVertical: -4 },
  inputBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 8, paddingBottom: Platform.OS === "ios" ? 24 : 12, borderTopWidth: 1, borderTopColor: colors.lineSoft, backgroundColor: colors.bgElev },
  input: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 16, paddingVertical: 11, fontSize: 15 },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center" },
  loginNote: { color: colors.textDim, textAlign: "center", padding: 16, fontStyle: "italic" },
});
