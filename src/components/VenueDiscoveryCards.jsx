import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, displayFont, focusRing, mono, radius, shadow } from "../theme";
import { eventDateMeta, optionalDistanceKm, splitVenuePlace } from "../domain/venueDiscovery.mjs";
import Icon from "./Icon";

export function VenueDiscoveryCard({ venue, onPress, compact = false }) {
  const { city, region } = splitVenuePlace(venue?.place);
  const upcoming = Math.max(0, Number(venue?.upcoming) || 0);
  const rating = Number(venue?.rating) || 0;
  const distance = optionalDistanceKm(venue?.distanceKm);
  const details = [
    distance != null ? `${distance.toFixed(distance < 10 ? 1 : 0)} km away` : null,
    venue?.capacity ? `${Number(venue.capacity).toLocaleString()} capacity` : null,
    rating > 0 ? `${rating.toFixed(1)} room score` : null,
  ].filter(Boolean);
  return (
    <Pressable
      style={({ pressed, hovered, focused }) => [
        styles.venueCard,
        compact && styles.venueCardCompact,
        hovered && styles.hovered,
        pressed && styles.pressed,
        focused && focusRing,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${venue?.name || "Venue"}, ${city}${upcoming ? `, ${upcoming} upcoming shows` : ""}`}
    >
      <View style={styles.venueMark}>
        <Icon name="pin" size={compact ? 16 : 19} color={colors.cool} />
      </View>
      <View style={styles.cardCopy}>
        <Text style={[styles.venueName, compact && styles.venueNameCompact]} numberOfLines={1}>{venue?.name || "Unknown venue"}</Text>
        <Text style={styles.place} numberOfLines={1}>{city}{region ? ` · ${region}` : ""}</Text>
        {!compact && details.length > 0 ? <Text style={styles.detail} numberOfLines={1}>{details.join("  ·  ")}</Text> : null}
      </View>
      {upcoming > 0 ? (
        <View style={styles.upcomingPill}>
          <Text style={styles.upcomingNumber}>{upcoming}</Text>
          {!compact ? <Text style={styles.upcomingLabel}>UPCOMING</Text> : null}
        </View>
      ) : null}
      <Icon name="chevron-right" size={18} color={colors.textFaint} />
    </Pressable>
  );
}

export function UpcomingEventCard({ event, onOpenArtist, onOpenVenue, onTickets, compact = false, context }) {
  const date = eventDateMeta(event?.date);
  const { city } = splitVenuePlace(event?.place);
  const distance = optionalDistanceKm(event?.distanceKm);
  const detail = [
    event?.venue,
    city !== "Location unavailable" ? city : null,
    distance != null ? `${distance.toFixed(distance < 10 ? 1 : 0)} km` : null,
  ].filter(Boolean).join(" · ");
  return (
    <View style={[styles.eventCard, compact && styles.eventCardCompact]} accessibilityLabel={`${event?.artist || "Upcoming event"}, ${detail}, ${date.timing}`}>
      <View style={[styles.dateBadge, compact && styles.dateBadgeCompact]}>
        <Text style={styles.dateMonth}>{date.month}</Text>
        <Text style={[styles.dateDay, compact && styles.dateDayCompact]}>{date.day}</Text>
      </View>
      <View style={styles.cardCopy}>
        <View style={styles.eventTopline}>
          <Text style={styles.timing}>{context || date.timing}</Text>
          {event?.soldOut ? <Text style={styles.soldOutTag}>SOLD OUT</Text> : null}
          {event?.scheduled ? <Text style={styles.scheduledTag}>SCHEDULED</Text> : null}
        </View>
        {onOpenArtist ? (
          <Pressable onPress={onOpenArtist} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Open ${event?.artist}`}>
            <Text style={[styles.artist, compact && styles.artistCompact]} numberOfLines={1}>{event?.artist || "Artist to be announced"}</Text>
          </Pressable>
        ) : (
          <Text style={[styles.artist, compact && styles.artistCompact]} numberOfLines={1}>{event?.artist || "Artist to be announced"}</Text>
        )}
        {onOpenVenue ? (
          <Pressable onPress={onOpenVenue} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Open ${event?.venue}`}>
            <Text style={styles.eventPlace} numberOfLines={compact ? 2 : 1}>{detail || "Venue to be announced"}</Text>
          </Pressable>
        ) : (
          <Text style={styles.eventPlace} numberOfLines={compact ? 2 : 1}>{detail || "Venue to be announced"}</Text>
        )}
        {!compact && event?.genre ? <Text style={styles.genre}>{event.genre}</Text> : null}
      </View>
      {!compact && !event?.soldOut && event?.ticketUrl ? (
        <Pressable
          style={({ pressed, focused }) => [styles.ticketButton, pressed && styles.ticketPressed, focused && focusRing]}
          onPress={onTickets}
          accessibilityRole="link"
          accessibilityLabel={`Tickets for ${event?.artist || "this event"}`}
        >
          <Icon name="ticket" size={15} color="#1A1206" />
          <Text style={styles.ticketText}>Tickets</Text>
        </Pressable>
      ) : compact ? <Icon name="chevron-right" size={16} color={colors.textFaint} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  venueCard: { minHeight: 82, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: colors.surface, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, ...shadow.card, ...Platform.select({ web: { cursor: "pointer", transitionDuration: "120ms", transitionProperty: "background-color, border-color, transform" } }) },
  venueCardCompact: { minHeight: 64, padding: 10, gap: 9, boxShadow: "none" },
  venueMark: { width: 42, height: 42, borderRadius: 14, borderCurve: "continuous", alignItems: "center", justifyContent: "center", backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line },
  cardCopy: { flex: 1, minWidth: 0 },
  venueName: { color: colors.text, fontFamily: displayFont, fontSize: 16, fontWeight: "800", letterSpacing: -0.2 },
  venueNameCompact: { fontSize: 14 },
  place: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  detail: { color: colors.textFaint, fontFamily: mono, fontSize: 10, marginTop: 6 },
  upcomingPill: { minWidth: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: 8, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.amber },
  upcomingNumber: { color: colors.amber, fontFamily: mono, fontSize: 15, fontWeight: "900", fontVariant: ["tabular-nums"] },
  upcomingLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 7, fontWeight: "800", letterSpacing: 0.7, marginTop: 1 },
  hovered: { backgroundColor: colors.surfaceAlt, borderColor: colors.line },
  pressed: { transform: [{ scale: 0.99 }], opacity: 0.9 },
  eventCard: { minHeight: 94, flexDirection: "row", alignItems: "center", gap: 13, padding: 14, backgroundColor: colors.surface, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, ...shadow.card },
  eventCardCompact: { minHeight: 74, padding: 10, gap: 10, backgroundColor: colors.bgElev, boxShadow: "none" },
  dateBadge: { width: 58, minHeight: 64, alignItems: "center", justifyContent: "center", borderRadius: 16, borderCurve: "continuous", backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.amber },
  dateBadgeCompact: { width: 46, minHeight: 52, borderRadius: 13 },
  dateMonth: { color: colors.amber, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  dateDay: { color: colors.text, fontFamily: mono, fontSize: 24, fontWeight: "900", lineHeight: 28, fontVariant: ["tabular-nums"] },
  dateDayCompact: { fontSize: 19, lineHeight: 22 },
  eventTopline: { minHeight: 15, flexDirection: "row", alignItems: "center", gap: 6 },
  timing: { color: colors.amber, fontFamily: mono, fontSize: 9, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  soldOutTag: { color: colors.danger, fontFamily: mono, fontSize: 8, fontWeight: "900", letterSpacing: 0.7 },
  scheduledTag: { color: colors.cool, fontFamily: mono, fontSize: 8, fontWeight: "900", letterSpacing: 0.7 },
  artist: { color: colors.text, fontFamily: displayFont, fontSize: 17, fontWeight: "900", letterSpacing: -0.25, marginTop: 2 },
  artistCompact: { fontSize: 14 },
  eventPlace: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: 2 },
  genre: { alignSelf: "flex-start", color: colors.cool, fontSize: 10, fontWeight: "700", marginTop: 4 },
  ticketButton: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 13, borderRadius: radius.pill, backgroundColor: colors.amberStrong, borderWidth: 1, borderBottomWidth: 3, borderColor: colors.amber, borderBottomColor: colors.accentEdge, ...shadow.control, ...Platform.select({ web: { cursor: "pointer" } }) },
  ticketPressed: { transform: [{ translateY: 2 }], opacity: 0.9 },
  ticketText: { color: "#1A1206", fontFamily: displayFont, fontSize: 12, fontWeight: "900" },
});
