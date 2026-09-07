import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, displayFont, focusRing, mono, radius, space } from "../../theme";
import { eventDateMeta } from "../../domain/venueDiscovery.mjs";
import { eventPath } from "../../domain/urls.mjs";
import { discoverCountryLabel } from "../../domain/discoverScene.mjs";
import { canonicalTicketUrl } from "../../domain/ticketLinks.mjs";
import { formatAttendanceTicketTime } from "../../domain/attendanceTicket.mjs";
import { openTicketLink } from "../../lib/ticketLinks";
import { artistOverviewLocation } from "../../domain/artistOverviewLocation.mjs";
import { artistOverviewText } from "../../domain/artistOverviewCopy.mjs";
import Icon from "../Icon";
import { PublicPressableLink } from "../PublicWebLinks";

function Action({ label, onPress, disabled = false, actionRef, ...props }) {
  return <Pressable ref={actionRef} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
    {...props} style={({ pressed, focused }) => [styles.action, disabled && styles.disabled, pressed && styles.pressed, focused && focusRing]}>
    <Text style={styles.actionText}>{label}</Text>
  </Pressable>;
}

function LocationFilter({ controller, copy }) {
  const [open, setOpen] = useState(false);
  const [country, setCountry] = useState(controller.countryCode);
  const [city, setCity] = useState(controller.city);
  const [error, setError] = useState(false);
  const trigger = useRef(null);
  const text = (key) => artistOverviewText(copy, key);
  useEffect(() => { setCountry(controller.countryCode); setCity(controller.city); }, [controller.countryCode, controller.city]);
  const close = () => { setOpen(false); trigger.current?.focus?.(); };
  const apply = () => {
    let location;
    try { location = artistOverviewLocation({ countryCode: country, city }); }
    catch { setError(true); return; }
    setError(false); close(); void controller.setLocation(location);
  };
  const active = !!(controller.countryCode || controller.city);
  const label = [controller.city, discoverCountryLabel(controller.countryCode) || controller.countryCode].filter(Boolean).join(" · ");
  return <View style={styles.filter}>
    <View style={styles.actions}>
      <Action actionRef={trigger} label={active ? label : text("allLocations")} accessibilityHint={text("filterLocation")} accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} />
      {active ? <Action label={text("allLocations")} onPress={() => { close(); void controller.setLocation({}); }} /> : null}
    </View>
    {open ? <View style={styles.filterFields}>
      <View style={styles.field}><Text style={styles.label}>{text("countryLabel")}</Text><TextInput accessibilityLabel={text("countryLabel")} value={country} onChangeText={setCountry} placeholder={text("countryPlaceholder")} placeholderTextColor={colors.textFaint} autoCorrect={false} maxLength={80} style={styles.input} /></View>
      <View style={styles.field}><Text style={styles.label}>{text("cityLabel")}</Text><TextInput accessibilityLabel={text("cityLabel")} value={city} onChangeText={setCity} placeholder={text("cityPlaceholder")} placeholderTextColor={colors.textFaint} autoCorrect={false} maxLength={120} style={styles.input} onSubmitEditing={apply} /></View>
      {error ? <Text selectable accessibilityRole="alert" style={styles.error}>{text("invalidCountry")}</Text> : null}
      <View style={styles.actions}><Action label={text("applyLocation")} onPress={apply} /><Action label={text("closeFilters")} onPress={close} /></View>
    </View> : null}
  </View>;
}

