import { useEffect, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import Button from "../../components/Button";
import DatePicker from "../../components/DatePicker";
import { colors, radius } from "../../theme";
import { fetchArtistCalendar } from "./creatorPostsApi.mjs";
import { createLoadState, projectLoadState, resolveLoadState, rejectLoadState, isLoadCancellation } from "../../domain/loadState.mjs";
import { toAppError } from "../../lib/diagnostics";

export const newCalendarDate = () => ({ action: "create", eventId: "", expectedRevision: 0, venue: "", place: "", releaseAt: 0 });

export default function CreatorCalendarFields({ value, onChange, accountId, disabled }) {
  const calendar = value.calendar, scope = `${accountId}:calendar:${calendar.action}`;
  const [resource, setResource] = useState(() => createLoadState({ scope, status: "idle" }));
  const [attempt, setAttempt] = useState(0), [after, setAfter] = useState("");
  const current = projectLoadState(resource, scope);
  useEffect(() => {
    if (calendar.action === "create") return;
    const controller = new AbortController();
    setResource(createLoadState({ scope, status: "loading" }));
    fetchArtistCalendar({ accountId, after, signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setResource(resolveLoadState({ scope, data }));
    }).catch(error => { if (!isLoadCancellation(error, controller.signal)) setResource(previous => rejectLoadState(previous, { scope, error: toAppError(error), retainData: false })); });
    return () => controller.abort();
  }, [scope, accountId, after, attempt, calendar.action]);
  const change = patch => {
    const next = { ...calendar, ...patch };
    onChange({ ...value, calendar: next, location: [next.venue, next.place].filter(Boolean).join(", ").slice(0,200) });
  };
  const choose = event => onChange({ ...value, title: calendar.action === "cancel" ? "Show cancelled" : "Show updated", date: event.date,
    url: event.ticketUrl, location: `${event.venue}, ${event.place}`.slice(0,200),
    calendar: { action: calendar.action, eventId: event.id, expectedRevision: event.revision, venue: event.venue, place: event.place,
      releaseAt: event.releaseAt > Date.now() ? event.releaseAt : 0 } });
  const input = (key, label, maxLength) => <View style={{ gap: 6 }}>
    <Text style={{ color: colors.text }}>{label}</Text><TextInput accessibilityLabel={label} value={calendar[key]} maxLength={maxLength}
      editable={!disabled && calendar.action !== "cancel"} onChangeText={text => change({ [key]: text })}
      style={{ padding: 12, borderRadius: radius.md, color: colors.text, backgroundColor: colors.bgElev, borderColor: colors.line, borderWidth: 1 }} />
  </View>;
  return <View pointerEvents={disabled ? "none" : "auto"} style={{ gap: 12 }}>
    <Text style={{ color: colors.textDim }}>Add a show to your calendar and share it with your followers. Only shows added by this artist account can be changed here.</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{[["create", "Add a show"], ["edit", "Change a show"], ["cancel", "Cancel a show"]].map(([action,label]) =>
      <Button key={action} small disabled={disabled} variant={calendar.action === action ? "primary" : "secondary"} title={label} onPress={() => {
        setAfter(""); onChange({ ...value, calendar: { ...newCalendarDate(), action } });
      }} />)}</View>
    {calendar.action !== "create" && <View style={{ gap: 8 }}>
      <Text style={{ color: colors.text }}>Choose one of your published or scheduled shows</Text>
      {current.status === "loading" && <ActivityIndicator accessibilityLabel="Loading your calendar" color={colors.amber} />}
      {current.status === "error" && <><Text accessibilityRole="alert" style={{ color: colors.danger }}>Your calendar could not load. Your draft is saved.</Text><Button small title="Retry calendar" onPress={() => setAttempt(n => n+1)} /></>}
      {current.status === "ready" && !current.data?.events.length && <Text style={{ color: colors.textDim }}>No authored dates on this page.</Text>}
      {current.data?.events.map(event => <Button key={event.id} small variant="secondary" disabled={disabled || event.status === "cancelled"}
        title={`${event.date} · ${event.venue}${event.status === "cancelled" ? " · Cancelled" : ""}${event.publicationState === "blocked" ? " · Publication needs attention" : ""}`}
        onPress={() => choose(event)} />)}
      {!!current.data?.nextCursor && <Button small title="More shows" onPress={() => setAfter(current.data.nextCursor)} />}
      {!!after && <Button small variant="secondary" title="First page" onPress={() => setAfter("")} />}
      {!!calendar.eventId && <Text style={{ color: colors.amber }}>Selected: {calendar.venue} · {value.date}</Text>}
    </View>}
    {input("venue", "Venue", 80)}{input("place", "City and country", 160)}
    {calendar.action !== "cancel" && <View style={{ gap: 8 }}>
      <Text style={{ color: colors.text }}>{calendar.releaseAt ? "Scheduled publication" : "Publish immediately"}</Text>
      <Text style={{ color: colors.textDim }}>A scheduled show stays private until this date, at midnight in your local time. Posts and Activity notices publish together.</Text>
      <DatePicker accessibilityLabel="Calendar publication date" value={calendar.releaseAt ? new Date(calendar.releaseAt).toLocaleDateString("en-CA") : ""}
        onChange={date => change({ releaseAt: Date.parse(`${date}T00:00:00`) })} />
      {!!calendar.releaseAt && <Button small variant="secondary" disabled={disabled} title="Publish immediately instead" onPress={() => change({ releaseAt: 0 })} />}
    </View>}
    {calendar.action === "cancel" && <Text style={{ color: colors.textDim }}>Saving marks this show as cancelled. Your followers receive an update for a published show. A private scheduled show is withdrawn without a notification.</Text>}
  </View>;
}
