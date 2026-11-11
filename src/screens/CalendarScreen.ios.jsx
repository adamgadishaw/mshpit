import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, ActionSheetIOS, ActivityIndicator, AppState, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { colors, font, radius, themeIsDark } from "../theme";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Icon from "../components/Icon";
import VinylRefreshBoundary from "../components/VinylRefreshBoundary";
import { openTicketLink } from "../lib/ticketLinks";
import { memberCalendarModel } from "../domain/calendarShows.mjs";
import { localCalendarIso } from "../domain/dates.mjs";
import { calendarReadDate } from "../domain/calendarDates.mjs";
import { CALENDAR_HISTORY_PAGE_SIZE, calendarHistoryWindow, nextCalendarHistoryLimit } from "../domain/calendarHistoryWindow.mjs";
import { useProfileHistory } from "../features/profileHistory/useProfileHistory";
import useIOSCalendarExport from "../hooks/useIOSCalendarExport";
import useCalendarBrowseState from "../hooks/useCalendarBrowseState";
import useCalendarShows from "../features/calendarShows/useCalendarShows";
import { calendarLocalEvent } from "../features/calendarShows/calendarShowsRequest.mjs";
import useIOSDetailBackBlock from "../hooks/useIOSDetailBackBlock";
import { createCalendarClock } from "./calendarClock.mjs";
import { countryForCity } from "../domain/geo.mjs";
import {
  CALENDAR_AGENDA_PAGE, CALENDAR_MAX_YEAR, CALENDAR_MIN_YEAR,
  calendarAgendaGroups, calendarDateKey, calendarDateLabel, calendarDaysForScope,
  calendarArtistSubtitle, calendarPlaceLabel, calendarMoreLabel, calendarDayAvailability,
  calendarJumpSelection, calendarLocalDate, calendarMonthGeometry,
  calendarMonthSelection, calendarMonthLabel, calendarShowName, calendarShowStatus, calendarTimeLabel,
} from "./calendarPresentation.mjs";

const pressed = ({ pressed: down }) => [styles.control, down && styles.pressed];
const monthName = calendarMonthLabel;

function Segment({ value, options, label, onChange }) {
  return <View style={styles.segment} accessibilityRole="tablist" accessibilityLabel={label}>
    {options.map(([key, title, spoken = title]) => <Pressable key={key} onPress={() => onChange(key)}
      style={({ pressed: down }) => [styles.segmentButton, key === value && styles.segmentSelected, down && styles.pressed]}
      accessibilityRole="tab" accessibilityState={{ selected: value === key }} accessibilityLabel={spoken}>
      <Text style={[styles.segmentText, value === key && styles.segmentTextSelected]}>{title}</Text>
    </Pressable>)}
  </View>;
}

function MoreDots() {
  return <View style={styles.moreDots} accessible={false} pointerEvents="none">{[0, 1, 2].map(index => <View key={index} style={styles.moreDot} />)}</View>;
}

function ShowRow({ event, view, onOpen, onMore, exporting }) {
  const status = calendarShowStatus(event, view);
  const name = calendarShowName(event);
  const statuses = [status, event.soldOut && status !== "Cancelled" ? "Sold out" : ""].filter(Boolean);
  const endDate = event.endDate || event.eventEndDate;
  const span = endDate && endDate > event.date;
  const time = calendarTimeLabel(event);
  const venue = [event.venue || "Venue TBA", event.city || event.place].filter(Boolean).join(" · ");
  const artist = calendarArtistSubtitle(event);
  return <View style={styles.eventRow}>
    <Pressable style={({ pressed: down }) => [styles.eventMain, down && styles.pressed]}
      onPress={() => onOpen(event)} accessibilityRole="button"
      accessibilityLabel={[name, time, venue, ...statuses, span ? `${calendarDateLabel(event.date, { year: "numeric" })} to ${calendarDateLabel(endDate, { year: "numeric" })}` : ""].filter(Boolean).join(", ")}>
      <Text style={styles.eventTime}>{time}</Text>
      <View style={styles.eventIdentity}>
        <Text style={styles.eventArtist}>{event.eventName || event.artist || "Show"}</Text>
        {artist ? <Text style={styles.eventVenue}>{artist}</Text> : null}
        <Text style={styles.eventVenue}>{event.venue || "Venue TBA"}</Text>
        {calendarPlaceLabel(event) ? <Text style={styles.eventLocation}>{calendarPlaceLabel(event)}</Text> : null}
        {span ? <Text style={styles.eventVenue}>{calendarDateLabel(event.date, { weekday: undefined, month: "short" })} – {calendarDateLabel(endDate, { weekday: undefined, month: "short", ...(event.date.slice(0, 4) !== endDate.slice(0, 4) ? { year: "numeric" } : {}) })}</Text> : null}
        {statuses.length ? <Text style={[styles.eventStatus, ["Cancelled", "Postponed"].includes(status) && styles.error]}>{statuses.join(" · ")}</Text> : null}
      </View>
    </Pressable>
    <Pressable onPress={() => onMore(event)} style={pressed} accessibilityRole="button" accessibilityLabel={calendarMoreLabel(event)} accessibilityState={{ busy: exporting }}>
      {exporting ? <ActivityIndicator color={colors.amber} /> : <MoreDots />}
    </Pressable>
  </View>;
}