function ShowTicket({ event, artistName, onOpenShow, copy }) {
  const text = (key) => artistOverviewText(copy, key);
  const stamp = eventDateMeta(event.date);
  const status = String(event.eventStatus || "").toLowerCase();
  const statusLabel = /cancel/.test(status) ? text("cancelled") : /postpon/.test(status) ? text("postponed") : /reschedul/.test(status) ? text("rescheduled") : event.soldOut ? text("soldOut") : "";
  const ticketUrl = /cancel|postpon/.test(status) || event.soldOut ? "" : canonicalTicketUrl(event.ticketUrl);
  const [ticketError, setTicketError] = useState(false);
  const title = event.eventName || event.artist || artistName;
  const time = formatAttendanceTicketTime(event.startLocalTime || event.startDateTime, { timeZone: event.eventTimezone });
  const openTickets = () => { setTicketError(false); void openTicketLink(ticketUrl, { onFailure: () => setTicketError(true) }); };
  return <View style={styles.ticket} testID={`artist-show-${event.id}`}>
    <View style={styles.ticketBody}>
      <View style={styles.dateStub}>{stamp.iso ? <><Text selectable style={styles.month}>{stamp.month}</Text><Text selectable style={styles.day}>{stamp.day}</Text><Text selectable style={styles.year}>{stamp.year}</Text></> : <Icon name="calendar" size={24} color={colors.amber} />}</View>
      <View style={styles.eventCopy}>
        <Text selectable style={styles.eventTitle} numberOfLines={2}>{title}</Text>
        <Text selectable style={styles.venue} numberOfLines={2}>{event.venue || text("venuePending")}</Text>
        {event.place ? <Text selectable style={styles.location} numberOfLines={2}>{event.place}</Text> : null}
        {!stamp.iso || time ? <Text selectable style={styles.time}>{stamp.iso ? time : text("datePending")}</Text> : null}
        {statusLabel ? <Text selectable style={styles.status}>{statusLabel}</Text> : null}
      </View>
    </View>
    <View style={styles.ticketActions}>
      <PublicPressableLink href={eventPath(event)} onNavigate={onOpenShow ? () => onOpenShow(event) : undefined} accessibilityLabel={`${text("openShow")}: ${title}`}
        style={({ pressed, focused }) => [styles.ticketAction, pressed && styles.pressed, focused && focusRing]}>
        <Icon name="ticket" size={16} color={colors.amber} /><Text style={styles.actionText}>{text("openShow")}</Text><Icon name="chevron-right" size={16} color={colors.amber} />
      </PublicPressableLink>
      {ticketUrl ? <PublicPressableLink href={ticketUrl} onNavigate={openTickets} accessibilityLabel={`${text("tickets")}: ${title}`}
        style={({ pressed, focused }) => [styles.ticketAction, styles.ticketExternal, pressed && styles.pressed, focused && focusRing]}>
        <Text style={styles.actionText}>{text("tickets")}</Text><Icon name="external" size={14} color={colors.amber} />
      </PublicPressableLink> : null}
    </View>
    {ticketError ? <Text selectable accessibilityRole="alert" style={styles.ticketError}>{text("ticketFailure")}</Text> : null}
  </View>;
}

