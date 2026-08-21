import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Linking, Platform, useWindowDimensions } from "react-native";
import { colors, mono, radius, shadow, space } from "../theme";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Icon from "./../components/Icon";
import { exportCalendarEvents } from "../lib/calendarExport";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = [
  { short: "Sun", full: "Sunday" },
  { short: "Mon", full: "Monday" },
  { short: "Tue", full: "Tuesday" },
  { short: "Wed", full: "Wednesday" },
  { short: "Thu", full: "Thursday" },
  { short: "Fri", full: "Friday" },
  { short: "Sat", full: "Saturday" },
];
const pad = (n) => String(n).padStart(2, "0");
const keyOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
// Dates in this app come in mixed shapes: ISO "2026-06-21", the seed's
// "2026 · 08 · 14" (middot), and the odd mojibake separator. Pull the first
// year/month/day number groups regardless of separator, else fall back to Date.
const dayKeyFromDate = (s) => {
  if (!s) return null;
  const str = String(s);
  const m = str.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : keyOf(d.getFullYear(), d.getMonth(), d.getDate());
};
const prettyDay = (k) => {
  const [y, m, d] = k.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
};
const dateFromKey = (key) => {
  const [year, month, day] = String(key).split("-").map(Number);
  return new Date(year, month - 1, day, 12);
};

