import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore } from "../store";
import { artistMeta } from "../seed/ingested";
import ScreenHeader from "../components/ScreenHeader";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import MentionText from "../components/MentionText";
import SpinningRecord from "../components/SpinningRecord";
import useLiveChat from "../lib/useLiveChat";
import useChatScroll from "../lib/useChatScroll";
import { api } from "../lib/api";

// The artist Fan Club - a permanent chat for fans, even with no show coming up.
export default function FanClubScreen({ artist, onClose, onOpenProfile, onOpenProfileByHandle, onReport }) {
  const { session, userById, fanClubFor, loadFanClub, addFanClubMessage, isFanClubMember, joinFanClub, fanClubCount } = useStore();
  const [text, setText] = useState("");
  const [joining, setJoining] = useState(false);
  const [sending, setSending] = useState(false);
  const [gateMeta, setGateMeta] = useState(null);
  const { scrollRef, onScroll, onContentSizeChange } = useChatScroll();
  const messages = fanClubFor(artist);
  const member = isFanClubMember(artist);
  useLiveChat(
    ({ after, signal }) => loadFanClub(artist, { after, signal }),
    { channelKey: `fan-club:${artist}`, enabled: !!artist && member },
  );
  const artistKey = String(artist || "").trim().toLowerCase();
  const currentGateMeta = gateMeta?.key === artistKey ? gateMeta : null;

  // Non-members only receive aggregate gate metadata; message polling starts
  // after the server-confirmed join updates membership in the store.
  useEffect(() => {
    if (!artistKey || member) return undefined;
    const controller = new AbortController();
    api(`/api/fanclubs/${encodeURIComponent(artistKey)}/meta`, {
      signal: controller.signal,
      silent: true,
      context: "Loading fan-club details",
    })
      .then(({ members, messageCount }) => {
        if (!controller.signal.aborted) setGateMeta({ key: artistKey, members, messageCount });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [artistKey, member]);

  const art = artistMeta(artist)?.photo;

  const toggleMembership = async () => {
    if (joining) return;
    setJoining(true);
    await joinFanClub(artist);
    setJoining(false);
  };

  const send = async () => {
    const submitted = text;
    const draft = submitted.trim();
    if (!draft || sending) return;
    setSending(true);
    const result = await addFanClubMessage(artist, draft);
    if (result?.ok) setText((current) => current === submitted ? "" : current);
    setSending(false);
  };

  if (!member) {
    return (
      <View style={styles.wrap}>
        <ScreenHeader kicker="FAN CLUB" title={artist} onBack={onClose} />
        <View style={styles.gate}>
          <SpinningRecord size={92} playing color={colors.amberStrong} art={art} />
          <Text style={styles.gateTitle}>{artist} Fan Club</Text>
          <Text style={styles.gateSub}>Talk to other fans, swap shows, plan trips. No ticket needed.</Text>
          <Text style={styles.gateMeta}>{currentGateMeta?.members ?? fanClubCount(artist)} members · {currentGateMeta?.messageCount ?? messages.length} messages</Text>
          {session ? (
            <Pressable style={[styles.joinBtn, joining && { opacity: 0.65 }]} onPress={toggleMembership} disabled={joining}>
              <Icon name="user-plus" size={16} color="#1A1206" />
              <Text style={styles.joinTxt}>{joining ? "Joining…" : "Join the fan club"}</Text>
            </Pressable>
          ) : (
            <Text style={styles.gateNote}>Log in to join.</Text>
          )}
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScreenHeader kicker={`FAN CLUB · ${fanClubCount(artist)} members`} title={artist} onBack={onClose}
        right={<Pressable onPress={toggleMembership} disabled={joining}><Text style={styles.leave}>{joining ? "leaving…" : "leave"}</Text></Pressable>} />
      <ScrollView ref={scrollRef} contentContainerStyle={styles.chat} showsVerticalScrollIndicator={false}
        onScroll={onScroll} onContentSizeChange={onContentSizeChange} scrollEventThrottle={100}>
        {messages.length === 0 && <Text style={styles.empty}>Be the first to post.</Text>}
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
                  {!mine && onReport ? (
                    <Pressable
                      style={styles.reportBtn}
                      onPress={() => onReport({
                        targetType: "fan_message",
                        targetId: m.id,
                        ownerId: m.userId,
                        targetName: "fan-club message",
                        title: `${m.name || "A member"} in the ${artist} fan club`,
                        summary: m.text,
                      })}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Report ${m.name || "this member"}'s fan-club message`}
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
      {session && (
        <View style={styles.inputBar}>
          <TextInput style={styles.input} placeholder={`Message the ${artist} fan club…`} placeholderTextColor={colors.textFaint} value={text} onChangeText={setText} onSubmitEditing={send} returnKeyType="send" maxLength={1000} />
          <Pressable style={[styles.sendBtn, sending && { opacity: 0.65 }]} onPress={send} disabled={sending}><Icon name="chevron-right" size={20} color="#1A1206" /></Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  gate: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 12 },
  gateTitle: { color: colors.text, fontSize: 24, fontWeight: "900", marginTop: 8 },
  gateSub: { color: colors.textDim, fontSize: 15, lineHeight: 22, textAlign: "center" },
  gateMeta: { color: colors.textFaint, fontFamily: mono, fontSize: 12 },
  joinBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 26, marginTop: 6 },
  joinTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800" },
  gateNote: { color: colors.textDim, fontStyle: "italic" },
  leave: { color: colors.textDim, fontSize: 13 },
  chat: { padding: 16, paddingBottom: 24, gap: 12 },
  empty: { color: colors.textDim, fontSize: 13, fontStyle: "italic", textAlign: "center", marginTop: 20 },
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, maxWidth: "85%" },
  msgRowMine: { alignSelf: "flex-end", flexDirection: "row-reverse" },
  bubble: { backgroundColor: colors.surface, borderRadius: 14, borderTopLeftRadius: 4, borderWidth: 1, borderColor: colors.lineSoft, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMine: { backgroundColor: colors.amber, borderColor: colors.amber, borderTopLeftRadius: 14, borderTopRightRadius: 4 },
  msgName: { color: colors.amber, fontSize: 11, fontWeight: "800", marginBottom: 2 },
  msgText: { color: colors.text, fontSize: 14, lineHeight: 19 },
  msgFoot: { minHeight: 24, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, marginTop: 3 },
  msgTs: { color: colors.textFaint, fontSize: 10, fontFamily: mono },
  reportBtn: { minWidth: 28, minHeight: 28, alignItems: "center", justifyContent: "center", marginVertical: -4, marginRight: -5 },
  inputBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 8, paddingBottom: Platform.OS === "ios" ? 24 : 12, borderTopWidth: 1, borderTopColor: colors.lineSoft, backgroundColor: colors.bgElev },
  input: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 16, paddingVertical: 11, fontSize: 15 },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center" },
});
