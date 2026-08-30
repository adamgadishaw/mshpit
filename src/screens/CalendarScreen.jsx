import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, View, Text, StyleSheet, Pressable, ScrollView, Platform, useWindowDimensions } from "react-native";
import { colors, mono, radius, shadow, space } from "../theme";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Icon from "./../components/Icon";
import { exportCalendarEvents } from "../lib/calendarExport";
import { openTicketLink } from "../lib/ticketLinks";
import { CALENDAR_SHOW_VIEW, memberCalendarModel } from "../domain/calendarShows.mjs";
import { toIsoDate } from "../domain/dates.mjs";
import {
  CALENDAR_HISTORY_PAGE_SIZE,
  calendarHistoryWindow,
  nextCalendarHistoryLimit,
} from "../domain/calendarHistoryWindow.mjs";
import { useProfileHistory } from "../features/profileHistory/useProfileHistory";
import VinylRefreshBoundary from "../components/VinylRefreshBoundary";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const REFRESH_RETRY_HINT = Platform.OS === "web"
  ? "Reload this page to try again."
  : "Pull down to try again.";
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
export default function CalendarScreen({ initialDate = null, initialView = CALENDAR_SHOW_VIEW.UPCOMING, onClose, onOpen, onOpenArtist }) {
  const { session, upcomingEvents, goingFor, myAttendance, refreshMyAttendance, refreshTourDates, serverTime } = useStore();
  const { width: viewportWidth } = useWindowDimensions();
  const [view, setView] = useState(initialView === CALENDAR_SHOW_VIEW.PAST
    ? CALENDAR_SHOW_VIEW.PAST
    : CALENDAR_SHOW_VIEW.UPCOMING);
  const history = useProfileHistory({
    accountId: session?.id,
    targetId: session?.id,
    // Upcoming needs authored posts too: a dated future show post is a calendar
    // item even when the member did not separately press Going.
    enabled: !!session?.id,
  });
  const [historyVisibleLimit, setHistoryVisibleLimit] = useState(CALENDAR_HISTORY_PAGE_SIZE);
  const [historyOlderLoadFailed, setHistoryOlderLoadFailed] = useState(false);
  useEffect(() => {
    setHistoryVisibleLimit(CALENDAR_HISTORY_PAGE_SIZE);
    setHistoryOlderLoadFailed(false);
  }, [session?.id]);
  const historyWindow = useMemo(
    () => calendarHistoryWindow(history.posts, historyVisibleLimit, history.nextCursor),
    [history.nextCursor, history.posts, historyVisibleLimit],
  );
  const historyInitialLoading = !!session?.id
    && !history.updatedAt
    && !history.error
    && (history.status === "idle" || history.status === "loading" || history.status === "refreshing");

  // Authoritative "today" from the server, device clock as the fallback.
  const [today, setToday] = useState(() => new Date());
  const [tz, setTz] = useState(null);
  useEffect(() => {
    let ok = true;
    serverTime().then((t) => { if (ok && t?.now) { setToday(new Date(t.now)); if (t.tz) setTz(t.tz); } });
    return () => { ok = false; };
  }, []);

  const todayKey = keyOf(today.getFullYear(), today.getMonth(), today.getDate());

  const calendarModel = useMemo(
    () => memberCalendarModel({
      today: todayKey,
      upcoming: upcomingEvents(500) || [],
      going: session ? goingFor(session.id) || [] : [],
      attendance: session ? myAttendance || [] : [],
      posts: session ? historyWindow.posts : [],
    }),
    [goingFor, historyWindow.posts, myAttendance, session, todayKey, upcomingEvents],
  );
  const calendarViews = calendarModel.byDay;
  const byDay = calendarViews[view];

  // Start on today's month; if it's empty, jump to the first month that has shows.
  const firstEventKey = useMemo(() => Object.keys(byDay).filter((k) => k >= todayKey).sort()[0] || Object.keys(byDay).sort()[0] || null, [byDay, todayKey]);
  const requestedDate = toIsoDate(initialDate);
  const initial = requestedDate || (byDay[todayKey] ? todayKey : firstEventKey || todayKey);
  const [cursor, setCursor] = useState(() => { const [y, m] = initial.split("-").map(Number); return { y, m: m - 1 }; });
  const [selected, setSelected] = useState(initial);
  const [calendarNotice, setCalendarNotice] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const refreshControllerRef = useRef(null);
  const [exportingKey, setExportingKey] = useState("");
  const dayRefs = useRef(new Map());
  const pendingFocusKey = useRef(null);
  const pendingPastPosition = useRef(false);

  useEffect(() => {
    refreshControllerRef.current?.abort();
    refreshControllerRef.current = null;
    setRefreshing(false);
    setRefreshError(false);
    return () => refreshControllerRef.current?.abort();
  }, [session?.id]);

  const { y, m } = cursor;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const firstWeekday = new Date(y, m, 1).getDay();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const shiftMonth = (delta) => {
    pendingPastPosition.current = false;
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
    pendingPastPosition.current = false;
    const date = dateFromKey(key);
    setSelected(key);
    if (date.getFullYear() !== y || date.getMonth() !== m) {
      setCursor({ y: date.getFullYear(), m: date.getMonth() });
    }
    if (focus && Platform.OS === "web") pendingFocusKey.current = key;
  };

  const selectView = (nextView) => {
    if (nextView === view) return;
    const keys = Object.keys(calendarViews[nextView]).sort();
    pendingPastPosition.current = nextView === CALENDAR_SHOW_VIEW.PAST && keys.length === 0;
    const target = nextView === CALENDAR_SHOW_VIEW.PAST
      ? keys.at(-1) || todayKey
      : keys.find((key) => key >= todayKey) || keys[0] || todayKey;
    const date = dateFromKey(target);
    setView(nextView);
    setCursor({ y: date.getFullYear(), m: date.getMonth() });
    setSelected(target);
  };

  useEffect(() => {
    if (view !== CALENDAR_SHOW_VIEW.PAST || !pendingPastPosition.current) return;
    const target = Object.keys(calendarViews[CALENDAR_SHOW_VIEW.PAST]).sort().at(-1);
    if (!target) return;
    pendingPastPosition.current = false;
    const date = dateFromKey(target);
    setCursor({ y: date.getFullYear(), m: date.getMonth() });
    setSelected(target);
  }, [calendarViews, view]);

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

  const loadEarlierHistory = async () => {
    if (history.loadingMore) return;
    if (historyWindow.hasBufferedPage) {
      setHistoryVisibleLimit((current) => nextCalendarHistoryLimit(current));
      return;
    }
    if (!historyWindow.hasServerPage) return;
    setHistoryOlderLoadFailed(false);
    const previousCount = history.posts.length;
    const result = await history.loadMore();
    if (result?.error) {
      setHistoryOlderLoadFailed(true);
    } else if ((result?.data?.posts?.length || 0) > previousCount) {
      setHistoryVisibleLimit((current) => nextCalendarHistoryLimit(current));
    }
  };

  const retryHistory = () => {
    if (historyOlderLoadFailed && historyWindow.hasServerPage) return loadEarlierHistory();
    setHistoryOlderLoadFailed(false);
    return history.retry();
  };

  const refreshCalendar = async () => {
    if (refreshControllerRef.current) return false;
    const accountId = session?.id || null;
    const controller = new AbortController();
    refreshControllerRef.current = controller;
    setRefreshing(true);
    setRefreshError(false);
    const results = await Promise.allSettled([
      refreshTourDates?.({ signal: controller.signal }),
      session ? refreshMyAttendance?.({ signal: controller.signal }) : true,
      session ? history.retry() : true,
      serverTime(),
    ]);
    if (controller.signal.aborted || refreshControllerRef.current !== controller
      || (session?.id || null) !== accountId) return false;
    const timeResult = results[3];
    if (timeResult.status === "fulfilled" && timeResult.value?.now) {
      setToday(new Date(timeResult.value.now));
      if (timeResult.value.tz) setTz(timeResult.value.tz);
    }
    const failed = results.some((result, index) => result.status === "rejected"
      || result.value === false
      || result.value == null
      || (index === 2 && result.value?.status === "error"));
    setRefreshError(failed);
    setRefreshing(false);
    refreshControllerRef.current = null;
    return !failed;
  };

  return (
    <View style={styles.wrap}>
      <ScreenHeader
        kicker="WHAT'S ON"
        title="Calendar"
        onBack={onClose}
        right={<Pressable style={styles.todayTarget} onPress={() => { setCursor({ y: today.getFullYear(), m: today.getMonth() }); setSelected(todayKey); }} accessibilityRole="button" accessibilityLabel="Go to today"><Text style={styles.todayBtn}>Today</Text></Pressable>}
      />
      <VinylRefreshBoundary
        refreshing={refreshing}
        onRefresh={refreshCalendar}
        accessibilityLabel="Refresh your calendar"
        style={styles.refreshBoundary}
        testID="calendar-refresh"
      >
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {refreshing || refreshError ? (
          <Text
            style={[styles.refreshStatus, refreshError && styles.refreshStatusError]}
            accessibilityLiveRegion={refreshError ? "assertive" : "polite"}
            accessibilityRole={refreshError ? "alert" : "text"}
          >
            {refreshing ? "Refreshing your calendar…" : `Some calendar details could not refresh. ${REFRESH_RETRY_HINT}`}
          </Text>
        ) : null}
        <View style={styles.viewTabs} accessibilityRole="tablist" accessibilityLabel="Calendar show period">
          {[
            [CALENDAR_SHOW_VIEW.UPCOMING, "Upcoming"],
            [CALENDAR_SHOW_VIEW.PAST, "Past shows"],
          ].map(([key, label]) => {
            const selectedView = view === key;
            return (
              <Pressable
                key={key}
                style={[styles.viewTab, selectedView && styles.viewTabSelected]}
                onPress={() => selectView(key)}
                accessibilityRole="tab"
                accessibilityLabel={`Show ${label.toLocaleLowerCase()}`}
                accessibilityState={{ selected: selectedView }}
              >
                <Text style={[styles.viewTabText, selectedView && styles.viewTabTextSelected]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

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
                const hasGoing = evs?.some((event) => view === CALENDAR_SHOW_VIEW.PAST ? event.attended : event.going);
                const hasInterested = view === CALENDAR_SHOW_VIEW.UPCOMING && evs?.some((event) => event.interested);
                const goingCount = view === CALENDAR_SHOW_VIEW.UPCOMING
                  ? evs?.filter((event) => event.going).length || 0
                  : 0;
                const interestedCount = view === CALENDAR_SHOW_VIEW.UPCOMING
                  ? evs?.filter((event) => event.interested).length || 0
                  : 0;
                const label = `${prettyDay(k)}${isToday ? ", today" : ""}${evs ? `, ${evs.length} show${evs.length === 1 ? "" : "s"}` : ", no shows"}${goingCount ? `, going to ${goingCount}` : ""}${interestedCount ? `, interested in ${interestedCount}` : ""}`;
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
                    {evs ? <View style={[styles.dot, { backgroundColor: hasGoing ? colors.amber : hasInterested ? colors.magenta : colors.textFaint }, isSel && { backgroundColor: "#1A1206" }]} /> : <View style={styles.dotEmpty} />}
                  </Pressable>
                );
              })}
            </View>
          </View>
        </ScrollView>

        <View style={styles.legendRow}>
          {view === CALENDAR_SHOW_VIEW.UPCOMING ? (
            <>
              <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: colors.amber }]} /><Text style={styles.legendTxt}>You're going</Text></View>
              <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: colors.magenta }]} /><Text style={styles.legendTxt}>Interested</Text></View>
              <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: colors.textFaint }]} /><Text style={styles.legendTxt}>Upcoming show</Text></View>
            </>
          ) : (
            <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: colors.amber }]} /><Text style={styles.legendTxt}>Your show history</Text></View>
          )}
          {tz ? <Text style={styles.tzTxt}>{tz}</Text> : null}
        </View>

        {view === CALENDAR_SHOW_VIEW.PAST && session && (historyInitialLoading || history.error || historyWindow.hasMore) ? (
          <View style={styles.historyProgress} accessibilityLiveRegion={history.error ? "assertive" : "polite"}>
            {historyInitialLoading ? (
              <>
                <ActivityIndicator size="small" color={colors.amber} />
                <Text style={styles.historyProgressText}>Loading your logged shows… Confirmed Here and Went attendance is already included.</Text>
              </>
            ) : history.error ? (
              <>
                <Icon name="x" size={17} color={colors.danger} />
                <Text style={styles.historyProgressText}>{historyOlderLoadFailed
                  ? "Some earlier logged shows could not be loaded. Your confirmed attendance is still shown."
                  : history.posts.length
                    ? "Your logged-show history could not be refreshed. Previously loaded shows and confirmed attendance are still shown."
                  : "Your logged shows could not be loaded. Your confirmed attendance is still shown."}</Text>
                <Pressable
                  style={styles.historyProgressButton}
                  onPress={retryHistory}
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading past shows"
                >
                  <Text style={styles.historyProgressButtonText}>Try again</Text>
                </Pressable>
              </>
            ) : historyWindow.hasMore ? (
              <>
                <Icon name="archive" size={17} color={colors.amber} />
                <Text style={styles.historyProgressText}>Older logged shows load in small batches so the calendar stays quick.</Text>
                <Pressable
                  style={[styles.historyProgressButton, history.loadingMore && styles.disabled]}
                  onPress={loadEarlierHistory}
                  disabled={history.loadingMore}
                  accessibilityRole="button"
                  accessibilityLabel="Load earlier past shows"
                  accessibilityState={{ disabled: history.loadingMore, busy: history.loadingMore }}
                >
                  {history.loadingMore ? <ActivityIndicator size="small" color={colors.amber} /> : null}
                  <Text style={styles.historyProgressButtonText}>{history.loadingMore ? "Loading…" : "Load earlier shows"}</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        ) : null}

        {view === CALENDAR_SHOW_VIEW.UPCOMING && goingEvents.length > 0 ? (
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
            <Text style={styles.emptyTxt}>{view === CALENDAR_SHOW_VIEW.PAST
              ? !session
                ? "Sign in to see your past shows."
                : historyInitialLoading
                  ? "Loading past shows…"
                  : history.error
                    ? "Some past shows may be unavailable."
                    : historyWindow.hasMore
                      ? "No past shows in the loaded history yet."
                    : "No past shows yet."
              : "Nothing on the calendar yet."}</Text>
            <Text style={styles.emptyHint}>{view === CALENDAR_SHOW_VIEW.PAST
              ? historyInitialLoading
                ? "Your confirmed attendance can appear first while logged reviews load."
                : history.error
                  ? "Try again above. Confirmed Here and Went attendance is still included without exposing it publicly."
                  : historyWindow.hasMore
                    ? "Load earlier shows above to keep looking through your history."
                  : "Shows you log or mark Went appear here on the night they happened."
              : "Tour dates land here automatically as they're announced. Mark a show Interested or Going to pin your own plans."}</Text>
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
                {view === CALENDAR_SHOW_VIEW.UPCOMING && ev.going ? <View style={styles.goingTag}><Text style={styles.goingTagTxt}>GOING</Text></View> : null}
                {view === CALENDAR_SHOW_VIEW.UPCOMING && !ev.going && ev.interested ? <View style={styles.interestedTag}><Text style={styles.interestedTagTxt}>INTERESTED</Text></View> : null}
                {view === CALENDAR_SHOW_VIEW.UPCOMING && !ev.going && !ev.interested && ev.logged ? <View style={styles.goingTag}><Text style={styles.goingTagTxt}>LOGGED</Text></View> : null}
                {view === CALENDAR_SHOW_VIEW.UPCOMING && !ev.going && !ev.interested && !ev.logged && ev.posted ? <View style={styles.goingTag}><Text style={styles.goingTagTxt}>POSTED</Text></View> : null}
                {view === CALENDAR_SHOW_VIEW.PAST && ev.logged ? <View style={styles.goingTag}><Text style={styles.goingTagTxt}>LOGGED</Text></View> : null}
                {view === CALENDAR_SHOW_VIEW.PAST && !ev.logged && ev.attended ? <View style={styles.goingTag}><Text style={styles.goingTagTxt}>WENT</Text></View> : null}
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
                  <Pressable style={styles.ticketBtn} onPress={() => { void openTicketLink(ev.ticketUrl, { onFailure: () => setCalendarNotice({ ok: false, text: "Tickets could not be opened on this device." }) }); }} hitSlop={6} accessibilityRole="link" accessibilityLabel={`Tickets for ${ev.artist || "show"}`}>
                    <Text style={styles.ticketTxt}>Tickets</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
      </VinylRefreshBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  refreshBoundary: { flex: 1 },
  wrap: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: space(4), paddingTop: 8 },
  refreshStatus: { color: colors.textDim, fontSize: 11.5, lineHeight: 17, marginBottom: 8 },
  refreshStatusError: { color: colors.danger },
  todayTarget: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  todayBtn: { color: colors.amber, fontSize: 13, fontWeight: "800" },

  viewTabs: { flexDirection: "row", padding: 4, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface, marginBottom: 12 },
  viewTab: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  viewTabSelected: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line },
  viewTabText: { color: colors.textDim, fontSize: 13, fontWeight: "800" },
  viewTabTextSelected: { color: colors.amber },

  historyProgress: { minHeight: 54, marginTop: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", gap: 9, flexWrap: "wrap" },
  historyProgressText: { flex: 1, minWidth: 190, color: colors.textDim, fontSize: 11.5, lineHeight: 17 },
  historyProgressButton: { minHeight: 44, paddingHorizontal: 13, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  historyProgressButtonText: { color: colors.amber, fontSize: 11.5, fontWeight: "800" },

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
  interestedTag: { backgroundColor: "rgba(187,84,142,0.12)", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.magenta, paddingHorizontal: 8, paddingVertical: 3 },
  interestedTagTxt: { color: colors.magenta, fontSize: 9, fontWeight: "900", letterSpacing: 0.65 },
  soldTag: { backgroundColor: "rgba(224,108,108,0.14)", borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  soldTagTxt: { color: colors.danger, fontSize: 9.5, fontWeight: "900", letterSpacing: 0.8 },
  eventActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", backgroundColor: colors.bgElev },
  ticketBtn: { minHeight: 44, justifyContent: "center", backgroundColor: colors.amberStrong, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  ticketTxt: { color: "#1A1206", fontSize: 12, fontWeight: "800" },
});
