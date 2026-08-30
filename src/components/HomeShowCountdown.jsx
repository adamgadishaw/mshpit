import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { formatDate } from "../domain/dates.mjs";
import { homeShowStatusLabel, humanShowCountdown } from "../domain/homeShowCountdown.mjs";
import { colors, displayFont, focusRing, mono, radius, shadow } from "../theme";
import Icon from "./Icon";

const planEventCopy = (candidate) => {
  const event = candidate?.event || {};
  return {
    event,
    title: event.eventName || event.artist || "Your next show",
    room: [event.venue, event.city || event.place].filter(Boolean).join(" · "),
    status: homeShowStatusLabel(candidate?.state),
  };
};

export default function HomeShowCountdown({ plan, onOpen, onViewAll, onFindShow, compact = false }) {
  const [now, setNow] = useState(() => Date.now());
  const upNext = Array.isArray(plan?.upNext) ? plan.upNext.slice(0, 2) : [];
  const visibleTargets = [plan, ...upNext]
    .map((candidate) => Number(candidate?.targetMs))
    .filter((target) => Number.isFinite(target) && target > 0);
  const latestTargetMs = visibleTargets.length ? Math.max(...visibleTargets) : null;

  useEffect(() => {
    setNow(Date.now());
    if (latestTargetMs == null || latestTargetMs <= Date.now()) return undefined;
    // This clock updates every visible plan label locally. It never fetches or
    // wakes the feed, and stops after the last bounded preview begins.
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= latestTargetMs) clearInterval(timer);
    }, 30_000);
    return () => clearInterval(timer);
  }, [latestTargetMs]);

  if (!plan) {
    return (
      <View style={[styles.card, styles.emptyCard, compact && styles.compact]} accessibilityLabel="No show countdown yet">
        <View style={styles.emptyIcon}><Icon name="calendar" size={16} color={colors.amber} /></View>
        <View style={styles.copy}>
          <Text style={styles.kicker}>YOUR NEXT NIGHT</Text>
          <Text style={styles.emptyTitle}>No show countdown yet</Text>
          <Text style={styles.emptyText}>Mark a show Interested or Going and it will appear here.</Text>
        </View>
        {onFindShow ? (
          <Pressable
            style={({ pressed, focused }) => [styles.findButton, pressed && styles.pressed, focused && focusRing]}
            onPress={onFindShow}
            accessibilityRole="button"
            accessibilityLabel="Find a show"
          >
            <Text style={styles.findText}>Find a show</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const { event, title, room, status } = planEventCopy(plan);
  const countdown = humanShowCountdown(plan.targetMs, now);
  const accessibilityLabel = `${status}: ${title}${room ? ` at ${room}` : ""}. ${countdown}. Open show.`;
  const totalPlans = Math.max(1, Number(plan.totalPlans) || (1 + upNext.length));
  const remainingCount = Math.max(0, Number(plan.remainingCount) || 0);

  return (
    <View style={[styles.card, styles.activeCard, compact && styles.compact]}>
      <Pressable
        style={({ pressed, hovered, focused }) => [
          styles.featuredButton,
          hovered && styles.hovered,
          pressed && styles.pressed,
          focused && focusRing,
        ]}
        onPress={() => onOpen?.(event)}
        disabled={!onOpen}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled: !onOpen }}
      >
        <View style={styles.topLine}>
          <Text style={styles.kicker}>YOUR NEXT NIGHT</Text>
          <View style={[styles.status, plan.state === "interested" && styles.statusInterested]}>
            <Text style={[styles.statusText, plan.state === "interested" && styles.statusInterestedText]}>{status}</Text>
          </View>
        </View>
        <Text style={styles.countdown} accessibilityLiveRegion="polite">{countdown}</Text>
        <Text style={styles.title} numberOfLines={compact ? 2 : 1}>{title}</Text>
        {room ? <Text style={styles.meta} numberOfLines={1}>{room}</Text> : null}
        <View style={styles.bottomLine}>
          <Text style={styles.date}>{formatDate(event.localDate || event.date, "Date announced soon")}</Text>
          <View style={styles.openCue}>
            <Text style={styles.openText}>Open show</Text>
            <Icon name="chevron-right" size={14} color={colors.amber} />
          </View>
        </View>
      </Pressable>

      {upNext.length ? (
        <View style={styles.nextSection}>
          <View style={styles.nextHeader}>
            <Text style={styles.nextKicker}>AFTER THAT</Text>
            {remainingCount > 0 ? (
              <Text style={styles.remainingLabel}>+{remainingCount} more</Text>
            ) : null}
          </View>
          {upNext.map((candidate, index) => {
            const next = planEventCopy(candidate);
            const nextCountdown = humanShowCountdown(candidate.targetMs, now);
            const nextDate = formatDate(candidate.event?.localDate || candidate.event?.date, "Date announced soon");
            return (
              <Pressable
                key={candidate.event?.showId || candidate.event?.tourDateId || candidate.event?.id || `${candidate.targetMs}-${index}`}
                style={({ pressed, hovered, focused }) => [
                  styles.nextButton,
                  hovered && styles.nextHovered,
                  pressed && styles.nextPressed,
                  focused && focusRing,
                ]}
                onPress={() => onOpen?.(candidate.event)}
                disabled={!onOpen}
                accessibilityRole="button"
                accessibilityLabel={`${next.status}: ${next.title}${next.room ? ` at ${next.room}` : ""}. ${nextCountdown}. Open show.`}
                accessibilityState={{ disabled: !onOpen }}
              >
                <View style={styles.nextCopy}>
                  <View style={styles.nextTitleLine}>
                    <Text style={styles.nextTitle} numberOfLines={1}>{next.title}</Text>
                    <View style={[styles.nextStatus, candidate.state === "interested" && styles.nextStatusInterested]}>
                      <Text style={[styles.nextStatusText, candidate.state === "interested" && styles.nextStatusInterestedText]}>{next.status}</Text>
                    </View>
                  </View>
                  {next.room ? <Text style={styles.nextMeta} numberOfLines={1}>{next.room}</Text> : null}
                </View>
                <View style={styles.nextTiming}>
                  <Text style={styles.nextCountdown}>{nextCountdown}</Text>
                  <Text style={styles.nextDate}>{nextDate}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {onViewAll ? (
        <Pressable
          style={({ pressed, hovered, focused }) => [
            styles.viewAllButton,
            hovered && styles.nextHovered,
            pressed && styles.nextPressed,
            focused && focusRing,
          ]}
          onPress={onViewAll}
          accessibilityRole="button"
          accessibilityLabel={`View all ${totalPlans} planned show${totalPlans === 1 ? "" : "s"} in Calendar`}
        >
          <Text style={styles.viewAllText}>View all in Calendar</Text>
          <Icon name="chevron-right" size={14} color={colors.amber} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    padding: 14,
    ...shadow.card,
    ...Platform.select({ web: { transitionDuration: "120ms", transitionProperty: "transform, filter" } }),
  },
  activeCard: { borderColor: colors.amber, backgroundColor: colors.bgElev },
  compact: { padding: 12 },
  featuredButton: { borderRadius: radius.sm, ...Platform.select({ web: { cursor: "pointer" } }) },
  topLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  kicker: { color: colors.textFaint, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.35 },
  status: { borderRadius: radius.pill, backgroundColor: colors.amberStrong, paddingHorizontal: 9, paddingVertical: 4 },
  statusInterested: { backgroundColor: "rgba(187,84,142,0.14)", borderWidth: 1, borderColor: colors.magenta },
  statusText: { color: "#1A1206", fontSize: 9.5, fontWeight: "900" },
  statusInterestedText: { color: colors.magenta },
  countdown: { color: colors.amber, fontFamily: displayFont, fontSize: 22, lineHeight: 27, fontWeight: "900", marginTop: 10 },
  title: { color: colors.text, fontFamily: displayFont, fontSize: 17, lineHeight: 22, fontWeight: "900", marginTop: 2 },
  meta: { color: colors.textDim, fontSize: 11.5, marginTop: 3 },
  bottomLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  date: { flex: 1, color: colors.textFaint, fontFamily: mono, fontSize: 9.5, fontWeight: "800" },
  openCue: { flexDirection: "row", alignItems: "center", gap: 2 },
  openText: { color: colors.amber, fontSize: 10.5, fontWeight: "800" },
  nextSection: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.lineSoft, gap: 6 },
  nextHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 1 },
  nextKicker: { color: colors.textFaint, fontFamily: mono, fontSize: 8.5, fontWeight: "900", letterSpacing: 1.1 },
  remainingLabel: { color: colors.amber, fontFamily: mono, fontSize: 9, fontWeight: "900" },
  nextButton: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 7, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft, ...Platform.select({ web: { cursor: "pointer" } }) },
  nextCopy: { flex: 1, minWidth: 0 },
  nextTitleLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  nextTitle: { flex: 1, minWidth: 0, color: colors.text, fontSize: 11.5, fontWeight: "900" },
  nextMeta: { color: colors.textFaint, fontSize: 9.5, marginTop: 2 },
  nextStatus: { flexShrink: 0, borderRadius: radius.pill, backgroundColor: colors.amberStrong, paddingHorizontal: 6, paddingVertical: 2 },
  nextStatusInterested: { backgroundColor: "rgba(187,84,142,0.14)", borderWidth: 1, borderColor: colors.magenta },
  nextStatusText: { color: "#1A1206", fontSize: 7.5, fontWeight: "900" },
  nextStatusInterestedText: { color: colors.magenta },
  nextTiming: { flexShrink: 0, maxWidth: 94, alignItems: "flex-end" },
  nextCountdown: { color: colors.amber, fontSize: 10.5, fontWeight: "900", textAlign: "right" },
  nextDate: { color: colors.textFaint, fontFamily: mono, fontSize: 7.5, marginTop: 2, textAlign: "right" },
  viewAllButton: { minHeight: 44, marginTop: 9, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, ...Platform.select({ web: { cursor: "pointer" } }) },
  viewAllText: { color: colors.amber, fontSize: 10.5, fontWeight: "900" },
  nextHovered: { backgroundColor: colors.surfaceAlt },
  nextPressed: { opacity: 0.82 },
  emptyCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.bgElev, boxShadow: "none", ...Platform.select({ web: { cursor: "default" } }) },
  emptyIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  copy: { flex: 1, minWidth: 0 },
  emptyTitle: { color: colors.text, fontSize: 13, fontWeight: "900", marginTop: 3 },
  emptyText: { color: colors.textDim, fontSize: 10.5, lineHeight: 15, marginTop: 2 },
  findButton: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber },
  findText: { color: colors.amber, fontSize: 10.5, fontWeight: "900" },
  hovered: { ...Platform.select({ web: { filter: "brightness(1.05)" } }) },
  pressed: { transform: [{ scale: 0.985 }], opacity: 0.9 },
});