export default function CalendarScreen({ initialDate = null, initialView = "upcoming", onClose, onOpen, onOpenArtist,
  browseMemory, browseOccurrence, isCurrentRoute }) {
  const { session, chatAuthEpoch, goingFor, myAttendance, refreshMyAttendance, serverTime } = useStore();
  const accountId = session?.id ?? null;
  const homeCity = String(session?.home?.city || "").trim();
  const homeCountry = session?.home?.country || countryForCity(homeCity) || "";
  const { width, fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.2;
  const history = useProfileHistory({ accountId, targetId: accountId, enabled: !!accountId });
  const historyInitialLoading = !!accountId && !history.updatedAt && !history.error
    && ["idle", "loading", "refreshing"].includes(history.status);
  const [clock, setClock] = useState(() => new Date());
  const [catalogueRestore, setCatalogueRestore] = useState({ ready: false, version: null });
  const todayKey = localCalendarIso(clock);
  const initial = calendarReadDate(initialDate) || todayKey;
  const initialDay = calendarLocalDate(initial);
  const browse = useCalendarBrowseState({ memory: browseMemory, occurrence: browseOccurrence, accountId, authEpoch: chatAuthEpoch,
    initialState: { selected: initial, cursor: { y: initialDay.getFullYear(), m: initialDay.getMonth() },
      view: initialView === "past" ? "past" : "upcoming", scope: "all", presentation: "month", historyVisibleLimit: CALENDAR_HISTORY_PAGE_SIZE },
    isCurrentRoute, restoreReady: !historyInitialLoading && catalogueRestore.ready, restoreContentVersion: catalogueRestore.version,
  });
  const { state, update, isCurrent } = browse;
  const { cursor, selected, view, scope, presentation } = state;
  const catalogue = useCalendarShows({ cursor, selected, presentation, scope, homeCity, homeCountry, restorePages: state.cataloguePages,
    accountId, authEpoch: chatAuthEpoch, enabled: view === "upcoming" && scope !== "plans", isCurrent, capture: browse.capture });
  const publicShows = view === "upcoming" && scope !== "plans";
  const historyWindow = useMemo(() => calendarHistoryWindow(history.posts, state.historyVisibleLimit, history.nextCursor),
    [history.posts, state.historyVisibleLimit, history.nextCursor]);
  const personalModel = useMemo(() => memberCalendarModel({ today: todayKey,
    going: accountId ? goingFor(accountId) || [] : [], attendance: accountId ? myAttendance || [] : [],
    posts: accountId ? historyWindow.posts : [],
  }), [todayKey, goingFor, accountId, myAttendance, historyWindow.posts]);
  // Public browsing covers the chosen calendar month, including its earlier
  // dates. Personal plans/history still use the actual current-day boundary.
  const modelDay = publicShows ? calendarDateKey(cursor.y, cursor.m, 1) : todayKey;
  const model = useMemo(() => publicShows ? memberCalendarModel({ today: modelDay, upcoming: catalogue.events,
    going: accountId ? goingFor(accountId) || [] : [], attendance: accountId ? myAttendance || [] : [],
    posts: accountId ? historyWindow.posts : [],
  }) : personalModel, [publicShows, personalModel, modelDay, catalogue.events, goingFor, accountId, myAttendance, historyWindow.posts]);
  const byDay = useMemo(() => {
    const scoped = calendarDaysForScope(model.byDay[view], view === "past" ? "plans" : scope);
    const monthPrefix = calendarDateKey(cursor.y, cursor.m, 1).slice(0, 7);
    const days = publicShows ? Object.fromEntries(Object.entries(scoped).filter(([date]) => date.startsWith(monthPrefix))) : scoped;
    return view === "upcoming" && scope === "local" ? Object.fromEntries(Object.entries(days)
      .map(([date, events]) => [date, events.filter(event => calendarLocalEvent(event, { homeCity, homeCountry, countryForCity }))])
      .filter(([, events]) => events.length)) : days;
  }, [model, view, scope, homeCity, homeCountry, publicShows, cursor.y, cursor.m]);
  // A native content-size callback must belong to the rows being restored,
  // even when history and catalogue pages finish in different orders.
  const contentVersion = useMemo(() => ({}), [byDay, selected, presentation, state.agendaLimit, historyInitialLoading]);
  useEffect(() => {
    const restored = (catalogue.loadedPages || 0) >= state.cataloguePages;
    const exhausted = catalogue.status === "ready" && !catalogue.hasMore;
    if (isCurrent() && (!publicShows || restored || exhausted || catalogue.needsLocation)) {
      setCatalogueRestore(current => current.ready && current.version === contentVersion ? current : { ready: true, version: contentVersion });
    }
    if (isCurrent() && publicShows && catalogue.loadedPages > state.cataloguePages) update({ cataloguePages: catalogue.loadedPages });
  }, [isCurrent, publicShows, catalogue.status, catalogue.needsLocation, catalogue.loadedPages, catalogue.hasMore, state.cataloguePages, contentVersion]);
  const geometry = useMemo(() => calendarMonthGeometry({ ...cursor, width, fontScale }), [cursor, width, fontScale]);
  const agenda = useMemo(() => calendarAgendaGroups(byDay, { selected, view, limit: state.agendaLimit }), [byDay, selected, view, state.agendaLimit]);
  const selectedEvents = byDay[selected] || [];
  const selectedVisible = selectedEvents.slice(0, state.agendaLimit);
  const groups = presentation === "agenda" ? agenda.groups : [{ date: selected, events: selectedVisible }];
  const remaining = presentation === "agenda" ? agenda.remaining : Math.max(0, selectedEvents.length - selectedVisible.length);
  const goingEvents = personalModel.upcoming.filter(event => event.going);
  const exportState = useIOSCalendarExport(accountId, chatAuthEpoch);
  const [feedback, setFeedback] = useState(null);
  const [refreshState, setRefreshState] = useState(null);
  const [olderFailure, setOlderFailure] = useState(null);
  const [jump, setJump] = useState(null);
  const refreshRef = useRef(null), historyLoadRef = useRef(null), menuRef = useRef(null);
  const clockRef = useRef(null);
  const serverTimeRef = useRef(serverTime);
  serverTimeRef.current = serverTime;
  const notice = feedback?.owner === isCurrent ? feedback.text : exportState.calendarNotice?.text;
  const noticeError = feedback?.owner === isCurrent || exportState.calendarNotice?.ok === false;
  const refreshing = refreshState?.owner === isCurrent && refreshState.busy;
  const refreshError = refreshState?.owner === isCurrent && refreshState.error;
  const jumpOpen = jump?.owner === isCurrent;
  useIOSDetailBackBlock(jumpOpen);

  useLayoutEffect(() => {
    return () => {
      refreshRef.current?.abort(); refreshRef.current = null;
      historyLoadRef.current = null; menuRef.current = null;
    };
  }, [isCurrent]);
  useEffect(() => {
    const accepts = browse.capture();
    const owner = createCalendarClock({ readTime: () => serverTimeRef.current(), onChange: setClock,
      isCurrent: accepts, isActive: () => AppState.currentState === "active", schedule: setTimeout, cancel: clearTimeout });
    clockRef.current = owner;
    void owner.refresh();
    const subscription = AppState.addEventListener("change", value => {
      if (value === "active") void owner.refresh();
      // Retire callbacks only: native dismissal is global and could close a
      // newer sheet presented by another feature.
      else { owner.pause(); menuRef.current = null; }
    });
    return () => { subscription.remove(); owner.retire(); if (clockRef.current === owner) clockRef.current = null; };
  }, [isCurrent]);
  useEffect(() => {
    if (!notice || !isCurrent() || AppState.currentState !== "active") return;
    AccessibilityInfo.announceForAccessibility(notice);
  }, [notice, isCurrent]);

  const choose = patch => {
    if (!isCurrent()) return;
    refreshRef.current?.abort(); refreshRef.current = null;
    setRefreshState(null); setJump(null); setFeedback(null);
    update({ ...patch, agendaLimit: CALENDAR_AGENDA_PAGE, cataloguePages: 1 });
  };
  const moveMonth = delta => {
    const next = calendarMonthSelection(cursor, delta, selected);
    if (next) choose(next);
  };
  const continueAgenda = () => {
    if (!isCurrent()) return;
    const next = calendarMonthSelection(cursor, 1, calendarDateKey(cursor.y, cursor.m, 1));
    if (!next) return;
    choose({ ...next, scrollY: 0 });
    browse.scrollRef.current?.scrollTo({ y: 0, animated: false });
  };
  const choosePeriod = next => {
    if (!isCurrent()) return;
    if (next === view) return;
    const keys = Object.keys(calendarDaysForScope((next === "past" ? personalModel : model).byDay[next], next === "past" ? "plans" : scope)).sort();
    const target = next === "past" ? keys.at(-1) || todayKey : keys.find(key => key >= todayKey) || todayKey;
    const date = calendarLocalDate(target);
    choose({ view: next, selected: target, cursor: { y: date.getFullYear(), m: date.getMonth() }, scrollY: 0 });
    browse.scrollRef.current?.scrollTo({ y: 0, animated: false });
  };
  const goToday = () => {
    if (!isCurrent()) return;
    const date = calendarLocalDate(todayKey);
    choose({ view: "upcoming", selected: todayKey, cursor: { y: date.getFullYear(), m: date.getMonth() }, scrollY: 0 });
    Keyboard.dismiss(); browse.scrollRef.current?.scrollTo({ y: 0, animated: false });
  };
  const showMenu = (title, actions) => {
    const accepts = browse.capture();
    if (!accepts() || AppState.currentState !== "active" || menuRef.current) return;
    const token = {}; menuRef.current = token;
    try { ActionSheetIOS.showActionSheetWithOptions({ title, options: [...actions.map(action => action.title), "Cancel"],
      cancelButtonIndex: actions.length, disabledButtonIndices: actions.flatMap((action, i) => action.disabled ? [i] : []), tintColor: colors.amber,
      userInterfaceStyle: themeIsDark ? "dark" : "light",
    }, index => {
      if (menuRef.current !== token) return;
      menuRef.current = null;
      if (accepts() && AppState.currentState === "active" && actions[index] && !actions[index].disabled) actions[index].run();
    }); } catch {
      if (menuRef.current === token) menuRef.current = null;
      if (accepts()) setFeedback({ owner: isCurrent, text: "The options could not open. Please try again." });
    }
  };
  const saveCalendar = (events, key) => {
    if (!isCurrent()) return;
    setFeedback(null);
    return exportState.saveCalendar(events, key);
  };
  const openEvent = event => {
    if (!isCurrent()) return;
    onOpen?.({ ...event, city: event.city || event.place });
  };
  const eventActions = event => {
    const accepts = browse.capture();
    const status = calendarShowStatus(event, view);
    const actions = [{ title: "Open show", run: () => openEvent(event) },
      { title: "Save to calendar", disabled: !!exportState.exportingKey, run: () => saveCalendar(event, `event-${event.calendarKey}`) }];
    if (onOpenArtist && event.artist) actions.push({ title: "Open artist", run: () => onOpenArtist(event.artist) });
    if (event.ticketUrl && !["Cancelled", "Postponed"].includes(status)) actions.push({ title: "View tickets at seller", run: () => {
      setFeedback(null);
      void openTicketLink(event.ticketUrl, { isCurrent: accepts, onFailure: () => {
        if (accepts()) setFeedback({ owner: isCurrent, text: "Tickets could not be opened. Please try again from the show." });
      } });
    } });
    showMenu(calendarShowName(event), actions);
  };
  const changeScope = () => showMenu("Calendar shows", [
    { title: scope === "all" ? "All shows (selected)" : "All shows", run: () => choose({ scope: "all" }) },
    { title: homeCity ? `${homeCity}${scope === "local" ? " (selected)" : ""}` : "Home city not set", disabled: !homeCity, run: () => choose({ scope: "local" }) },
    { title: scope === "plans" ? "My plans (selected)" : "My plans", disabled: !accountId, run: () => choose({ scope: "plans" }) },
  ]);
  const calendarActions = () => showMenu("Calendar options", [
    { title: "Save my Going shows", disabled: !goingEvents.length || !!exportState.exportingKey,
      run: () => saveCalendar(goingEvents, "all") },
    { title: "Refresh calendar", disabled: refreshing, run: () => { void refreshCalendar(); } },
  ]);
  const refreshCalendar = async () => {
    const accepts = browse.capture();
    if (!accepts() || refreshRef.current) return false;
    const controller = new AbortController(); refreshRef.current = controller;
    setRefreshState({ owner: isCurrent, busy: true, error: false });
    const results = await Promise.allSettled([
      Promise.resolve().then(() => accepts() ? publicShows ? catalogue.refresh({ signal: controller.signal }) : true : false),
      Promise.resolve().then(() => accepts() ? accountId ? refreshMyAttendance?.({ signal: controller.signal }) : true : false),
      Promise.resolve().then(() => accepts() ? accountId ? history.retry() : true : false),
      Promise.resolve().then(() => accepts() ? clockRef.current?.refresh() : false),
    ]);
    if (!accepts() || controller.signal.aborted || refreshRef.current !== controller) return false;
    const failed = results.some((result, index) => result.status === "rejected" || result.value === false || result.value == null
      || result.value?.ok === false || (index === 0 && result.value?.ok === true && result.value.value !== true)
      || (index === 2 && result.value?.status === "error"));
    refreshRef.current = null; setRefreshState({ owner: isCurrent, busy: false, error: failed });
    if (failed) AccessibilityInfo.announceForAccessibility("Some calendar details could not refresh. Your loaded shows are still available.");
    return !failed;
  };
  const loadEarlier = async () => {
    const accepts = browse.capture();
    if (!accepts() || history.loadingMore || historyLoadRef.current) return;
    if (historyWindow.hasBufferedPage) { update({ historyVisibleLimit: nextCalendarHistoryLimit(state.historyVisibleLimit) }); return; }
    if (!historyWindow.hasServerPage) return;
    const token = {}; historyLoadRef.current = token;
    setOlderFailure(null);
    try {
      const result = await history.loadMore();
      if (!accepts() || historyLoadRef.current !== token) return;
      if (result?.error) setOlderFailure(() => isCurrent);
      else update(current => ({ historyVisibleLimit: nextCalendarHistoryLimit(current.historyVisibleLimit) }));
    } catch {
      if (accepts() && historyLoadRef.current === token) setOlderFailure(() => isCurrent);
    } finally { if (historyLoadRef.current === token) historyLoadRef.current = null; }
  };
  const retryHistory = () => {
    if (!isCurrent()) return;
    if (olderFailure === isCurrent) { void loadEarlier(); return; }
    const accepts = browse.capture();
    Promise.resolve().then(() => accepts() && history.retry()).catch(() => {
      if (accepts()) setOlderFailure(() => isCurrent);
    });
  };
  const openJump = () => {
    if (!isCurrent()) return;
    setJump({ owner: isCurrent, year: String(cursor.y), month: cursor.m, error: false });
  };
  const commitJump = () => {
    if (!isCurrent() || !jumpOpen) return;
    const next = calendarJumpSelection(jump.year, jump.month, selected);
    if (!next) { setJump({ ...jump, error: true }); AccessibilityInfo.announceForAccessibility(`Enter a year from ${CALENDAR_MIN_YEAR} to ${CALENDAR_MAX_YEAR}.`); return; }
    choose({ ...next, scrollY: 0 }); Keyboard.dismiss(); browse.scrollRef.current?.scrollTo({ y: 0, animated: false });
  };
  const closeJump = () => { if (isCurrent()) { setJump(null); Keyboard.dismiss(); } };
  const changeJump = patch => { if (isCurrent() && jumpOpen) setJump({ ...jump, ...patch }); };
  const orderedDates = [...new Set([...Object.keys(byDay), ...(publicShows ? Object.keys(catalogue.dayPresence || {}).filter(key => catalogue.dayPresence[key]) : [])])].sort();
  if (view === "past") orderedDates.reverse();
  const nextRelevant = orderedDates.find(key => view === "past" ? key < selected : key > selected);
  const nextDate = () => {
    const date = calendarLocalDate(nextRelevant);
    if (date) choose({ selected: nextRelevant, cursor: { y: date.getFullYear(), m: date.getMonth() } });
  };

  return <View style={styles.wrap}>
    <ScreenHeader title="Calendar" onBack={() => { if (isCurrent()) onClose?.(); }} right={<Pressable onPress={goToday} style={pressed} accessibilityRole="button" accessibilityLabel="Go to today"><Text style={styles.actionText}>Today</Text></Pressable>} />
    <View style={styles.contextBar}>
      {view === "upcoming" ? <Pressable onPress={changeScope} style={({ pressed: down }) => [styles.scopeButton, down && styles.pressed]} accessibilityRole="button"
        accessibilityLabel={`Calendar scope: ${scope === "plans" ? "My plans" : scope === "local" ? homeCity || "Home city not set" : "All shows"}. Change scope`}>
        <View style={styles.scopeIdentity}><Text style={styles.scopeText}>{scope === "plans" ? "My plans" : scope === "local" ? homeCity || "Home city not set" : "All shows"}</Text>
          <Text style={styles.scopeDetail}>{scope === "plans" ? "Your saved shows" : scope === "local" ? "Home city" : "Worldwide"}</Text></View>
        <Icon name="chevron-down" size={16} />
      </Pressable> : <View style={styles.scopeIdentity}><Text style={styles.scopeText}>Past shows</Text><Text style={styles.scopeDetail}>Your show history</Text></View>}
      <Pressable onPress={calendarActions} style={pressed} accessibilityRole="button" accessibilityLabel="Calendar options" accessibilityState={{ busy: !!exportState.exportingKey }}><MoreDots /></Pressable>
    </View>
    <VinylRefreshBoundary refreshing={!!refreshing} onRefresh={refreshCalendar} accessibilityLabel="Refresh your calendar" style={styles.fill} testID="calendar-refresh">
      <ScrollView ref={browse.scrollRef} style={styles.fill} contentContainerStyle={styles.content}
        keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
        onScroll={browse.onScroll} scrollEventThrottle={32} onScrollBeginDrag={browse.onScrollBeginDrag}
        onLayout={browse.onLayout} onContentSizeChange={(contentWidth, contentHeight) => browse.onContentSizeChange(contentWidth, contentHeight, contentVersion)}>
        <View style={[styles.displayControls, (largeText || width < 380) && styles.displayControlsLarge]}>
          <Segment value={view} options={[["upcoming", "Shows"], ["past", "History", "Past shows"]]} label="Calendar show period" onChange={choosePeriod} />
          <Segment value={presentation} options={[["month", "Month"], ["agenda", "Agenda"]]} label="Calendar presentation" onChange={next => choose({ presentation: next })} />
        </View>
        <View style={styles.monthBar}>
          <Pressable onPress={() => moveMonth(-1)} style={pressed} disabled={cursor.y === CALENDAR_MIN_YEAR && cursor.m === 0} accessibilityRole="button" accessibilityLabel="Previous month"><Icon name="chevron-left" size={22} /></Pressable>
          <Pressable onPress={openJump} style={({ pressed: down }) => [styles.monthTitleButton, down && styles.pressed]} accessibilityRole="button" accessibilityLabel={`${monthName(cursor.y, cursor.m)}. Jump to month`} accessibilityState={{ expanded: jumpOpen }}>
            <Text style={styles.monthTitle}>{monthName(cursor.y, cursor.m)}</Text><Icon name="chevron-down" size={15} />
          </Pressable>
          <Pressable onPress={() => moveMonth(1)} style={pressed} disabled={cursor.y === CALENDAR_MAX_YEAR && cursor.m === 11} accessibilityRole="button" accessibilityLabel="Next month"><Icon name="chevron-right" size={22} /></Pressable>
        </View>
        {jumpOpen ? <View style={styles.jumpPanel} onAccessibilityEscape={closeJump}>
          <Text style={styles.heading} accessibilityRole="header">Jump to month</Text>
          <View style={styles.yearRow}>
            <Pressable style={pressed} onPress={() => changeJump({ year: String(Math.max(CALENDAR_MIN_YEAR, (Number(jump.year) || cursor.y) - 1)), error: false })} accessibilityRole="button" accessibilityLabel="Previous year"><Icon name="minus" size={20} /></Pressable>
            <TextInput style={styles.yearInput} accessibilityLabel="Calendar year" accessibilityHint={`Enter four digits, ${CALENDAR_MIN_YEAR} to ${CALENDAR_MAX_YEAR}`} value={jump.year} keyboardType="number-pad" maxLength={4} selectTextOnFocus
              onChangeText={value => changeJump({ year: value.replace(/\D/g, ""), error: false })} onSubmitEditing={commitJump} />
            <Pressable style={pressed} onPress={() => changeJump({ year: String(Math.min(CALENDAR_MAX_YEAR, (Number(jump.year) || cursor.y) + 1)), error: false })} accessibilityRole="button" accessibilityLabel="Next year"><Icon name="plus" size={20} /></Pressable>
          </View>
          <View style={styles.monthChoices}>{Array.from({ length: 12 }, (_, m) => <Pressable key={m} style={({ pressed: down }) => [styles.monthChoice, largeText && styles.monthChoiceLarge, jump.month === m && styles.monthChoiceSelected, down && styles.pressed]} onPress={() => changeJump({ month: m })}
            accessibilityRole="button" accessibilityState={{ selected: jump.month === m }}><Text style={[styles.monthChoiceText, jump.month === m && styles.segmentTextSelected]}>{calendarMonthLabel(2026, m, undefined, false)}</Text></Pressable>)}</View>
          {jump.error ? <Text style={styles.error} accessibilityRole="alert">Enter a year from {CALENDAR_MIN_YEAR} to {CALENDAR_MAX_YEAR}.</Text> : null}
          <View style={styles.jumpActions}><Pressable style={pressed} onPress={closeJump} accessibilityRole="button"><Text style={styles.actionText}>Cancel</Text></Pressable><Pressable style={pressed} onPress={commitJump} accessibilityRole="button"><Text style={styles.actionText}>Show month</Text></Pressable></View>
        </View> : null}
        {presentation === "month" ? <>
          <ScrollView horizontal showsHorizontalScrollIndicator={geometry.width > width - 8} contentContainerStyle={styles.gridScroller} accessibilityLabel={`${monthName(cursor.y, cursor.m)} calendar`}>
            <View style={{ width: geometry.width }}>
              <View style={styles.weekdays} accessible={false}>{geometry.weekdays.map((day, i) => <Text key={i} style={styles.weekday}>{day}</Text>)}</View>
              <View style={styles.grid}>{geometry.cells.map((day, i) => {
                if (day == null) return <View key={`blank-${i}`} style={[styles.day, { minHeight: geometry.cellHeight }]} accessible={false} />;
                const date = calendarDateKey(cursor.y, cursor.m, day), events = byDay[date] || [];
                const personal = events.filter(event => event.going || event.interested || event.attended || event.logged || event.posted).length;
                const isToday = date === todayKey, active = date === selected;
                const presence = publicShows ? catalogue.dayPresence?.[date] : undefined;
                const hasShows = !!events.length || presence === true;
                const availability = calendarDayAvailability(events.length, { publicShows, presence,
                  complete: publicShows ? date === selected && presentation === "month" && catalogue.coverage?.complete : !historyWindow.hasMore && !historyInitialLoading && !history.error });
                return <Pressable key={date} onPress={() => choose({ selected: date })} accessibilityRole="button" accessibilityState={{ selected: active }}
                  accessibilityLabel={`${calendarDateLabel(date)}${isToday ? ", today" : ""}, ${availability}${personal ? `, ${personal} in your plans or history` : ""}`}
                  style={({ pressed: down }) => [styles.day, { minHeight: geometry.cellHeight }, down && styles.pressed]}>
                  <View style={[styles.dayNumber, isToday && styles.todayNumber, active && styles.selectedNumber]}><Text style={[styles.dayText, active && styles.selectedDayText]}>{day}</Text></View>
                  <View style={styles.dayMarker} accessible={false}>{hasShows ? <View style={[styles.showDot, personal > 0 && styles.personalDot]} /> : null}</View>
                </Pressable>;
              })}</View>
            </View>
          </ScrollView>
        </> : <Text style={styles.monthSummary}>{publicShows ? "Through" : view === "past" ? "Through" : "From"} {calendarDateLabel(publicShows ? calendarDateKey(cursor.y, cursor.m, new Date(cursor.y, cursor.m + 1, 0).getDate()) : selected, { weekday: undefined, year: "numeric" })}</Text>}
        <View style={styles.section}>
          {publicShows && (catalogue.status === "loading" || catalogue.status === "refreshing" || catalogue.error || catalogue.needsLocation || !catalogue.summaryComplete) ? <View style={styles.statusBox}>
            <Text style={styles.statusText} accessibilityRole={catalogue.error ? "alert" : "text"}>{catalogue.needsLocation ? "Set your home city in your profile to see local shows."
              : catalogue.error ? "Shows for this date could not load. Availability may be incomplete."
                : catalogue.status === "loading" || catalogue.status === "refreshing" ? "Loading shows…" : "Some dates are still unconfirmed. Select a date to check its shows."}</Text>
            {catalogue.error ? <Pressable onPress={() => { void catalogue.refresh(); }} style={pressed} accessibilityRole="button"><Text style={styles.actionText}>Retry shows</Text></Pressable> : null}
          </View> : null}
          {refreshing || refreshError ? <View style={styles.statusBox}><Text style={[styles.statusText, refreshError && styles.error]} accessibilityRole={refreshError ? "alert" : "text"}>{refreshing ? "Refreshing your calendar…" : "Some details could not refresh. Your loaded shows are still available."}</Text>{refreshError ? <Pressable onPress={() => { void refreshCalendar(); }} style={pressed} accessibilityRole="button"><Text style={styles.actionText}>Try again</Text></Pressable> : null}</View> : null}
          {notice ? <Text style={[styles.notice, noticeError && styles.error]} accessibilityRole={noticeError ? "alert" : "text"}>{notice}</Text> : null}
          {groups.map(group => <View key={group.date} style={styles.dayGroup}>
            <Text style={styles.heading} accessibilityRole="header">{calendarDateLabel(group.date, { year: "numeric" })}</Text>
            {group.events.length ? <Text style={styles.timeHint}>Times at the venue unless labelled</Text> : null}
            {group.events.map(event => <ShowRow key={event.calendarKey} event={event} view={view} largeText={largeText} onOpen={openEvent} onMore={eventActions} exporting={exportState.exportingKey === `event-${event.calendarKey}`} />)}
          </View>)}
          {(presentation === "month" ? !selectedEvents.length : !agenda.count) ? <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{historyInitialLoading && view === "past" ? "Loading your past shows…" : view === "past" ? "No shows in this part of your loaded history." : scope === "plans" ? "No plans on this date."
              : catalogue.needsLocation || catalogue.error || !catalogue.coverage?.complete ? "" : presentation === "agenda" ? "No more shows listed in this month." : scope === "local" ? `No shows listed in ${homeCity} on this date.` : "No shows listed on this date."}</Text>
            {nextRelevant ? <Pressable onPress={nextDate} style={pressed} accessibilityRole="button"><Text style={styles.actionText}>{view === "past" ? "Previous loaded show" : "Next listed date"} · {calendarDateLabel(nextRelevant, { weekday: undefined, year: "numeric" })}</Text></Pressable> : view === "upcoming" && scope === "plans" ? <Pressable onPress={() => choose({ scope: "all" })} style={pressed} accessibilityRole="button"><Text style={styles.actionText}>Browse all shows</Text></Pressable> : null}
          </View> : null}
          {remaining ? <Pressable onPress={() => update({ agendaLimit: state.agendaLimit + CALENDAR_AGENDA_PAGE })} style={styles.loadButton} accessibilityRole="button"><Text style={styles.actionText}>Show more ({remaining})</Text></Pressable> : null}
          {publicShows && !remaining && catalogue.hasMore ? <Pressable onPress={() => { void catalogue.loadMore(); }} style={styles.loadButton} disabled={catalogue.loadingMore} accessibilityRole="button" accessibilityState={{ busy: catalogue.loadingMore, disabled: catalogue.loadingMore }}><Text style={styles.actionText}>{catalogue.loadingMore ? "Loading…" : "Load more shows"}</Text></Pressable> : null}
          {publicShows && presentation === "agenda" && !remaining && !catalogue.hasMore && catalogue.coverage?.complete && !(cursor.y === CALENDAR_MAX_YEAR && cursor.m === 11) ? <Pressable onPress={continueAgenda} style={styles.loadButton} accessibilityRole="button"><Text style={styles.actionText}>Next month</Text></Pressable> : null}
          {accountId && (historyInitialLoading || history.error || olderFailure === isCurrent || historyWindow.hasMore) ? <View style={styles.historyBox}>
            {historyInitialLoading ? <ActivityIndicator color={colors.amber} /> : null}
            <Text style={styles.statusText}>{historyInitialLoading ? "Loading your logged shows. Confirmed attendance can appear first."
              : history.error || olderFailure === isCurrent ? "Some logged shows could not load. Previously loaded shows and confirmed attendance are still available."
                : "More logged shows are available in your history."}</Text>
            {history.error || olderFailure === isCurrent ? <Pressable onPress={retryHistory} style={pressed} accessibilityRole="button"><Text style={styles.actionText}>Retry history</Text></Pressable>
              : historyWindow.hasMore ? <Pressable onPress={() => { void loadEarlier(); }} style={pressed} disabled={history.loadingMore} accessibilityRole="button" accessibilityState={{ busy: history.loadingMore, disabled: history.loadingMore }}><Text style={styles.actionText}>{history.loadingMore ? "Loading…" : "Load earlier shows"}</Text></Pressable> : null}
          </View> : null}
        </View>
      </ScrollView>
    </VinylRefreshBoundary>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg }, fill: { flex: 1, minHeight: 0 }, content: { paddingTop: 8, paddingBottom: 40 },
  section: { paddingHorizontal: 16 }, pressed: { opacity: 0.62 },
  control: { minWidth: 44, minHeight: 44, paddingHorizontal: 10, paddingVertical: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, flexShrink: 1 },
  actionText: { color: colors.amber, fontSize: 15, fontWeight: "600", flexShrink: 1 },
  segment: { flex: 1, flexDirection: "row", backgroundColor: colors.surfaceAlt, borderRadius: 10, padding: 2 },
  segmentButton: { flex: 1, minWidth: 0, minHeight: 44, paddingVertical: 8, paddingHorizontal: 5, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  segmentSelected: { backgroundColor: colors.bgElev }, segmentText: { color: colors.textDim, fontSize: 15, fontWeight: "600", textAlign: "center" }, segmentTextSelected: { color: colors.amber },
  contextBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingHorizontal: 16, paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  scopeButton: { flex: 1, minWidth: 0, minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  scopeIdentity: { flexShrink: 1, minWidth: 0 }, scopeText: { color: colors.text, fontSize: 16, fontWeight: "600", flexShrink: 1 }, scopeDetail: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  displayControls: { flexDirection: "row", gap: 8, paddingHorizontal: 16 }, displayControlsLarge: { flexDirection: "column", alignItems: "stretch" },
  monthBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 6, marginTop: 8, marginBottom: 4 },
  monthTitleButton: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8 },
  monthTitle: { color: colors.text, fontSize: 20, fontWeight: "700", textAlign: "center", flexShrink: 1 },
  gridScroller: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 4 }, weekdays: { flexDirection: "row", paddingVertical: 8 }, weekday: { flex: 1, textAlign: "center", color: colors.textDim, fontSize: 12 }, grid: { flexDirection: "row", flexWrap: "wrap" },
  day: { width: `${100 / 7}%`, minHeight: 44, alignItems: "center", justifyContent: "center", paddingVertical: 3 },
  dayNumber: { minWidth: 30, minHeight: 30, borderRadius: 20, paddingHorizontal: 3, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "transparent" }, todayNumber: { borderColor: colors.amber }, selectedNumber: { backgroundColor: colors.amber, borderColor: colors.amber },
  dayText: { fontSize: 15, color: colors.text, fontWeight: "500" }, selectedDayText: { color: colors.bg, fontWeight: "700" },
  dayMarker: { height: 10, justifyContent: "center" }, showDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.textDim }, personalDot: { backgroundColor: colors.amber },
  monthSummary: { color: colors.textDim, fontSize: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14 },
  dayGroup: { marginTop: 16, marginBottom: 16 }, heading: { color: colors.text, fontSize: 17, fontWeight: "600", marginBottom: 5 }, timeHint: { color: colors.textDim, fontSize: 12, marginBottom: 12 },
  eventRow: { flexDirection: "row", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, gap: 4 },
  eventMain: { flex: 1, minWidth: 0, minHeight: 56, flexDirection: "column", alignItems: "stretch", gap: 5, paddingVertical: 14 },
  eventTime: { color: colors.textDim, fontSize: 13, fontWeight: "500", flexShrink: 1 }, eventIdentity: { minWidth: 0 },
  eventArtist: { color: colors.text, fontSize: 17, fontWeight: "600" }, eventVenue: { color: colors.textDim, fontSize: 14, marginTop: 4 }, eventLocation: { color: colors.textDim, fontSize: 13, marginTop: 3 }, eventStatus: { color: colors.amber, fontSize: 13, fontWeight: "500", marginTop: 5 },
  moreDots: { flexDirection: "row", gap: 4, alignItems: "center", justifyContent: "center" }, moreDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.textDim },
  empty: { paddingVertical: 18, alignItems: "flex-start", gap: 6 }, emptyTitle: { color: colors.textDim, fontSize: 15 },
  statusBox: { marginBottom: 14, gap: 4 }, statusText: { color: colors.textDim, fontSize: 14, lineHeight: 20 }, notice: { color: colors.textDim, fontSize: 14, lineHeight: 20, marginBottom: 14 }, error: { color: colors.danger, fontSize: 14 },
  historyBox: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: 14, gap: 8, alignItems: "flex-start" }, loadButton: { minHeight: 44, padding: 12, alignItems: "center", marginBottom: 12 },
  jumpPanel: { marginHorizontal: 16, padding: 12, backgroundColor: colors.surface, borderRadius: radius.md, gap: 10, marginBottom: 12 }, yearRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  yearInput: { flex: 1, minWidth: 60, maxWidth: 180, minHeight: 44, color: colors.text, fontFamily: font, fontSize: 20, textAlign: "center", backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 8 },
  monthChoices: { flexDirection: "row", flexWrap: "wrap" }, monthChoice: { width: "33.333333%", minHeight: 44, padding: 8, justifyContent: "center", borderRadius: 8 }, monthChoiceLarge: { width: "50%" }, monthChoiceSelected: { backgroundColor: colors.surfaceAlt }, monthChoiceText: { color: colors.text, fontSize: 14, textAlign: "center" }, jumpActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
});
