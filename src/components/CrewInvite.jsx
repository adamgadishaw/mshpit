import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import Icon from "./Icon";
import { fetchCrewCounts } from "../lib/crewCountsApi";
import { colors, radius, space } from "../theme";

// "Going alone?" on an upcoming show: public counts, one tap into Crew.
export default function CrewInvite({ tourDateId, onPress }) {
  const [counts, setCounts] = useState(null);

  useEffect(() => {
    if (!tourDateId) return undefined;
    const controller = new AbortController();
    fetchCrewCounts(tourDateId, { signal: controller.signal })
      .then((result) => setCounts(result?.counts || null))
      // The invite still works without numbers; they are a nice extra.
      .catch(() => setCounts(null));
    return () => controller.abort();
  }, [tourDateId]);

  const looking = counts?.lookingForCrew || 0;
  const detail = looking
    ? `${looking} looking for a crew. Meet before doors, share a ride or split a hotel.`
    : "Meet fans going to this show: grab a drink before doors, share a ride or split a hotel.";

  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.pressed]} onPress={onPress} accessibilityRole="button"
      accessibilityLabel={`Find a crew for this show. ${detail}`}>
      <View style={styles.icon}><Icon name="heart" size={18} color="#1A1206" /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Going alone? Find a crew</Text>
        <Text style={styles.detail}>{detail}</Text>
      </View>
      <Icon name="chevron-right" size={18} color={colors.amber} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row", alignItems: "center", gap: space(3), marginTop: space(3), padding: space(4),
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.85 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.amberStrong },
  title: { color: colors.text, fontSize: 15, fontWeight: "900" },
  detail: { color: colors.textDim, fontSize: 13, lineHeight: 18, marginTop: 2 },
});
