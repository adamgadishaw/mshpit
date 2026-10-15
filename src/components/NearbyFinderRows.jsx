import { memo, useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { colors, focusRing, radius } from "../theme";
import { optionalDistanceKm } from "../domain/venueDiscovery.mjs";
import { liveEventTitle } from "../domain/liveDiscovery.mjs";
import { nearbyDirectionsUrl, nearbyEventDate, nearbyEventImage } from "../domain/nearbyShowFinder.mjs";
import { eventPath } from "../domain/urls.mjs";
import { openTicketLink } from "../lib/ticketLinks";
const distance = value => {
  const km = optionalDistanceKm(value);
  return km == null ? null : km.toFixed(km < 10 ? 1 : 0) + " km";
};
function Action({
  title,
  onPress
}) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} style={({
    focused,
    pressed
  }) => [styles.action, focused && focusRing, pressed && {
    opacity: 0.7
  }]}><Text style={styles.actionText}>{title}</Text></Pressable>;
}
function Directions({
  venue
}) {
  const [error, setError] = useState(false);
  const url = nearbyDirectionsUrl(venue);
  return url ? <View><Action title="Directions" onPress={() => {
      setError(false);
      void Linking.openURL(url).catch(() => setError(true));
    }} />{error ? <Text style={styles.muted} accessibilityRole="alert">Maps could not open. Try again.</Text> : null}</View> : null;
}
export const NearbyShowRow = memo(function NearbyShowRow({
  event,
  onOpenArtist,
  onOpenVenue,
  onOpenEvent
}) {
  const [imageFailed, setImageFailed] = useState(false),
    [ticketError, setTicketError] = useState(false),
    image = nearbyEventImage(event),
    title = liveEventTitle(event);
  useEffect(() => { setImageFailed(false); }, [image]);
  return <View style={styles.row}>
    <View style={styles.body}>
      {image && !imageFailed ? <Image source={{
        uri: image
      }} style={styles.image} contentFit="cover" onError={() => setImageFailed(true)} accessibilityLabel={title + " event photo"} /> : null}
      <View style={styles.copy}>
        <Text style={styles.date}>{nearbyEventDate(event)}</Text>
        <Pressable onPress={() => title === event.artist ? onOpenArtist?.(event.artist) : onOpenEvent?.(event)} accessibilityRole="button" accessibilityLabel={title === event.artist ? "Open artist " + event.artist : "Open event " + title}><Text style={styles.title}>{title}</Text></Pressable>
        <Pressable onPress={() => onOpenVenue?.(event.venue)} accessibilityRole="button" accessibilityLabel={"Open venue " + event.venue} disabled={!event.venue}><Text style={styles.muted}>{[event.venue, event.place, distance(event.distanceKm)].filter(Boolean).join(" · ") || "Venue to be announced"}</Text></Pressable>
      </View>
    </View>
    <View style={styles.actions}>
      {eventPath(event) && onOpenEvent ? <Action title="Event details" onPress={() => onOpenEvent(event)} /> : null}
      {event.ticketUrl && !event.soldOut ? <Action title="Tickets" onPress={() => {
        setTicketError(false);
        void openTicketLink(event.ticketUrl, {
          onFailure: () => setTicketError(true)
        });
      }} /> : event.soldOut ? <Text style={styles.muted}>Sold out</Text> : null}
      <Directions venue={event} />
    </View>
    {ticketError ? <Text style={styles.muted} accessibilityRole="alert">Ticket link could not open. Try again.</Text> : null}
  </View>;
});
export const NearbyVenueRow = memo(function NearbyVenueRow({
  venue,
  onOpenVenue
}) {
  return <View style={styles.row}><Pressable onPress={() => onOpenVenue?.(venue.name)} accessibilityRole="button" accessibilityLabel={"Open venue " + venue.name}><Text style={styles.title}>{venue.name}</Text><Text style={styles.muted}>{[venue.neighbourhood || venue.neighborhood, venue.place, distance(venue.distanceKm)].filter(Boolean).join(" · ")}</Text></Pressable><View style={styles.actions}><Text style={styles.muted}>{venue.upcoming || 0} upcoming {(venue.upcoming || 0) === 1 ? "show" : "shows"}</Text><Directions venue={venue} /></View></View>;
});
const styles = StyleSheet.create({
  row: {
    padding: 14,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    borderRadius: radius.sm,
    backgroundColor: colors.bgElev,
    gap: 8
  },
  body: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center"
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 5
  },
  image: {
    width: 68,
    height: 80,
    borderRadius: 8
  },
  date: {
    color: colors.amber,
    fontSize: 12,
    fontWeight: "700"
  },
  title: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
    lineHeight: 22
  },
  muted: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 18
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12
  },
  action: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 2
  },
  actionText: {
    color: colors.amber,
    fontSize: 12,
    fontWeight: "700"
  }
});
