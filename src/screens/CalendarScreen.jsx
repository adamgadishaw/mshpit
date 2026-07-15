import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Linking, Platform } from "react-native";
import { colors, mono, radius, shadow } from "../theme";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Icon from "./../components/Icon";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];
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

// Site-wide calendar: every upcoming show + the ones you're going to, laid out on a
// real month grid. "Today" comes from the server clock (GET /api/time) so it's right
// regardless of the device's clock. Tap a day to see its shows; tap a show to open it.
export default function CalendarScreen({ onClose, onOpen, onOpenArtist }) {
  const { session, upcomingEvents, goingFor, serverTime } = useStore();

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
  };

  const monthEventCount = Object.keys(byDay).filter((k) => k.startsWith(`${y}-${pad(m + 1)}`)).reduce((s, k) => s + byDay[k].length, 0);
  const selectedEvents = byDay[selected] || [];

  const openEvent = (ev) => {
    if (onOpen) onOpen({ artist: ev.artist, venue: ev.venue, city: ev.city || ev.place, date: ev.date, ...ev });
  };

  return (
    <View style={styles.wrap}>
      <ScreenHeader
        kicker="WHAT'S ON"
        title="Calendar"
        onBack={onClose}
        right={<Pressable onPress={() => { setCursor({ y: today.getFullYear(), m: today.getMonth() }); setSelected(todayKey); }} hitSlop={8}><Text style={styles.todayBtn}>Today</Text></Pressable>}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* month nav */}
        <View style={styles.monthBar}>
          <Pressable style={styles.navBtn} onPress={() => shiftMonth(-1)} hitSlop={8} accessibilityLabel="Previous month"><Icon name="chevron-left" size={18} color={colors.text} /></Pressable>
          <View style={styles.monthMid}>
            <Text style={styles.monthTitle}>{MONTHS[m]} {y}</Text>
            <Text style={styles.monthSub}>{monthEventCount > 0 ? `${monthEventCount} show${monthEventCount === 1 ? "" : "s"}` : "No shows this month"}</Text>
          </View>
          <Pressable style={styles.navBtn} onPress={() => shiftMonth(1)} hitSlop={8} accessibilityLabel="Next month"><Icon name="chevron-right" size={18} color={colors.text} /></Pressable>
        </View>

        {/* weekday header */}
        <View style={styles.dowRow}>
          {DOW.map((d, i) => <Text key={i} style={styles.dow}>{d}</Text>)}
        </View>

        {/* day grid */}
        <View style={styles.grid}>
          {cells.map((d, i) => {
            if (d == null) return <View key={i} style={styles.cell} />;
            const k = keyOf(y, m, d);
            const evs = byDay[k];
            const isToday = k === todayKey;
            const isSel = k === selected;
            const hasGoing = evs?.some((e) => e.going);
            return (
              <Pressable key={i} style={[styles.cell, isSel && styles.cellSel, isToday && !isSel && styles.cellToday]} onPress={() => setSelected(k)} accessibilityLabel={`${prettyDay(k)}${evs ? `, ${evs.length} shows` : ""}`}>
                <Text style={[styles.cellNum, isSel && styles.cellNumSel, isToday && !isSel && styles.cellNumToday]}>{d}</Text>
                {evs ? <View style={[styles.dot, { backgroundColor: hasGoing ? colors.amber : colors.textFaint }, isSel && { backgroundColor: "#1A1206" }]} /> : <View style={styles.dotEmpty} />}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.legendRow}>
          <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: colors.amber }]} /><Text style={styles.legendTxt}>You're going</Text></View>
          <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: colors.textFaint }]} /><Text style={styles.legendTxt}>Upcoming show</Text></View>
          {tz ? <Text style={styles.tzTxt}>{tz}</Text> : null}
        </View>

        {/* selected-day events */}
        <Text style={styles.dayHeading}>{prettyDay(selected)}</Text>
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
                  <Pressable style={styles.iconBtn} onPress={() => onOpenArtist(ev.artist)} hitSlop={6} accessibilityLabel={`Open ${ev.artist}`}><Icon name="music" size={15} color={colors.textDim} /></Pressable>
                ) : null}
                {ev.ticketUrl ? (
                  <Pressable style={styles.ticketBtn} onPress={() => Linking.openURL(ev.ticketUrl)} hitSlop={6} accessibilityLabel="Tickets">
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
  scroll: { padding: 14, paddingTop: 8 },
  todayBtn: { color: colors.amber, fontSize: 13, fontWeight: "800" },

  monthBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6, marginBottom: 12 },
  navBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  monthMid: { alignItems: "center" },
  monthTitle: { color: colors.text, fontSize: 18, fontWeight: "900", letterSpacing: -0.3 },
  monthSub: { color: colors.textDim, fontSize: 11, fontFamily: mono, marginTop: 2 },

  dowRow: { flexDirection: "row", marginBottom: 4 },
  dow: { flex: 1, textAlign: "center", color: colors.textFaint, fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },

  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center", borderRadius: radius.md, paddingVertical: 4 },
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
  iconBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", backgroundColor: colors.bgElev },
  ticketBtn: { backgroundColor: colors.amberStrong, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  ticketTxt: { color: "#1A1206", fontSize: 12, fontWeight: "800" },
});
