import { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, displayFont, focusRing, font, radius } from "../../theme";
import Icon from "../Icon";
import { PublicPressableLink } from "../PublicWebLinks";
import { eventPath } from "../../domain/urls.mjs";
import { liveEventTitle } from "../../domain/liveDiscovery.mjs";
import { splitVenuePlace } from "../../domain/venueDiscovery.mjs";
import { discoverEventWeeks } from "../../domain/discoverEventWeeks.mjs";

// Discover's list view: every show in the range, a week at a time. Week tabs
// with counts across the top, then each day's shows as compact rows, and
// previous/next week at the bottom.
export default function DiscoverEventList({ events, weekKey, onWeekChange, loadingMore = false, onOpen }) {
  const weeks = useMemo(() => discoverEventWeeks(events), [events]);
  if (!weeks.length) return null;
  const index = Math.max(0, weeks.findIndex((week) => week.key === weekKey));
  const week = weeks[index];
  const previous = weeks[index - 1] || null;
  const next = weeks[index + 1] || null;
  return <View style={styles.root}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.weeks} accessibilityRole="tablist" accessibilityLabel="Weeks">
      {weeks.map((item) => {
        const on = item.key === week.key;
        return <Pressable key={item.key} onPress={() => onWeekChange(item.key)} style={({ focused }) => [styles.weekTab, on && styles.weekTabOn, focused && focusRing]}
          accessibilityRole="tab" accessibilityState={{ selected: on }} aria-selected={on} accessibilityLabel={`${item.label}, ${item.count} ${item.count === 1 ? "show" : "shows"}`}>
          <Text style={[styles.weekText, on && styles.weekTextOn]}>{item.label}</Text>
          <Text style={[styles.weekCount, on && styles.weekTextOn]}>{item.count}</Text>
        </Pressable>;
      })}
    </ScrollView>

    {week.days.map((day) => <View key={day.key} style={styles.day}>
      <View style={styles.dayHead}>
        <Text style={styles.dayLabel} accessibilityRole="header">{day.label}</Text>
        <Text style={styles.dayCount}>{day.events.length === 1 ? "1 show" : `${day.events.length} shows`}</Text>
      </View>
      <View style={styles.rows}>
        {day.events.map((event, row) => {
          const title = liveEventTitle(event);
          const { city } = splitVenuePlace(event?.place);
          const place = [event?.venue, city !== "Location unavailable" ? city : null].filter(Boolean).join(" · ") || "Venue to be announced";
          return <PublicPressableLink key={event.id || `${title}|${event.venue}|${event.date}`} href={eventPath(event)} onNavigate={() => onOpen?.(event)}
            style={({ pressed, hovered, focused }) => [styles.row, row > 0 && styles.rowDivider, (hovered || pressed) && styles.rowActive, focused && focusRing]}
            accessibilityLabel={`Open ${title} at ${event.venue || "the venue"}, ${day.label}`}>
            <View style={styles.rowCopy}>
              <Text style={styles.title} numberOfLines={1}>{title}</Text>
              <Text style={styles.place} numberOfLines={1}>{place}</Text>
            </View>
            {event?.soldOut ? <Text style={styles.tag}>Sold out</Text> : null}
            <Icon name="chevron-right" size={16} color={colors.textFaint} />
          </PublicPressableLink>;
        })}
      </View>
    </View>)}

    {loadingMore && !next ? <View style={styles.loading} accessibilityLiveRegion="polite">
      <ActivityIndicator size="small" color={colors.amber} />
      <Text style={styles.loadingText}>Adding later dates...</Text>
    </View> : null}

    {previous || next ? <View style={styles.pager}>
      {previous ? <Pressable onPress={() => onWeekChange(previous.key)} style={({ pressed, focused }) => [styles.pageButton, pressed && styles.pressed, focused && focusRing]}
        accessibilityRole="button" accessibilityLabel={`Previous week: ${previous.label}`}>
        <Icon name="chevron-left" size={15} color={colors.amber} />
        <Text style={styles.pageText} numberOfLines={1}>{previous.label}</Text>
      </Pressable> : <View style={styles.pageSpacer} />}
      {next ? <Pressable onPress={() => onWeekChange(next.key)} style={({ pressed, focused }) => [styles.pageButton, styles.pageNext, pressed && styles.pressed, focused && focusRing]}
        accessibilityRole="button" accessibilityLabel={`Next week: ${next.label}`}>
        <Text style={styles.pageText} numberOfLines={1}>{next.label}</Text>
        <Icon name="chevron-right" size={15} color={colors.amber} />
      </Pressable> : <View style={styles.pageSpacer} />}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 16, minWidth: 0 },
  weeks: { gap: 8, paddingVertical: 2 },
  weekTab: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 38, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: 13 },
  weekTabOn: { backgroundColor: colors.amber, borderColor: colors.amber },
  weekText: { color: colors.text, fontFamily: font, fontSize: 13, fontWeight: "800" },
  weekCount: { color: colors.textFaint, fontFamily: font, fontSize: 12, fontWeight: "900" },
  weekTextOn: { color: colors.bg },
  day: { gap: 8 },
  dayHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  dayLabel: { color: colors.text, fontFamily: displayFont, fontSize: 17, fontWeight: "900" },
  dayCount: { color: colors.textFaint, fontFamily: font, fontSize: 12, fontWeight: "700" },
  rows: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, paddingHorizontal: 14, paddingVertical: 9 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.lineSoft },
  rowActive: { backgroundColor: colors.surfaceAlt },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  title: { color: colors.text, fontFamily: font, fontSize: 14.5, fontWeight: "900" },
  place: { color: colors.textDim, fontFamily: font, fontSize: 12.5 },
  tag: { color: colors.danger, fontFamily: font, fontSize: 11.5, fontWeight: "900" },
  loading: { flexDirection: "row", alignItems: "center", gap: 8 },
  loadingText: { color: colors.textDim, fontFamily: font, fontSize: 12.5 },
  pager: { flexDirection: "row", gap: 10 },
  pageButton: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: `${colors.amber}66`, backgroundColor: `${colors.amber}0F`, paddingHorizontal: 12 },
  pageNext: { justifyContent: "flex-end" },
  pageSpacer: { flex: 1 },
  pageText: { flexShrink: 1, color: colors.amber, fontFamily: font, fontSize: 13, fontWeight: "900" },
  pressed: { opacity: 0.8 },
});
