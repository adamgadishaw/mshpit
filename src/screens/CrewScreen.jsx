import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import Avatar from "../components/Avatar";
import Button from "../components/Button";
import Icon from "../components/Icon";
import ScreenHeader from "../components/ScreenHeader";
import SmartImage from "../components/SmartImage";
import SwipeDeck from "../components/SwipeDeck";
import useReducedMotion from "../hooks/useReducedMotion";
import {
  fetchCrewPeople,
  fetchCrewShows,
  fetchMyCrew,
  markCrewShow,
  passCrewShow,
  startCrewSeeking,
  stopCrewSeeking,
  swipeCrewPerson,
} from "../lib/crewApi";
import { useStore } from "../store";
import { colors, displayFont, radius, space } from "../theme";
import { CREW_NOTE_MAX, CREW_PURPOSES, CREW_PURPOSE_LIMIT, crewCountLabel, crewDateLabel, crewPurposeLabels } from "../domain/crew.mjs";

const PURPOSE_OPTIONS = Object.entries(CREW_PURPOSES).map(([id, label]) => ({ id, label }));
const SAFETY_TIPS = "Meet somewhere public, tell a friend your plans, and trust your gut. You can block or report anyone at any time.";

function ShowCard({ show }) {
  const image = show.eventImage?.uri || null;
  return (
    <View style={styles.cardFill}>
      {image ? (
        <SmartImage uri={image} style={StyleSheet.absoluteFill} contain={false} accessibilityLabel={`${show.artist} event image`} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.cardGradient]}>
          <View style={styles.cardArt} aria-hidden><Icon name="music" size={112} color={colors.amber} strokeWidth={1.4} /></View>
        </View>
      )}
      <View style={styles.cardShade} />
      <View style={styles.cardBody}>
        <Text style={styles.cardKicker}>{crewDateLabel(show.date)}</Text>
        <Text style={styles.cardTitle} numberOfLines={2}>{show.artist}</Text>
        <View style={styles.cardRow}>
          <Icon name="pin" size={14} color={colors.amber} />
          <Text style={styles.cardMeta} numberOfLines={1}>{[show.venue, show.venueCity || show.place].filter(Boolean).join(" · ")}</Text>
        </View>
        <View style={styles.cardChips}>
          <View style={styles.countChip}><Icon name="you" size={12} color={colors.text} /><Text style={styles.countText}>{crewCountLabel(show.counts?.going, "going")}</Text></View>
          {show.counts?.lookingForCrew ? (
            <View style={[styles.countChip, styles.countChipHot]}><Icon name="heart" size={12} color="#1A1206" /><Text style={[styles.countText, { color: "#1A1206" }]}>{crewCountLabel(show.counts.lookingForCrew, "crew")}</Text></View>
          ) : null}
        </View>
        {show.eventImage?.attribution ? <Text style={styles.credit} numberOfLines={1}>Image: {show.eventImage.attribution}</Text> : null}
      </View>
    </View>
  );
}

