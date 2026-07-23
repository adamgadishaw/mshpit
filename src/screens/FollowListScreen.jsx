import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { colors, radius, space } from "../theme";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import { BadgeRow } from "../components/Badge";

// The real list behind the FOLLOWERS / FOLLOWING numbers on a profile. Tap a row
// to open that person, follow back inline.
export default function FollowListScreen({ userId, mode = "followers", onClose, onOpenProfile }) {
  const { session, userById, followersOf, followingOf, isFollowing, follow, unfollow, userBadges } = useStore();
  const owner = userById(userId);
  const [list, setList] = useState(null); // null = loading
  useEffect(() => {
    setList(null);
    (mode === "followers" ? followersOf(userId) : followingOf(userId)).then(setList);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, mode]);

  const title = mode === "followers" ? "Followers" : "Following";

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker={owner ? `@${owner.handle}` : "PROFILE"} title={title} onBack={onClose} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {list === null && <Text style={styles.hint}>Loading...</Text>}
        {list !== null && list.length === 0 && (
          <View style={styles.empty}>
            <Icon name="you" size={26} color={colors.textFaint} />
            <Text style={styles.emptyTitle}>{mode === "followers" ? "No followers yet" : "Not following anyone yet"}</Text>
            <Text style={styles.emptySub}>{mode === "followers" ? "When people follow this account they show up here." : "Accounts this person follows will show up here."}</Text>
          </View>
        )}
        {(list || []).map((u) => {
          const self = session?.id === u.id;
          const fol = isFollowing(u.id);
          return (
            <View key={u.id} style={styles.row}>
              <Pressable style={styles.rowMain} onPress={() => onOpenProfile?.(u.id)}>
                <Avatar user={u} size={42} />
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name} numberOfLines={1}>{u.name}</Text>
                    <BadgeRow badges={userBadges(u)} size={14} />
                  </View>
                  <Text style={styles.handle} numberOfLines={1}>@{u.handle}{u.home?.city ? ` · ${u.home.city}` : ""}</Text>
                </View>
              </Pressable>
              {session && !self && (
                <Pressable style={[styles.followBtn, fol && styles.followingBtn]} onPress={() => (fol ? unfollow(u.id) : follow(u.id))}>
                  <Text style={[styles.followTxt, fol && styles.followingTxt]}>{fol ? "Following" : "Follow"}</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), paddingBottom: space(10) },
  hint: { color: colors.textDim, fontSize: 13, textAlign: "center", paddingTop: 40 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: radius.md, marginBottom: 4 },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { color: colors.text, fontSize: 15, fontWeight: "800", flexShrink: 1 },
  handle: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  followBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.amberStrong },
  followingBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  followTxt: { color: "#1A1206", fontSize: 12.5, fontWeight: "800" },
  followingTxt: { color: colors.textDim },
  empty: { alignItems: "center", gap: 8, paddingTop: 50, paddingHorizontal: 30 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: "800", marginTop: 4 },
  emptySub: { color: colors.textDim, fontSize: 13.5, textAlign: "center", lineHeight: 19 },
});
