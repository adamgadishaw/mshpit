import { useState, useEffect, useRef } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import MentionText from "../components/MentionText";
import useLiveChat from "../lib/useLiveChat";
import useChatScroll from "../lib/useChatScroll";
import { accountTargetScope, scopedScreenValue } from "../domain/screenScope.mjs";

const EMPTY_COMPOSER = Object.freeze({ text: "", sending: false });

export default function ThreadScreen({ otherId, onClose, onOpenProfile, onOpenProfileByHandle, onReport }) {
  const {
    session, chatAuthEpoch, userById, threadMessages, sendDM, retryChatMessage,
    cancelChatMessage, loadThread, markThreadRead, loadUser,
  } = useStore();
  const other = userById(otherId);
  const composerScope = accountTargetScope(session?.id, `dm:${otherId || ""}`);
  const composerScopeRef = useRef(composerScope);
  composerScopeRef.current = composerScope;
  const [composerState, setComposerState] = useState(() => ({ scope: composerScope, value: EMPTY_COMPOSER }));
  const { text, sending } = scopedScreenValue(composerState, composerScope, EMPTY_COMPOSER);
  const updateComposer = (changes) => setComposerState((current) => ({
    scope: composerScope,
    value: { ...scopedScreenValue(current, composerScope, EMPTY_COMPOSER), ...changes },
  }));
  const { scrollRef, onScroll, onContentSizeChange } = useChatScroll();
  const messages = threadMessages(otherId);

  useEffect(() => {
    setComposerState({ scope: composerScope, value: EMPTY_COMPOSER });
  }, [composerScope]);

  useLiveChat(
    ({ after, signal }) => loadThread(otherId, { after, signal }),
    { channelKey: `dm:${chatAuthEpoch}:${session?.id || "guest"}:${otherId}`, enabled: !!session && !!otherId },
  );
  // A DM notification can open a chat with someone this device never cached;
  // fetch them so the name + avatar resolve instead of a nameless "Chat".
  useEffect(() => { if (otherId && !userById(otherId)) loadUser(otherId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [otherId]);
  useEffect(() => { markThreadRead(otherId); }, [otherId, messages.length]);

  const send = async () => {
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
    const requestScope = composerScope;
    const result = await retryChatMessage(message.id);
    if (result?.ok && composerScopeRef.current === requestScope) {
      setComposerState((current) => {
        const value = scopedScreenValue(current, requestScope, EMPTY_COMPOSER);
        return { scope: requestScope, value: { ...value, text: value.text.trim() === message.text ? "" : value.text } };
      });
    }
  };
  const onMention = (h) => onOpenProfileByHandle?.(h);

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScreenHeader kicker="DIRECT MESSAGE" title={other?.name || "Chat"} onBack={onClose}
        right={<Pressable onPress={() => onOpenProfile?.(otherId)}><Avatar user={other} size={32} /></Pressable>} />

      <ScrollView ref={scrollRef} contentContainerStyle={styles.chat} showsVerticalScrollIndicator={false}
        onScroll={onScroll} onContentSizeChange={onContentSizeChange} scrollEventThrottle={100}>
        {messages.length === 0 && <Text style={styles.empty}>Say hi to {other?.name?.split(" ")[0]}.</Text>}
        {messages.map((m) => {
          const mine = m.from === session?.id;
          return (
            <View key={m.id} style={[styles.row, mine && styles.rowMine]}>
              <View style={[styles.bubble, mine && styles.bubbleMine, m.failed && styles.bubbleFailed]}>
                <MentionText text={m.text} style={[styles.msgText, mine && { color: "#1A1206" }]} onMention={onMention} />
                <View style={styles.msgFoot}>
                  <Text style={[styles.ts, mine && { color: "rgba(26,18,6,0.6)" }]}>{m.ts}</Text>
                  {mine && m.pending ? <Text style={styles.deliveryMine} accessibilityLiveRegion="polite">sending…</Text> : null}
                  {mine && m.failed ? (
                    <View style={styles.deliveryActions}>
                      <Text style={styles.deliveryFailed} accessibilityRole="alert" accessibilityLiveRegion="assertive" accessibilityLabel="Direct message not sent">not sent</Text>
                      <Pressable onPress={() => retry(m)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Retry direct message">
                        <Text style={styles.deliveryAction}>retry</Text>
                      </Pressable>
                      <Pressable onPress={() => cancelChatMessage(m.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel failed direct message">
                        <Text style={styles.deliveryAction}>cancel</Text>
                      </Pressable>
                    </View>
                  ) : null}
                  {!mine && onReport ? (
                    <Pressable
                      style={styles.reportBtn}
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
                  ) : null}
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {session ? (
        <View style={styles.inputBar}>
          <TextInput style={styles.input} placeholder={`Message ${other?.name?.split(" ")[0] || ""}…  (use @ to tag)`} placeholderTextColor={colors.textFaint} value={text} onChangeText={(value) => updateComposer({ text: value })} onSubmitEditing={send} returnKeyType="send" maxLength={1000} />
          <Pressable
            style={[styles.sendBtn, sending && { opacity: 0.65 }]}
            onPress={send}
            disabled={sending || !text.trim()}
            accessibilityRole="button"
            accessibilityLabel={`Send direct message to ${other?.name || "this member"}`}
            accessibilityState={{ disabled: sending || !text.trim(), busy: sending }}
          >
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
  bubbleFailed: { borderColor: colors.magenta, borderWidth: 1.5 },
  msgText: { color: colors.text, fontSize: 15, lineHeight: 20 },
  msgFoot: { minHeight: 24, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, marginTop: 3 },
  ts: { color: colors.textFaint, fontSize: 10, fontFamily: mono },
  deliveryMine: { color: "rgba(26,18,6,0.65)", fontSize: 10, fontFamily: mono },
  deliveryActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  deliveryFailed: { color: "#7B1836", fontSize: 10, fontFamily: mono, fontWeight: "800" },
  deliveryAction: { color: "#1A1206", fontSize: 11, fontWeight: "900", textDecorationLine: "underline" },
  reportBtn: { minWidth: 28, minHeight: 28, alignItems: "center", justifyContent: "center", marginVertical: -4, marginRight: -5 },
  inputBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 8, paddingBottom: Platform.OS === "ios" ? 24 : 12, borderTopWidth: 1, borderTopColor: colors.lineSoft, backgroundColor: colors.bgElev },
  input: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 16, paddingVertical: 11, fontSize: 15 },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center" },
  login: { color: colors.textDim, textAlign: "center", padding: 16, fontStyle: "italic" },
});
