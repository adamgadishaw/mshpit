import { useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { colors, mono, radius, space } from "../theme";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";

const ago = (ts) => {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

const META = {
  follow: { icon: "you", tint: colors.cool, verb: "started following you" },
  like: { icon: "heart", tint: colors.magenta, verb: "liked your review" },
  comment: { icon: "comment", tint: colors.amber, verb: "commented on your review" },
  dm: { icon: "mail", tint: colors.good, verb: "sent you a message" },
  welcome: { icon: "star", tint: colors.amber, verb: "" },
};

// The activity feed, the social heartbeat that connects follows, likes, comments
// and DMs into one place instead of leaving them scattered across the app.
export default function NotificationsScreen({ onClose, onOpenProfile, onOpenThread, onOpen, onOpenPost }) {
  const { myNotifications, markNotificationsRead, feed } = useStore();
  const items = myNotifications();

  // Mark everything read when the screen opens (badge clears).
  useEffect(() => { markNotificationsRead(); }, []);

  // Tapping the ROW goes to the thing the notification is about; tapping the
  // AVATAR always goes to the person who did it.
  const open = (n) => {
    if (n.type === "welcome") return;
    if (n.type === "follow") return onOpenProfile?.(n.actorId);
    if (n.type === "dm") return onOpenThread?.(n.actorId);
    // Likes/comments are about YOUR post — open the post (+ its comments), not the
    // performance page it happened to review.
    if (n.type === "like" || n.type === "comment") {
      const log = feed.find((l) => l.id === n.postId);
      if (log) return onOpenPost?.(log);
    }
    onOpenProfile?.(n.actorId);
  };

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker="SOCIAL" title="Activity" onBack={onClose} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {items.length === 0 && (
          <View style={styles.empty}>
            <Icon name="heart" size={28} color={colors.textFaint} />
            <Text style={styles.emptyTitle}>No activity yet</Text>
            <Text style={styles.emptySub}>When people follow you, like your reviews, comment, or message you, it shows up here.</Text>
          </View>
        )}
        {items.map((n) => {
          const meta = META[n.type] || META.like;
          return (
            <Pressable key={n.id} style={[styles.row, !n.read && styles.rowUnread]} onPress={() => open(n)}>
              <View style={styles.avatarWrap}>
                <Avatar user={{ name: n.actorName, initials: n.actorInitials, avatarUri: n.actorUri, avatarColor: n.actorColor }} size={40} onPress={n.actorId ? () => onOpenProfile?.(n.actorId) : undefined} />
                <View style={[styles.badge, { backgroundColor: meta.tint }]}>
                  <Icon name={meta.icon} size={11} color="#0B0E16" filled />
                </View>
              </View>
              <View style={{ flex: 1 }}>
                {n.type === "welcome" ? (
                  <Text style={styles.text}>
                    <Text style={styles.who}>Welcome to Pit! </Text>
                    Follow people whose taste matches yours, log the shows you go to, and rate the band vs. the room.
                  </Text>
                ) : (
                  <Text style={styles.text}>
                    <Text style={styles.who}>{n.actorName}</Text> {meta.verb}
                    {(n.type === "like" || n.type === "comment") && n.artist ? <Text style={styles.ref}> of {n.artist}</Text> : null}
                  </Text>
                )}
                {n.type === "comment" && n.text ? <Text style={styles.preview} numberOfLines={1}>“{n.text}”</Text> : null}
                {n.type === "dm" && n.text ? <Text style={styles.preview} numberOfLines={1}>“{n.text}”</Text> : null}
              </View>
              <Text style={styles.time}>{ago(n.ts)}</Text>
              {!n.read && <View style={styles.dot} />}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), paddingBottom: space(10) },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: radius.md, marginBottom: 4 },
  rowUnread: { backgroundColor: colors.bgElev },
  avatarWrap: { width: 40, height: 40 },
  badge: { position: "absolute", right: -3, bottom: -3, width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.bg, alignItems: "center", justifyContent: "center" },
  text: { color: colors.text, fontSize: 14, lineHeight: 20 },
  who: { fontWeight: "800" },
  ref: { color: colors.amber, fontWeight: "600" },
  preview: { color: colors.textDim, fontSize: 13, marginTop: 2, fontStyle: "italic" },
  time: { color: colors.textFaint, fontFamily: mono, fontSize: 11 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.amberStrong },
  empty: { alignItems: "center", gap: 8, paddingTop: 60, paddingHorizontal: 30 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "800", marginTop: 6 },
  emptySub: { color: colors.textDim, fontSize: 14, textAlign: "center", lineHeight: 20 },
});