function PersonCard({ person, onSafety }) {
  return (
    <View style={[styles.cardFill, styles.personCard]}>
      <View style={styles.personTop}>
        <Avatar user={person} size={112} />
        <Text style={styles.personName} numberOfLines={1}>{person.name}</Text>
        <Text style={styles.personMeta} numberOfLines={1}>@{person.handle}{person.city ? ` · ${person.city}` : ""}</Text>
        <View style={[styles.statePill, person.going ? styles.statePillGoing : null]}>
          <Text style={[styles.stateText, person.going ? { color: "#1A1206" } : null]}>{person.going ? "Going" : "Interested"}</Text>
        </View>
      </View>
      {person.purposes?.length ? (
        <View style={styles.purposeRow}>
          {crewPurposeLabels(person.purposes).map((label) => <View key={label} style={styles.purpose}><Text style={styles.purposeText}>{label}</Text></View>)}
        </View>
      ) : null}
      {person.note ? <Text style={styles.personNote} numberOfLines={3}>"{person.note}"</Text> : null}
      <View style={styles.personFacts}>
        {person.sharedArtists?.length ? <Text style={styles.fact}>You both love {person.sharedArtists.join(", ")}</Text> : null}
        {person.sharedShows ? <Text style={styles.fact}>You've been to {person.sharedShows} of the same {person.sharedShows === 1 ? "show" : "shows"}</Text> : null}
        {!person.sharedArtists?.length && person.favoriteArtists?.length ? <Text style={styles.fact}>Into {person.favoriteArtists.join(", ")}</Text> : null}
      </View>
      <Pressable onPress={() => onSafety(person)} style={styles.safetyLink} accessibilityRole="button" accessibilityLabel={`Block or report ${person.name}`}>
        <Icon name="shield" size={13} color={colors.textFaint} /><Text style={styles.safetyLinkText}>Block or report</Text>
      </Pressable>
    </View>
  );
}

function DeckButtons({ onPass, onUp, onYes, yesLabel, upLabel, disabled }) {
  return (
    <View style={styles.deckButtons}>
      <Pressable style={[styles.roundButton, styles.passButton]} onPress={onPass} disabled={disabled} accessibilityRole="button" accessibilityLabel="Pass">
        <Icon name="x" size={26} color={colors.danger} strokeWidth={3} />
      </Pressable>
      {onUp ? (
        <Pressable style={[styles.roundButton, styles.upButton]} onPress={onUp} disabled={disabled} accessibilityRole="button" accessibilityLabel={upLabel}>
          <Icon name="star" size={22} color={colors.gold} />
        </Pressable>
      ) : null}
      <Pressable style={[styles.roundButton, styles.yesButton]} onPress={onYes} disabled={disabled} accessibilityRole="button" accessibilityLabel={yesLabel}>
        <Icon name="check" size={26} color="#1A1206" strokeWidth={3} />
      </Pressable>
    </View>
  );
}

// Crew: swipe through upcoming shows, say you're going, then swipe through
// other adults looking for a crew for the same show. Two yeses open a chat.
// `initialShow` ({ tourDateId, artist, venue, date }) opens straight to one show.
export default function CrewScreen({ initialShow = null, onClose, onOpenThread, onOpenShow, onRequireAuth, onOpenSettings, onReport }) {
  const { session, blockUser } = useStore();
  const reduceMotion = useReducedMotion();
  const [tab, setTab] = useState(initialShow?.tourDateId ? "crews" : "shows");
  const [me, setMe] = useState(null);
  const [deck, setDeck] = useState({ status: "idle", shows: [], city: null });
  const [cityInput, setCityInput] = useState("");
  const [editingCity, setEditingCity] = useState(false);
  const [setup, setSetup] = useState(null);
  const [active, setActive] = useState(null);
  const [people, setPeople] = useState({ status: "idle", list: [] });
  const [match, setMatch] = useState(null);
  const [safety, setSafety] = useState(null);
  const [notice, setNotice] = useState("");
  const showDeckRef = useRef(null);
  const peopleDeckRef = useRef(null);

  const loadMe = useCallback(async () => {
    if (!session) return;
    try { setMe(await fetchMyCrew()); } catch { setMe((current) => current || { eligible: false, ageBand: null, shows: [], matches: [], failed: true }); }
  }, [session]);

  const loadDeck = useCallback(async (city = null) => {
    if (!session) return;
    setDeck((current) => ({ ...current, status: "loading" }));
    try {
      const result = await fetchCrewShows({ city });
      setDeck({ status: "ready", shows: result?.shows || [], city: result?.city || null });
      showDeckRef.current?.reset();
    } catch {
      setDeck({ status: "error", shows: [], city });
    }
  }, [session]);

  useEffect(() => {
    void loadMe();
    void loadDeck();
  }, [loadMe, loadDeck]);

  const openPeople = useCallback(async (show) => {
    setActive(show);
    setTab("crews");
    setPeople({ status: "loading", list: [] });
    try {
      const result = await fetchCrewPeople(show.tourDateId);
      setPeople({ status: "ready", list: result?.people || [] });
      peopleDeckRef.current?.reset();
    } catch (error) {
      setPeople({ status: "error", list: [], message: failure(error, "") });
    }
  }, []);

  const openedFor = useRef(null);
  useEffect(() => {
    const id = initialShow?.tourDateId;
    if (!id || !me || me.failed || openedFor.current === id) return;
    openedFor.current = id;
    const seeking = me.shows?.find((show) => show.tourDateId === id);
    if (seeking) void openPeople(seeking);
    else if (me.eligible && me.emailConfirmed) setSetup({ ...initialShow, purposes: [], note: "" });
  }, [initialShow, me, openPeople]);

  const flash = (message) => {
    setNotice(message);
    setTimeout(() => setNotice((current) => (current === message ? "" : current)), 3500);
  };

  const failure = (error, fallback) => error?.userMessage || fallback;

  // Answered cards leave the list at once; a failed save puts the card back on top.
  const onShowSwipe = async (show, direction) => {
    const without = (list) => list.filter((item) => item.tourDateId !== show.tourDateId);
    setDeck((current) => ({ ...current, shows: without(current.shows) }));
    try {
      if (direction === "left") { await passCrewShow(show.tourDateId); return; }
      await markCrewShow(show.tourDateId, direction === "up" ? "interested" : "going");
      flash(direction === "up" ? `Saved ${show.artist} as interested.` : `You're going to ${show.artist}.`);
      if (me?.eligible && me.emailConfirmed) setSetup({ ...show, purposes: [], note: "" });
    } catch (error) {
      setDeck((current) => ({ ...current, shows: [show, ...without(current.shows)] }));
      flash(failure(error, "That didn't save. Check your connection and try again."));
    }
  };

  const saveSetup = async () => {
    if (!setup) return;
    try {
      await startCrewSeeking(setup.tourDateId, { purposes: setup.purposes, note: setup.note });
      const show = setup;
      setSetup(null);
      await loadMe();
      await openPeople(show);
    } catch (error) {
      flash(failure(error, "Couldn't start looking for a crew. Try again."));
    }
  };

  const leaveShow = async (show) => {
    try {
      await stopCrewSeeking(show.tourDateId);
      if (active?.tourDateId === show.tourDateId) setActive(null);
      await loadMe();
      flash(`You're no longer looking for a crew for ${show.artist}.`);
    } catch (error) {
      flash(failure(error, "Couldn't update that. Try again."));
    }
  };

  const onPersonSwipe = async (person, direction) => {
    if (!active) return;
    const without = (list) => list.filter((item) => item.id !== person.id);
    setPeople((current) => ({ ...current, list: without(current.list) }));
    try {
      const result = await swipeCrewPerson(active.tourDateId, person.id, direction === "right" ? "like" : "pass");
      if (result?.matched) {
        setMatch({ person: result.person || person, show: active });
        void loadMe();
      }
    } catch (error) {
      // Someone who stopped looking is simply gone; anything else can be retried.
      if (error?.status !== 404) setPeople((current) => ({ ...current, list: [person, ...without(current.list)] }));
      flash(failure(error, "That didn't go through. Try again."));
    }
  };

  const blockPerson = async (person) => {
    setSafety(null);
    const result = await blockUser?.(person.id);
    if (result?.ok === false) { flash("That block didn't save. Try again from their profile."); return; }
    setPeople((current) => ({ ...current, list: current.list.filter((item) => item.id !== person.id) }));
    flash(`Blocked ${person.name}. You won't see each other in Crew again.`);
  };

  const reportPerson = (person) => {
    setSafety(null);
    onReport?.({
      targetType: "user",
      targetId: person.id,
      ownerId: person.id,
      targetName: "profile",
      title: `${person.name} (@${person.handle})`,
      summary: "Report this account from Crew to the moderation team.",
    });
  };

  if (!session) {
    return (
      <View style={styles.screen}>
        <ScreenHeader kicker="Crew" title="Never go to a show alone" onBack={onClose} />
        <ScrollView contentContainerStyle={styles.pitch}>
          <Text style={styles.pitchTitle}>Find your people for the next show.</Text>
          {[
            ["check", "Swipe through shows near you and say which ones you're going to."],
            ["heart", "Say you're looking for a crew: someone to meet before doors, share a ride, split a hotel or take a spare ticket."],
            ["mail", "Swipe through fans going to the same show. When you both say yes, you're a crew and can message each other."],
          ].map(([icon, line]) => (
            <View key={line} style={styles.pitchRow}><Icon name={icon} size={18} color={colors.amber} /><Text style={styles.pitchText}>{line}</Text></View>
          ))}
          <Text style={styles.safety}>{SAFETY_TIPS} Crew is for adults 18 and over.</Text>
          <Button title="Sign in to find a crew" onPress={onRequireAuth} style={{ marginTop: space(4) }} />
        </ScrollView>
      </View>
    );
  }

  const eligible = !!me?.eligible;
  const ageUnknown = me && !me.failed && !eligible && me.ageBand === "unknown";

  return (
    <View style={styles.screen}>
      <ScreenHeader kicker="Crew" title="Never go to a show alone" onBack={onClose} />
      <View style={styles.tabs} accessibilityRole="tablist">
        {[["shows", "Shows"], ["crews", `Your crews${me?.matches?.length ? ` (${me.matches.length})` : ""}`]].map(([id, label]) => (
          <Pressable key={id} style={[styles.tab, tab === id && styles.tabOn]} onPress={() => { setTab(id); if (id === "shows") setActive(null); }}
            accessibilityRole="tab" accessibilityState={{ selected: tab === id }}>
            <Text style={[styles.tabText, tab === id && styles.tabTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {notice ? <Text style={styles.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {tab === "shows" ? (
          <>
            <View style={styles.cityRow}>
              <Icon name="pin" size={15} color={colors.amber} />
              {editingCity ? (
                <TextInput value={cityInput} onChangeText={setCityInput} placeholder="Type a city" placeholderTextColor={colors.textFaint}
                  style={styles.cityInput} autoFocus returnKeyType="search"
                  onSubmitEditing={() => { setEditingCity(false); void loadDeck(cityInput.trim() || null); }} accessibilityLabel="City to show" />
              ) : (
                <Text style={styles.cityText}>{deck.city ? `Shows in ${deck.city}` : "Upcoming shows"}</Text>
              )}
              <Pressable onPress={() => { if (editingCity) { setEditingCity(false); void loadDeck(cityInput.trim() || null); } else { setCityInput(deck.city || ""); setEditingCity(true); } }}
                accessibilityRole="button" hitSlop={8}>
                <Text style={styles.link}>{editingCity ? "Show" : "Change city"}</Text>
              </Pressable>
            </View>
            {deck.status === "loading" && !deck.shows.length ? <ActivityIndicator color={colors.amber} style={{ marginTop: 60 }} /> : (
              <SwipeDeck
                ref={showDeckRef}
                items={deck.shows}
                keyOf={(show) => show.tourDateId}
                reduceMotion={reduceMotion}
                labels={{ left: "Pass", right: "Going", up: "Interested" }}
                renderCard={(show, { pressAllowed }) => (
                  <Pressable style={StyleSheet.absoluteFill} onPress={() => { if (pressAllowed()) onOpenShow?.(show); }} accessibilityRole="button" accessibilityLabel={`${show.artist} at ${show.venue}, ${crewDateLabel(show.date)}. Open the show.`}>
                    <ShowCard show={show} />
                  </Pressable>
                )}
                onSwipe={onShowSwipe}
                emptyState={(
                  <View style={styles.empty}>
                    <Icon name="calendar" size={28} color={colors.amber} />
                    <Text style={styles.emptyTitle}>{deck.status === "error" ? "Shows didn't load." : "That's every show here for now."}</Text>
                    <Text style={styles.emptyText}>{deck.status === "error" ? "Check your connection and try again." : "Try another city, or check your crews."}</Text>
                    <Button small variant="secondary" title={deck.status === "error" ? "Try again" : "Change city"}
                      onPress={() => { if (deck.status === "error") void loadDeck(deck.city); else { setCityInput(""); setEditingCity(true); } }} />
                  </View>
                )}
              />
            )}
            {deck.shows.length ? (
              <DeckButtons
                onPass={() => showDeckRef.current?.swipe("left")}
                onUp={() => showDeckRef.current?.swipe("up")}
                onYes={() => showDeckRef.current?.swipe("right")}
                upLabel="Interested"
                yesLabel="I'm going"
              />
            ) : null}
            <Text style={styles.hint}>Swipe right if you're going, up if you're interested, left to skip.</Text>
          </>
        ) : null}

        {tab === "crews" ? (
          <>
            {me?.failed ? (
              <View style={styles.panel}>
                <Text style={styles.panelTitle}>Your crews didn't load.</Text>
                <Text style={styles.panelText}>Check your connection and try again.</Text>
                <Button small variant="secondary" title="Try again" onPress={() => { setMe(null); void loadMe(); }} style={{ marginTop: space(3) }} />
              </View>
            ) : null}
            {eligible && !me.emailConfirmed ? (
              <View style={styles.panel}>
                <Text style={styles.panelTitle}>Confirm your email to find a crew</Text>
                <Text style={styles.panelText}>Open the link we emailed you, then come back. You can already swipe shows and say which ones you're going to.</Text>
              </View>
            ) : null}
            {!eligible && me && !me.failed ? (
              <View style={styles.panel}>
                <Text style={styles.panelTitle}>{ageUnknown ? "Choose your age group to find a crew" : "Crew is for adults"}</Text>
                <Text style={styles.panelText}>{ageUnknown
                  ? "Crew connects people 18 and over who are going to the same show. Set your age group in Settings to start."
                  : "Crew connects people 18 and over. You can still say which shows you're going to and join each show's Lounge."}</Text>
                {ageUnknown && onOpenSettings ? <Button small title="Open Settings" onPress={onOpenSettings} style={{ marginTop: space(3) }} /> : null}
              </View>
            ) : null}

            {active ? (
              <>
                <Pressable onPress={() => setActive(null)} style={styles.backRow} accessibilityRole="button">
                  <Icon name="chevron-left" size={16} color={colors.amber} /><Text style={styles.link}>All your crews</Text>
                </Pressable>
                <Text style={styles.sectionTitle}>Looking for a crew: {active.artist}</Text>
                <Text style={styles.sectionMeta}>{[active.venue, crewDateLabel(active.date)].filter(Boolean).join(" · ")}</Text>
                {people.status === "loading" ? <ActivityIndicator color={colors.amber} style={{ marginTop: 60 }} /> : (
                  <SwipeDeck
                    ref={peopleDeckRef}
                    items={people.list}
                    reduceMotion={reduceMotion}
                    labels={{ left: "Pass", right: "Crew up", up: null }}
                    renderCard={(person) => <PersonCard person={person} onSafety={setSafety} />}
                    onSwipe={onPersonSwipe}
                    emptyState={(
                      <View style={styles.empty}>
                        <Icon name="you" size={28} color={colors.amber} />
                        <Text style={styles.emptyTitle}>{people.status === "error" ? "People didn't load." : "No one new yet."}</Text>
                        <Text style={styles.emptyText}>{people.status === "error" ? (people.message || "Try again in a moment.")
                          : "You'll get a notification when someone you said yes to says yes back. Share the show to bring your friends in."}</Text>
                      </View>
                    )}
                  />
                )}
                {people.list.length ? (
                  <DeckButtons onPass={() => peopleDeckRef.current?.swipe("left")} onYes={() => peopleDeckRef.current?.swipe("right")} yesLabel="Crew up" />
                ) : null}
                <Text style={styles.safety}>{SAFETY_TIPS}</Text>
              </>
            ) : (
              <>
                {me?.matches?.length ? (
                  <>
                    <Text style={styles.sectionTitle}>Your crews</Text>
                    {me.matches.map((crew) => (
                      <View key={`${crew.person.id}:${crew.show.tourDateId}`} style={styles.row}>
                        <Avatar user={crew.person} size={44} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowTitle} numberOfLines={1}>{crew.person.name}</Text>
                          <Text style={styles.rowMeta} numberOfLines={1}>{crew.show.artist} · {crewDateLabel(crew.show.date)}</Text>
                        </View>
                        <Button small title="Message" icon="mail" onPress={() => onOpenThread?.(crew.person.id)} />
                      </View>
                    ))}
                  </>
                ) : null}
                <Text style={styles.sectionTitle}>Shows you're finding a crew for</Text>
                {me?.shows?.length ? me.shows.map((show) => (
                  <View key={show.tourDateId || show.artist} style={styles.row}>
                    <View style={styles.dateBadge}><Text style={styles.dateBadgeText}>{crewDateLabel(show.date, { short: true })}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{show.artist}</Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>{show.others ? crewCountLabel(show.others, "others") : "No one else yet"} · {show.venue}</Text>
                    </View>
                    <Button small title="See people" onPress={() => openPeople(show)} />
                    <Pressable onPress={() => leaveShow(show)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Stop looking for a crew for ${show.artist}`}>
                      <Icon name="x" size={16} color={colors.textFaint} />
                    </Pressable>
                  </View>
                )) : (
                  <View style={styles.panel}>
                    <Text style={styles.panelText}>Swipe right on a show you're going to, then say you're looking for a crew. Everyone looking for a crew for that show shows up here.</Text>
                    <Button small variant="secondary" title="Browse shows" onPress={() => setTab("shows")} style={{ marginTop: space(3) }} />
                  </View>
                )}
                <Text style={styles.safety}>{SAFETY_TIPS}</Text>
              </>
            )}
          </>
        ) : null}
      </ScrollView>

      {setup ? (
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet} accessibilityViewIsModal>
            <Text style={styles.sheetTitle}>Looking for a crew{setup.artist ? ` for ${setup.artist}` : ""}?</Text>
            <Text style={styles.sheetText}>Only people also looking for a crew for this show will see you. Pick what you're after.</Text>
            <View style={styles.purposeRow}>
              {PURPOSE_OPTIONS.map((purpose) => {
                const on = setup.purposes.includes(purpose.id);
                return (
                  <Pressable key={purpose.id} onPress={() => setSetup((current) => ({ ...current,
                    purposes: on ? current.purposes.filter((id) => id !== purpose.id) : [...current.purposes, purpose.id].slice(0, CREW_PURPOSE_LIMIT) }))}
                    style={[styles.purpose, on && styles.purposeOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                    <Text style={[styles.purposeText, on && { color: "#1A1206" }]}>{purpose.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput value={setup.note} onChangeText={(note) => setSetup((current) => ({ ...current, note: note.slice(0, CREW_NOTE_MAX) }))}
              placeholder="Say hi (optional): first time seeing them, driving from Hamilton..." placeholderTextColor={colors.textFaint}
              style={styles.noteInput} multiline maxLength={CREW_NOTE_MAX} accessibilityLabel="A short note for your crew" />
            <Text style={styles.sheetFine}>{SAFETY_TIPS}</Text>
            <View style={styles.sheetButtons}>
              <Button variant="secondary" title="Not now" onPress={() => setSetup(null)} style={{ flex: 1 }} />
              <Button title="Find my crew" icon="heart" onPress={saveSetup} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      ) : null}

      {safety ? (
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet} accessibilityViewIsModal>
            <Text style={styles.sheetTitle}>{safety.name}</Text>
            <Text style={styles.sheetText}>Blocking hides you from each other everywhere on Pit, including Crew. Reporting sends their profile to the moderation team.</Text>
            <Button variant="danger" title={`Block ${safety.name}`} icon="shield" onPress={() => blockPerson(safety)} />
            {onReport ? <Button variant="secondary" title="Report" icon="flag" onPress={() => reportPerson(safety)} /> : null}
            <Button variant="secondary" title="Cancel" onPress={() => setSafety(null)} />
          </View>
        </View>
      ) : null}

      {match ? (
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheet, styles.matchSheet]} accessibilityViewIsModal accessibilityLiveRegion="assertive">
            <Text style={styles.matchKicker}>It's a crew</Text>
            <View style={styles.matchAvatars}>
              <Avatar user={session} size={84} />
              <Icon name="heart" size={26} color={colors.magenta} />
              <Avatar user={match.person} size={84} />
            </View>
            <Text style={styles.sheetTitle}>You and {match.person.name} are going to {match.show.artist} together.</Text>
            <Text style={styles.sheetText}>Say hi and make a plan. {SAFETY_TIPS}</Text>
            <View style={styles.sheetButtons}>
              <Button variant="secondary" title="Keep swiping" onPress={() => setMatch(null)} style={{ flex: 1 }} />
              <Button title="Say hi" icon="mail" onPress={() => { const id = match.person.id; setMatch(null); onOpenThread?.(id); }} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), paddingBottom: space(16), gap: space(3), width: "100%", maxWidth: 560, alignSelf: "center" },
  tabs: { flexDirection: "row", gap: space(2), paddingHorizontal: space(4), paddingTop: space(2), width: "100%", maxWidth: 560, alignSelf: "center" },
  tab: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  tabOn: { backgroundColor: colors.amberStrong, borderColor: colors.amber },
  tabText: { color: colors.textDim, fontWeight: "800", fontSize: 14 },
  tabTextOn: { color: "#1A1206" },
  notice: { color: colors.good, fontSize: 13, textAlign: "center", paddingTop: space(2), paddingHorizontal: space(4) },
  cityRow: { flexDirection: "row", alignItems: "center", gap: space(2), minHeight: 40 },
  cityText: { flex: 1, color: colors.text, fontSize: 15, fontWeight: "800" },
  cityInput: { flex: 1, color: colors.text, fontSize: 15, borderBottomWidth: 1, borderColor: colors.amber, paddingVertical: 4 },
  link: { color: colors.amber, fontWeight: "800", fontSize: 13 },
  cardFill: { flex: 1, justifyContent: "flex-end" },
  cardGradient: { backgroundColor: colors.surfaceAlt, alignItems: "center" },
  cardArt: { marginTop: "18%", opacity: 0.22 },
  cardShade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(4,6,10,0.45)" },
  cardBody: { padding: space(5), gap: space(2) },
  cardKicker: { color: colors.amber, fontWeight: "900", fontSize: 13, letterSpacing: 0.6 },
  cardTitle: { color: "#fff", fontFamily: displayFont, fontSize: 32, fontWeight: "900", lineHeight: 36 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardMeta: { color: "#E6E1D8", fontSize: 14, flex: 1 },
  cardChips: { flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(1) },
  countChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.14)" },
  countChipHot: { backgroundColor: colors.amberStrong },
  countText: { color: colors.text, fontSize: 12.5, fontWeight: "800" },
  credit: { color: "rgba(255,255,255,0.6)", fontSize: 10, marginTop: space(1) },
  personCard: { justifyContent: "flex-start", padding: space(5), gap: space(3), backgroundColor: colors.surface },
  personTop: { alignItems: "center", gap: space(1) },
  personName: { color: colors.text, fontFamily: displayFont, fontSize: 26, fontWeight: "900", marginTop: space(2) },
  personMeta: { color: colors.textDim, fontSize: 13 },
  statePill: { marginTop: space(1), paddingVertical: 4, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  statePillGoing: { backgroundColor: colors.good, borderColor: colors.good },
  stateText: { color: colors.text, fontSize: 12, fontWeight: "800" },
  purposeRow: { flexDirection: "row", flexWrap: "wrap", gap: space(2), justifyContent: "center" },
  purpose: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceAlt },
  purposeOn: { backgroundColor: colors.amberStrong, borderColor: colors.amber },
  purposeText: { color: colors.text, fontSize: 13, fontWeight: "700" },
  personNote: { color: colors.text, fontSize: 15, lineHeight: 21, textAlign: "center", fontStyle: "italic" },
  personFacts: { gap: 4, alignItems: "center" },
  fact: { color: colors.amber, fontSize: 13, fontWeight: "700", textAlign: "center" },
  safetyLink: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", marginTop: "auto", minHeight: 36 },
  safetyLinkText: { color: colors.textFaint, fontSize: 12 },
  deckButtons: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: space(5), marginTop: space(4) },
  roundButton: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  passButton: { borderColor: colors.danger, backgroundColor: colors.surface },
  upButton: { width: 52, height: 52, borderRadius: 26, borderColor: colors.gold, backgroundColor: colors.surface },
  yesButton: { borderColor: colors.amber, backgroundColor: colors.amberStrong },
  hint: { color: colors.textFaint, fontSize: 12, textAlign: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space(2), padding: space(6), borderRadius: radius.lg, borderWidth: 1, borderStyle: "dashed", borderColor: colors.line },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "900", textAlign: "center" },
  emptyText: { color: colors.textDim, fontSize: 14, textAlign: "center", lineHeight: 20 },
  panel: { padding: space(4), borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  panelTitle: { color: colors.text, fontSize: 16, fontWeight: "900", marginBottom: space(1) },
  panelText: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
  backRow: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 36 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: "900", marginTop: space(3) },
  sectionMeta: { color: colors.textDim, fontSize: 13, marginTop: -space(2) },
  row: { flexDirection: "row", alignItems: "center", gap: space(3), padding: space(3), borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
  rowMeta: { color: colors.textDim, fontSize: 12.5 },
  dateBadge: { minWidth: 52, paddingVertical: 6, paddingHorizontal: 8, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, alignItems: "center" },
  dateBadgeText: { color: colors.amber, fontSize: 12, fontWeight: "900" },
  safety: { color: colors.textFaint, fontSize: 12, lineHeight: 17, textAlign: "center", marginTop: space(3) },
  pitch: { padding: space(5), gap: space(4), maxWidth: 560, alignSelf: "center", width: "100%" },
  pitchTitle: { color: colors.text, fontFamily: displayFont, fontSize: 30, fontWeight: "900", lineHeight: 34 },
  pitchRow: { flexDirection: "row", gap: space(3), alignItems: "flex-start" },
  pitchText: { flex: 1, color: colors.textDim, fontSize: 15, lineHeight: 22 },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end", alignItems: "center" },
  sheet: { width: "100%", maxWidth: 560, backgroundColor: colors.bgElev, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space(5), gap: space(3), borderWidth: 1, borderColor: colors.line },
  matchSheet: { alignItems: "center" },
  sheetTitle: { color: colors.text, fontSize: 20, fontWeight: "900", textAlign: "center" },
  sheetText: { color: colors.textDim, fontSize: 14, lineHeight: 20, textAlign: "center" },
  sheetFine: { color: colors.textFaint, fontSize: 12, lineHeight: 17, textAlign: "center" },
  noteInput: { minHeight: 72, color: colors.text, fontSize: 15, padding: space(3), borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, textAlignVertical: "top" },
  sheetButtons: { flexDirection: "row", gap: space(3), width: "100%" },
  matchKicker: { color: colors.magenta, fontWeight: "900", fontSize: 14, letterSpacing: 1 },
  matchAvatars: { flexDirection: "row", alignItems: "center", gap: space(3), marginVertical: space(2) },
});
