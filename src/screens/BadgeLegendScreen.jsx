import { useEffect } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { colors, mono, radius, space } from "../theme";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Badge from "../components/Badge";
import Icon from "../components/Icon";
import { STATUS_BADGES, ACHIEVEMENTS, pointsTier } from "../lib/badges";

const TINT = { amber: colors.amber, magenta: colors.magenta, cool: colors.cool, good: colors.good, gold: colors.gold };

// The badge legend + rewards board: what every badge means, how it's earned, and
// (for you) your points, tier, and progress toward the ones you haven't unlocked.
export default function BadgeLegendScreen({ onClose, userId }) {
  const { session, userById, activityStats, userAchievements, userPoints, loadRewards } = useStore();
  const uid = userId || session?.id;
  const user = uid ? userById(uid) : null;
  const stats = activityStats(user);
  const earned = new Set(userAchievements(user));
  const points = userPoints(user);
  const tier = pointsTier(points);
  const nextPct = tier.next ? Math.min(1, Math.max(0, (points - tier.start) / (tier.next - tier.start))) : 1;
  useEffect(() => { if (uid) loadRewards(uid); }, [uid]);

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker="REWARDS" title="Badges" onBack={onClose} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* points / tier */}
        <View style={styles.hero}>
          <View style={styles.pointRow}>
            <Text style={styles.points}>{points.toLocaleString()}</Text>
            <Text style={styles.pointsLbl}>PTS</Text>
            <View style={styles.tierPill}><Text style={styles.tierTxt}>{tier.name}</Text></View>
          </View>
          <View style={styles.bar}><View style={[styles.barFill, { width: `${nextPct * 100}%` }]} /></View>
          <Text style={styles.heroSub}>
            {tier.next ? `${(tier.next - points).toLocaleString()} pts to ${pointsTier(tier.next).name}` : "Top tier. Legend status."}
            {"  ·  "}{earned.size}/{ACHIEVEMENTS.length} badges
          </Text>
        </View>

        <Text style={styles.section}>ACHIEVEMENTS · EARN THESE</Text>
        {ACHIEVEMENTS.map((a) => {
          const got = earned.has(a.id);
          const have = a.goal(stats);
          const pct = Math.min(1, have / a.target);
          const tint = TINT[a.tint] || colors.amber;
          return (
            <View key={a.id} style={[styles.ach, got && { borderColor: tint }]}>
              <View style={[styles.achIcon, { borderColor: got ? tint : colors.line, backgroundColor: got ? tint + "22" : colors.bgElev }]}>
                <Icon name={a.icon} size={18} color={got ? tint : colors.textFaint} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.achHead}>
                  <Text style={[styles.achName, !got && { color: colors.textDim }]}>{a.label}</Text>
                  <Text style={[styles.achPts, { color: got ? tint : colors.textFaint }]}>+{a.points}</Text>
                </View>
                <Text style={styles.achDesc}>{a.how}</Text>
                {!got && (
                  <View style={styles.miniBarRow}>
                    <View style={styles.miniBar}><View style={[styles.miniFill, { width: `${pct * 100}%`, backgroundColor: tint }]} /></View>
                    <Text style={styles.miniTxt}>{Math.floor(have)}/{a.target}</Text>
                  </View>
                )}
              </View>
              {got && <Icon name="check" size={16} color={tint} strokeWidth={3} />}
            </View>
          );
        })}

        <Text style={styles.section}>STATUS BADGES · GRANTED</Text>
        {Object.entries(STATUS_BADGES).map(([type, info]) => (
          <View key={type} style={styles.statusRow}>
            <Badge type={type} size={26} tooltip={false} />
            <View style={{ flex: 1 }}>
              <Text style={styles.achName}>{info.label}</Text>
              <Text style={styles.achDesc}>{info.desc}</Text>
              <Text style={styles.statusHow}>{info.how}</Text>
            </View>
          </View>
        ))}
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  hero: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 16, marginBottom: 18 },
  pointRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  points: { color: colors.amber, fontFamily: mono, fontSize: 34, fontWeight: "900" },
  pointsLbl: { color: colors.textDim, fontFamily: mono, fontSize: 13, fontWeight: "800" },
  tierPill: { marginLeft: "auto", paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber },
  tierTxt: { color: colors.amber, fontSize: 12, fontWeight: "800", letterSpacing: 0.5 },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, marginTop: 14, overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.amberStrong },
  heroSub: { color: colors.textDim, fontSize: 12.5, marginTop: 8 },
  section: { color: colors.textFaint, fontFamily: mono, fontSize: 11, letterSpacing: 1.5, fontWeight: "800", marginTop: 8, marginBottom: space(2) },
  ach: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginBottom: 8 },
  achIcon: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  achHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  achName: { color: colors.text, fontSize: 14.5, fontWeight: "800" },
  achPts: { fontFamily: mono, fontSize: 12, fontWeight: "800" },
  achDesc: { color: colors.textDim, fontSize: 12.5, marginTop: 2 },
  miniBarRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 7 },
  miniBar: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  miniFill: { height: 5, borderRadius: 3 },
  miniTxt: { color: colors.textFaint, fontFamily: mono, fontSize: 10.5 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginBottom: 8 },
  statusHow: { color: colors.amber, fontSize: 11, marginTop: 4, fontStyle: "italic" },
});