export default function ArtistUpcomingShows({ controller, artistName, onOpenShow, condensed = false, onViewAll, copy }) {
  const { resource, loadingMore, moreError } = controller;
  const schedule = resource.data?.schedule;
  if (schedule?.legacy || schedule?.coverage?.status === "disabled") return null;
  const text = (key, values) => artistOverviewText(copy, key, values);
  const rows = schedule?.items || [];
  const shown = condensed ? rows.slice(0, 3) : rows;
  const pending = ["idle", "loading", "refreshing"].includes(resource.status);
  const failed = resource.status === "error";
  const hasSchedule = !!schedule;
  const coverage = schedule?.coverage?.status;
  const coverageKey = coverage === "partial" ? "partial" : coverage === "stale" ? "coverageStale" : coverage === "unknown" ? "coverageUnknown" : coverage === "unavailable" ? "coverageUnavailable" : schedule?.coverage?.refreshPending ? "coveragePending" : null;
  return <View style={[styles.section, { marginTop: space(5) }]}>
    <View style={styles.heading}><View style={styles.headingCopy}><Text accessibilityRole="header" style={styles.title}>{text("title")}</Text><Text style={styles.description}>{text("description")}</Text></View><Icon name="ticket" size={24} color={colors.amber} /></View>
    {!condensed ? <LocationFilter controller={controller} copy={copy} /> : null}
    {pending ? <View accessibilityLiveRegion="polite" style={styles.notice}><ActivityIndicator size="small" color={colors.amber} /><Text style={styles.noticeText}>{text(hasSchedule ? "refreshing" : "loading")}</Text></View> : null}
    {failed ? <View style={styles.notice}><Text selectable accessibilityRole="alert" style={styles.noticeText}>{text(hasSchedule ? "stale" : "failed")}{resource.error?.code ? ` (${resource.error.code})` : ""}</Text><Action label={text("retry")} onPress={controller.reload} /></View> : null}
    {!pending && !failed && !rows.length ? <Text selectable style={styles.empty}>{text(controller.city || controller.countryCode ? "emptyFiltered" : "empty")}</Text> : null}
    {shown.map((event) => <ShowTicket key={event.id} event={event} artistName={artistName} onOpenShow={onOpenShow} copy={copy} />)}
    {coverageKey ? <Text selectable style={styles.coverage}>{text(coverageKey)}</Text> : null}
    {moreError ? <Text selectable accessibilityRole="alert" style={styles.error}>{text("moreFailed")}{moreError.code ? ` (${moreError.code})` : ""}</Text> : null}
    {condensed && onViewAll ? <Action label={text("viewAll")} onPress={onViewAll} /> : null}
    {!condensed && schedule?.hasMore ? <Action label={text(loadingMore ? "loadingMore" : moreError ? "retry" : "loadMore")} disabled={pending || loadingMore} onPress={controller.loadMore} /> : null}
    {!condensed && rows.length ? <Text style={styles.count}>{text("shownCount", { shown: rows.length, total: schedule.total })}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: space(3), minWidth: 0, flexShrink: 0 }, heading: { flexDirection: "row", alignItems: "center", gap: space(3) }, headingCopy: { flex: 1, minWidth: 0 }, title: { color: colors.text, fontFamily: displayFont, fontSize: 23, fontWeight: "900", lineHeight: 29 }, description: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  filter: { gap: space(2) }, actions: { flexDirection: "row", flexWrap: "wrap", gap: space(2) }, action: { minHeight: 44, minWidth: 44, maxWidth: "100%", alignItems: "center", justifyContent: "center", paddingHorizontal: space(3), paddingVertical: space(2), borderRadius: radius.sm, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev }, actionText: { color: colors.amber, fontSize: 12, lineHeight: 18, fontWeight: "800", flexShrink: 1 }, filterFields: { gap: space(2), padding: space(3), borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface }, field: { gap: space(1) }, label: { color: colors.textDim, fontSize: 11, fontWeight: "700" }, input: { minHeight: 44, padding: space(3), color: colors.text, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, fontSize: 14 },
  notice: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2), padding: space(3), borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.bgElev }, noticeText: { flexGrow: 1, flexShrink: 1, color: colors.textDim, fontSize: 12, lineHeight: 18 }, empty: { padding: space(4), color: colors.textDim, fontSize: 14, lineHeight: 21 }, coverage: { color: colors.textFaint, fontSize: 11, lineHeight: 17 }, error: { color: colors.danger, fontSize: 12, lineHeight: 18 }, count: { color: colors.textFaint, fontSize: 10, fontFamily: mono },
  ticket: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surface, overflow: "hidden", minWidth: 0, flexShrink: 0 }, ticketBody: { flexDirection: "row", minWidth: 0 }, dateStub: { width: 64, flexShrink: 0, alignItems: "center", justifyContent: "center", gap: 2, paddingVertical: space(4), borderRightWidth: 1, borderColor: colors.line, borderStyle: "dashed", backgroundColor: colors.surfaceAlt }, month: { color: colors.amber, fontSize: 10, fontFamily: mono, fontWeight: "800", letterSpacing: 1 }, day: { color: colors.text, fontFamily: displayFont, fontSize: 28, fontWeight: "900", lineHeight: 33, fontVariant: ["tabular-nums"] }, year: { color: colors.textFaint, fontFamily: mono, fontSize: 9 }, eventCopy: { flex: 1, minWidth: 0, padding: space(3), gap: 3 }, eventTitle: { color: colors.text, fontFamily: displayFont, fontSize: 17, lineHeight: 23, fontWeight: "900" }, venue: { color: colors.textDim, fontSize: 12, lineHeight: 18 }, location: { color: colors.textFaint, fontSize: 11, lineHeight: 16 }, time: { color: colors.textDim, fontFamily: mono, fontSize: 10, lineHeight: 16 }, status: { color: colors.cool, fontSize: 11, lineHeight: 16, fontWeight: "800" }, ticketActions: { flexDirection: "row", borderTopWidth: 1, borderColor: colors.line, borderStyle: "dashed", backgroundColor: colors.bgElev }, ticketAction: { flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: space(3), paddingVertical: space(2), gap: space(2), flexDirection: "row", alignItems: "center", justifyContent: "center" }, ticketExternal: { borderLeftWidth: 1, borderColor: colors.line }, ticketError: { color: colors.danger, fontSize: 11, lineHeight: 17, padding: space(3) }, pressed: { opacity: 0.75 }, disabled: { opacity: 0.55 },
});
