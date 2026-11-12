import { View, Text, Linking, Alert } from "react-native";
import { colors } from "../theme";
import { formatDate } from "../domain/dates.mjs";
import { PublicTextLink } from "./PublicWebLinks";

export default function CreatorUpdateCard({ update, isCurrent }) {
  const event = update.calendarEvent, cancelled = ["cancelled", "canceled"].includes(event?.status);
  const url = event ? event.ticketUrl : update.url;
  return <View style={{ gap: 8, paddingVertical: 12 }}>
    <Text style={{ color: colors.amber, fontWeight: "700" }}>{update.entityName} · {update.kind === "show" ? "Show date" : update.kind === "release" ? "Release" : "Update"}</Text>
    <Text selectable style={{ color: colors.text, fontWeight: "800", fontSize: 20 }}>{update.title}</Text>
    {!!update.date && <Text selectable style={{ color: colors.textDim }}>{formatDate(update.date)}{update.location ? ` · ${update.location}` : ""}</Text>}
    {!!event && <Text selectable style={{ color: cancelled ? colors.danger : colors.textDim }}>
      {cancelled ? "Cancelled" : "Current calendar date"}: {formatDate(event.date)} · {event.venue}, {event.place}
    </Text>}
    {!!url && !cancelled && <PublicTextLink href={url} onNavigate={() => {
      if (isCurrent?.() === false) return;
      void Linking.openURL(url).catch(() => {
        if (isCurrent?.() !== false) Alert.alert("Link unavailable", "This link could not be opened. Try again.");
      });
    }} style={{ color: colors.amber }}>
      {update.kind === "show" ? "Tickets and details" : "Find out more"}
    </PublicTextLink>}
  </View>;
}