// Site-wide calendar: every upcoming show + the ones you're going to, laid out on a
// real month grid. "Today" comes from the server clock (GET /api/time) so it's right
// regardless of the device's clock. Tap a day to see its shows; tap a show to open it.
export default function CalendarScreen({ onClose, onOpen, onOpenArtist }) {
  const { session, upcomingEvents, goingFor, serverTime } = useStore();
  const { width: viewportWidth } = useWindowDimensions();

  // Authoritative "today" from the server, device clock as the fallback.
  const [today, setToday] = useState(() => new Date());
  const [tz, setTz] = useState(null);
  useEffect(() => {
    let ok = true;
    serverTime().then((t) => { if (ok && t?.now) { setToday(new Date(t.now)); if (t.tz) setTz(t.tz); } });
    return () => { ok = false; };
  }, []);

  const todayKey = keyOf(today.getFullYear(), today.getMonth(), today.getDate());

  // All calendar events, keyed by day. Shows you're "going" to are flagged so they
  // stand out from the general upcoming-shows firehose.
  const byDay = useMemo(() => {
    const map = {};
    const add = (ev, going) => {
      const dk = dayKeyFromDate(ev.date);
      if (!dk || !/^\d{4}-\d{2}-\d{2}$/.test(dk)) return;
      const id = `${(ev.artist || "").toLowerCase()}|${(ev.venue || "").toLowerCase()}|${dk}`;
      (map[dk] ||= {});
      const prev = map[dk][id];
      map[dk][id] = { ...ev, dayKey: dk, going: going || prev?.going || false };
    };
    (upcomingEvents(500) || []).forEach((e) => add(e, false));
    if (session) (goingFor(session.id) || []).forEach((e) => add(e, true));
    const out = {};
    for (const dk of Object.keys(map)) out[dk] = Object.values(map[dk]).sort((a, b) => (a.artist || "").localeCompare(b.artist || ""));
    return out;
  }, [upcomingEvents, goingFor, session]);

  // Start on today's month; if it's empty, jump to the first month that has shows.
  const firstEventKey = useMemo(() => Object.keys(byDay).filter((k) => k >= todayKey).sort()[0] || Object.keys(byDay).sort()[0] || null, [byDay, todayKey]);
  const initial = byDay[todayKey] ? todayKey : firstEventKey || todayKey;
  const [cursor, setCursor] = useState(() => { const [y, m] = initial.split("-").map(Number); return { y, m: m - 1 }; });
  const [selected, setSelected] = useState(initial);
  const [calendarNotice, setCalendarNotice] = useState(null);
  const [exportingKey, setExportingKey] = useState("");
  const dayRefs = useRef(new Map());
  const pendingFocusKey = useRef(null);

  const { y, m } = cursor;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const firstWeekday = new Date(y, m, 1).getDay();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const shiftMonth = (delta) => {
    const nm = m + delta;
    const ny = y + Math.floor(nm / 12);
    const mm = ((nm % 12) + 12) % 12;
    setCursor({ y: ny, m: mm });
    setSelected(keyOf(ny, mm, 1));
  };

  useEffect(() => {
    if (Platform.OS !== "web" || !pendingFocusKey.current) return undefined;
    const key = pendingFocusKey.current;
    const timer = setTimeout(() => {
      dayRefs.current.get(key)?.focus?.();
      pendingFocusKey.current = null;
    }, 0);
    return () => clearTimeout(timer);
  }, [selected, y, m]);

  const selectDay = (key, { focus = false } = {}) => {
    const date = dateFromKey(key);
    setSelected(key);
    if (date.getFullYear() !== y || date.getMonth() !== m) {
      setCursor({ y: date.getFullYear(), m: date.getMonth() });
    }
    if (focus && Platform.OS === "web") pendingFocusKey.current = key;
  };

  const onDayKeyDown = (event, key) => {
    if (Platform.OS !== "web") return;
    const pressed = event?.nativeEvent?.key || event?.key;
    const current = dateFromKey(key);
    let delta = null;
    if (pressed === "ArrowLeft") delta = -1;
    else if (pressed === "ArrowRight") delta = 1;
    else if (pressed === "ArrowUp") delta = -7;
    else if (pressed === "ArrowDown") delta = 7;
    else if (pressed === "Home") delta = -current.getDay();
    else if (pressed === "End") delta = 6 - current.getDay();
    if (delta == null) return;
    event.preventDefault?.();
    current.setDate(current.getDate() + delta);
    selectDay(keyOf(current.getFullYear(), current.getMonth(), current.getDate()), { focus: true });
  };

  const monthEventCount = Object.keys(byDay).filter((k) => k.startsWith(`${y}-${pad(m + 1)}`)).reduce((s, k) => s + byDay[k].length, 0);
  const selectedEvents = byDay[selected] || [];
  const goingEvents = useMemo(() => Object.values(byDay).flat().filter((event) => event.going), [byDay]);
  const calendarWidth = Math.max(308, Math.min(560, viewportWidth - space(8)));

  const saveCalendar = async (events, key) => {
    if (exportingKey) return;
    setCalendarNotice(null);
    setExportingKey(key);
    try {
      const result = await exportCalendarEvents(events);
      setCalendarNotice({ ok: true, text: `${result.fileName} is ready for your calendar.` });
    } catch (error) {
      setCalendarNotice({ ok: false, text: error?.message || "PIT could not prepare that calendar file." });
    } finally {
      setExportingKey("");
    }
  };

  const openEvent = (ev) => {
    if (onOpen) onOpen({ artist: ev.artist, venue: ev.venue, city: ev.city || ev.place, date: ev.date, ...ev });
  };

  return (
    <View style={styles.wrap}>
      <ScreenHeader
        kicker="WHAT'S ON"
        title="Calendar"
        onBack={onClose}
        right={<Pressable style={styles.todayTarget} onPress={() => { setCursor({ y: today.getFullYear(), m: today.getMonth() }); setSelected(todayKey); }} accessibilityRole="button" accessibilityLabel="Go to today"><Text style={styles.todayBtn}>Today</Text></Pressable>}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* month nav */}
        <View style={styles.monthBar}>
          <Pressable style={styles.navBtn} onPress={() => shiftMonth(-1)} accessibilityRole="button" accessibilityLabel={`Previous month, ${MONTHS[(m + 11) % 12]}`}><Icon name="chevron-left" size={18} color={colors.text} /></Pressable>
          <View style={styles.monthMid}>
            <Text style={styles.monthTitle} accessibilityRole="header">{MONTHS[m]} {y}</Text>
            <Text style={styles.monthSub} accessibilityLiveRegion="polite">{monthEventCount > 0 ? `${monthEventCount} show${monthEventCount === 1 ? "" : "s"}` : "No shows this month"}</Text>
          </View>
          <Pressable style={styles.navBtn} onPress={() => shiftMonth(1)} accessibilityRole="button" accessibilityLabel={`Next month, ${MONTHS[(m + 1) % 12]}`}><Icon name="chevron-right" size={18} color={colors.text} /></Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.calendarScroller} accessibilityLabel={`${MONTHS[m]} ${y} calendar`}>
          <View style={[styles.calendarCanvas, { width: calendarWidth }]}>
            <View style={styles.dowRow} accessible={false}>
              {DOW.map((day) => <Text key={day.full} style={styles.dow} accessibilityLabel={day.full}>{day.short}</Text>)}
            </View>

            <View style={styles.grid} accessibilityLabel={`${MONTHS[m]} ${y} days`}>
              {cells.map((d, i) => {
                if (d == null) return <View key={`blank-${i}`} style={styles.cell} accessible={false} />;
                const k = keyOf(y, m, d);
                const evs = byDay[k];
                const isToday = k === todayKey;
                const isSel = k === selected;
                const hasGoing = evs?.some((e) => e.going);
                const goingCount = evs?.filter((event) => event.going).length || 0;
                const label = `${prettyDay(k)}${isToday ? ", today" : ""}${evs ? `, ${evs.length} show${evs.length === 1 ? "" : "s"}` : ", no shows"}${goingCount ? `, going to ${goingCount}` : ""}`;
                return (
                  <Pressable
                    key={k}
                    ref={(node) => { if (node) dayRefs.current.set(k, node); else dayRefs.current.delete(k); }}
                    style={[styles.cell, isSel && styles.cellSel, isToday && !isSel && styles.cellToday]}
                    onPress={() => selectDay(k)}
                    {...(Platform.OS === "web" ? { onKeyDown: (event) => onDayKeyDown(event, k), tabIndex: isSel ? 0 : -1 } : {})}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    accessibilityState={{ selected: isSel }}
                  >
                    <Text style={[styles.cellNum, isSel && styles.cellNumSel, isToday && !isSel && styles.cellNumToday]}>{d}</Text>
                    {evs ? <View style={[styles.dot, { backgroundColor: hasGoing ? colors.amber : colors.textFaint }, isSel && { backgroundColor: "#1A1206" }]} /> : <View style={styles.dotEmpty} />}
                  </Pressable>
                );
              })}
            </View>
          </View>
        </ScrollView>

        <View style={styles.legendRow}>
          <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: colors.amber }]} /><Text style={styles.legendTxt}>You're going</Text></View>
          <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: colors.textFaint }]} /><Text style={styles.legendTxt}>Upcoming show</Text></View>
          {tz ? <Text style={styles.tzTxt}>{tz}</Text> : null}
        </View>

        {goingEvents.length > 0 ? (
          <Pressable
            style={[styles.exportAllBtn, !!exportingKey && styles.disabled]}
            onPress={() => saveCalendar(goingEvents, "all")}
            disabled={!!exportingKey}
            accessibilityRole="button"
            accessibilityLabel={`Save ${goingEvents.length} going shows to calendar`}
            accessibilityState={{ disabled: !!exportingKey, busy: exportingKey === "all" }}
          >
            <Icon name="calendar" size={16} color={colors.amber} />
            <Text style={styles.exportAllTxt}>{exportingKey === "all" ? "Preparing calendar…" : `Save my Going shows (${goingEvents.length})`}</Text>
          </Pressable>
        ) : null}
        {calendarNotice ? (
          <Text
            style={[styles.calendarNotice, calendarNotice.ok ? styles.calendarNoticeOk : styles.calendarNoticeBad]}
            accessibilityLiveRegion="polite"
            role="status"
          >
            {calendarNotice.text}
          </Text>
        ) : null}

        {/* selected-day events */}
        <Text style={styles.dayHeading} accessibilityRole="header" accessibilityLiveRegion="polite">{prettyDay(selected)}</Text>
        {Object.keys(byDay).length === 0 ? (
          // The whole calendar is empty: say why instead of showing a wall of
          // blank days (tour dates arrive from providers; Going pins are yours).
          <View style={styles.empty}>
            <Icon name="calendar" size={20} color={colors.textFaint} />
            <Text style={styles.emptyTxt}>Nothing on the calendar yet.</Text>
            <Text style={styles.emptyHint}>Tour dates land here automatically as they're announced. Tap "Going" on any show to pin your own plans.</Text>
          </View>
        ) : selectedEvents.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="calendar" size={20} color={colors.textFaint} />
            <Text style={styles.emptyTxt}>No shows on this day.</Text>
          </View>
        ) : (
          selectedEvents.map((ev, i) => (
            <View key={i} style={styles.eventRow}>
              <Pressable style={styles.eventMain} onPress={() => openEvent(ev)} accessibilityRole="button" accessibilityLabel={`${ev.artist} at ${ev.venue || ev.place || "venue"}`}>
                <View style={styles.eventLeft}>
                  <Text style={styles.eventArtist} numberOfLines={1}>{ev.artist || "Show"}</Text>
                  <Text style={styles.eventVenue} numberOfLines={1}>{[ev.venue, ev.place || ev.city].filter(Boolean).join(" · ") || "Venue TBA"}</Text>
                </View>
                {ev.going ? <View style={styles.goingTag}><Text style={styles.goingTagTxt}>GOING</Text></View> : null}
                {ev.soldOut ? <View style={styles.soldTag}><Text style={styles.soldTagTxt}>SOLD OUT</Text></View> : null}
              </Pressable>
              <View style={styles.eventActions}>
                {onOpenArtist && ev.artist ? (
                  <Pressable style={styles.iconBtn} onPress={() => onOpenArtist(ev.artist)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Open ${ev.artist}`}><Icon name="music" size={15} color={colors.textDim} /></Pressable>
                ) : null}
                <Pressable
                  style={styles.iconBtn}
                  onPress={() => saveCalendar(ev, `event-${ev.dayKey}-${i}`)}
                  disabled={!!exportingKey}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Save ${ev.artist || "show"} to calendar`}
                  accessibilityState={{ disabled: !!exportingKey, busy: exportingKey === `event-${ev.dayKey}-${i}` }}
                >
                  <Icon name="calendar" size={15} color={colors.textDim} />
                </Pressable>
                {ev.ticketUrl ? (
                  <Pressable style={styles.ticketBtn} onPress={() => Linking.openURL(ev.ticketUrl).catch(() => setCalendarNotice({ ok: false, text: "Tickets could not be opened on this device." }))} hitSlop={6} accessibilityRole="link" accessibilityLabel={`Tickets for ${ev.artist || "show"}`}>
                    <Text style={styles.ticketTxt}>Tickets</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: space(4), paddingTop: 8 },
  todayTarget: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  todayBtn: { color: colors.amber, fontSize: 13, fontWeight: "800" },

  monthBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6, marginBottom: 12 },
  navBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  monthMid: { alignItems: "center" },
  monthTitle: { color: colors.text, fontSize: 18, fontWeight: "900", letterSpacing: -0.3 },
  monthSub: { color: colors.textDim, fontSize: 11, fontFamily: mono, marginTop: 2 },

  calendarScroller: { flexGrow: 1 },
  calendarCanvas: { minWidth: 308 },
  dowRow: { flexDirection: "row", marginBottom: 4 },
  dow: { flex: 1, textAlign: "center", color: colors.textFaint, fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },

  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, minHeight: 44, aspectRatio: 1, alignItems: "center", justifyContent: "center", borderRadius: radius.md, paddingVertical: 4 },
  cellSel: { backgroundColor: colors.amberStrong },
  cellToday: { borderWidth: 1, borderColor: colors.amber },
  cellNum: { color: colors.text, fontSize: 14, fontWeight: "700", fontFamily: mono },
  cellNumSel: { color: "#1A1206", fontWeight: "900" },
  cellNumToday: { color: colors.amber },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 4 },
  dotEmpty: { width: 5, height: 5, marginTop: 4 },

  legendRow: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 12, marginBottom: 6, paddingHorizontal: 2 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendTxt: { color: colors.textDim, fontSize: 11 },
  tzTxt: { color: colors.textFaint, fontSize: 10, fontFamily: mono, marginLeft: "auto" },
  exportAllBtn: { minHeight: 44, marginTop: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 14 },
  exportAllTxt: { color: colors.text, fontSize: 12.5, fontWeight: "800" },
  disabled: { opacity: 0.55 },
  calendarNotice: { marginTop: 8, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 9, fontSize: 12, lineHeight: 17 },
  calendarNoticeOk: { color: colors.good, backgroundColor: colors.surfaceAlt },
  calendarNoticeBad: { color: colors.danger, backgroundColor: colors.surfaceAlt },

  dayHeading: { color: colors.text, fontSize: 15, fontWeight: "800", marginTop: 16, marginBottom: 10, letterSpacing: -0.2 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 28 },
  emptyTxt: { color: colors.textDim, fontSize: 13 },
  emptyHint: { color: colors.textFaint, fontSize: 12, lineHeight: 18, textAlign: "center", maxWidth: 320 },

  eventRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginBottom: 8, ...shadow.card },
  eventMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  eventLeft: { flex: 1 },
  eventArtist: { color: colors.text, fontSize: 14.5, fontWeight: "800" },
  eventVenue: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  goingTag: { backgroundColor: "rgba(242,166,90,0.14)", borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  goingTagTxt: { color: colors.amber, fontSize: 9.5, fontWeight: "900", letterSpacing: 0.8 },
  soldTag: { backgroundColor: "rgba(224,108,108,0.14)", borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  soldTagTxt: { color: colors.danger, fontSize: 9.5, fontWeight: "900", letterSpacing: 0.8 },
  eventActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", backgroundColor: colors.bgElev },
  ticketBtn: { minHeight: 44, justifyContent: "center", backgroundColor: colors.amberStrong, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  ticketTxt: { color: "#1A1206", fontSize: 12, fontWeight: "800" },
});
