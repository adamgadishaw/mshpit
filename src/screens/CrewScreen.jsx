import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import Button from "../components/Button";
import Icon from "../components/Icon";
import ScreenHeader from "../components/ScreenHeader";
import SmartImage from "../components/SmartImage";
import SwipeDeck from "../components/SwipeDeck";
import useReducedMotion from "../hooks/useReducedMotion";
import { fetchCrewShows, fetchMyPlans, markCrewShow, passCrewShow } from "../lib/crewApi";
import { useStore } from "../store";
import { colors, displayFont, radius, space } from "../theme";
import { crewDateLabel, goingLabel } from "../domain/crew.mjs";

// The Lounge is keyed by lower-case "artist|venue|date". A plan remembers that
// key, so reopening its Lounge uses the key's own parts whenever the display
// names would not rebuild it exactly.
function loungeLogForPlan(plan) {
  const key = plan?.show?.loungeKey || "";
  const [artist = "", venue = "", date = ""] = key.split("|");
  const display = { artist: plan?.show?.artist || "", venue: plan?.show?.venue || "", date: plan?.show?.date || date };
  const rebuilt = `${display.artist.trim().toLowerCase()}|${display.venue.trim().toLowerCase()}|${display.date}`;
  return rebuilt === key ? display : { artist, venue, date };
}

function ShowCard({ show }) {
  const image = show.eventImage?.uri || null;
  return (
    <View style={styles.cardFill}>
      {image ? (
        <SmartImage uri={image} style={StyleSheet.absoluteFill} contain={false} accessibilityLabel={`${show.artist} event image`} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.cardBlank]}>
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
        <View style={styles.countChip}><Icon name="you" size={12} color={colors.text} /><Text style={styles.countText}>{goingLabel(show.going)}</Text></View>
        {show.eventImage?.attribution ? <Text style={styles.credit} numberOfLines={1}>Image: {show.eventImage.attribution}</Text> : null}
      </View>
    </View>
  );
}

function DeckButtons({ onPass, onInterested, onGoing }) {
  return (
    <View style={styles.deckButtons}>
      <Pressable style={[styles.roundButton, styles.passButton]} onPress={onPass} accessibilityRole="button" accessibilityLabel="Skip">
        <Icon name="x" size={26} color={colors.danger} strokeWidth={3} />
      </Pressable>
      <Pressable style={[styles.roundButton, styles.upButton]} onPress={onInterested} accessibilityRole="button" accessibilityLabel="Interested">
        <Icon name="star" size={22} color={colors.gold} />
      </Pressable>
      <Pressable style={[styles.roundButton, styles.yesButton]} onPress={onGoing} accessibilityRole="button" accessibilityLabel="I'm going">
        <Icon name="check" size={26} color="#1A1206" strokeWidth={3} />
      </Pressable>
    </View>
  );
}

// Show swipe: flip through upcoming shows and build your concert calendar.
// It only saves your own Going and Interested, so it is for everyone. Adults
// also see "Your plans": the Lounge plans they host or joined.
export default function CrewScreen({ initialTab = "shows", onClose, onOpenShow, onOpenLounge, onRequireAuth }) {
  const { session } = useStore();
  const reduceMotion = useReducedMotion();
  const plansAllowed = session?.ageBand === "18_plus";
  const [tab, setTab] = useState(initialTab === "plans" && plansAllowed ? "plans" : "shows");
  const [deck, setDeck] = useState({ status: "idle", shows: [], city: null });
  const [plans, setPlans] = useState({ status: "idle", list: [] });
  const [cityInput, setCityInput] = useState("");
  const [editingCity, setEditingCity] = useState(false);
  const [saved, setSaved] = useState(null);
  const [notice, setNotice] = useState("");
  const deckRef = useRef(null);

  const loadDeck = useCallback(async (city = null) => {
    if (!session) return;
    setDeck((current) => ({ ...current, status: "loading" }));
    try {
      const result = await fetchCrewShows({ city });
      setDeck({ status: "ready", shows: result?.shows || [], city: result?.city || null });
      deckRef.current?.reset();
    } catch {
      setDeck({ status: "error", shows: [], city });
    }
  }, [session]);

  const loadPlans = useCallback(async () => {
    if (!session || !plansAllowed) return;
    setPlans((current) => ({ ...current, status: "loading" }));
    try {
      const result = await fetchMyPlans();
      setPlans({ status: "ready", list: result?.plans || [] });
    } catch {
      setPlans({ status: "error", list: [] });
    }
  }, [session, plansAllowed]);

  useEffect(() => { void loadDeck(); }, [loadDeck]);
  useEffect(() => { if (tab === "plans") void loadPlans(); }, [tab, loadPlans]);

  const flash = (message) => {
    setNotice(message);
    setTimeout(() => setNotice((current) => (current === message ? "" : current)), 3500);
  };

  // Answered cards leave the list at once; a failed save puts the card back on top.
  const onSwipe = async (show, direction) => {
    const without = (list) => list.filter((item) => item.tourDateId !== show.tourDateId);
    setDeck((current) => ({ ...current, shows: without(current.shows) }));
    try {
      if (direction === "left") { await passCrewShow(show.tourDateId); return; }
      const state = direction === "up" ? "interested" : "going";
      await markCrewShow(show.tourDateId, state);
      setSaved({ show, state });
    } catch (error) {
      setDeck((current) => ({ ...current, shows: [show, ...without(current.shows)] }));
      flash(error?.userMessage || "That didn't save. Check your connection and try again.");
    }
  };

  if (!session) {
    return (
      <View style={styles.screen}>
        <ScreenHeader kicker="Show swipe" title="Find your next show" onBack={onClose} />
        <ScrollView contentContainerStyle={styles.pitch}>
          <Text style={styles.pitchTitle}>Build your concert calendar, one swipe at a time.</Text>
          {[
            ["check", "Swipe right on shows you're going to, up on ones you're curious about, left to skip."],
            ["calendar", "Everything you save lands on your calendar and countdown."],
            ["comment", "Each show has a Lounge where people going can talk before the night."],
          ].map(([icon, line]) => (
            <View key={line} style={styles.pitchRow}><Icon name={icon} size={18} color={colors.amber} /><Text style={styles.pitchText}>{line}</Text></View>
          ))}
          <Button title="Sign in to start swiping" onPress={onRequireAuth} style={{ marginTop: space(4) }} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader kicker="Show swipe" title="Find your next show" onBack={onClose} />
      {plansAllowed ? (
        <View style={styles.tabs} accessibilityRole="tablist">
          {[["shows", "Shows"], ["plans", "Your plans"]].map(([id, label]) => (
            <Pressable key={id} style={[styles.tab, tab === id && styles.tabOn]} onPress={() => setTab(id)}
              accessibilityRole="tab" accessibilityState={{ selected: tab === id }}>
              <Text style={[styles.tabText, tab === id && styles.tabTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
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

            {saved ? (
              <View style={styles.savedCard} accessibilityLiveRegion="polite">
                <Icon name={saved.state === "going" ? "check" : "star"} size={18} color={saved.state === "going" ? colors.good : colors.gold} />
                <Text style={styles.savedText} numberOfLines={2}>
                  {saved.state === "going" ? `You're going to ${saved.show.artist}.` : `Saved ${saved.show.artist} as interested.`}
                </Text>
                {saved.state === "going" && onOpenLounge ? (
                  <Pressable onPress={() => onOpenLounge({ artist: saved.show.artist, venue: saved.show.venue, date: saved.show.date })}
                    accessibilityRole="button" hitSlop={6}>
                    <Text style={styles.link}>Open the Lounge</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {deck.status === "loading" && !deck.shows.length ? <ActivityIndicator color={colors.amber} style={{ marginTop: 60 }} /> : (
              <SwipeDeck
                ref={deckRef}
                items={deck.shows}
                keyOf={(show) => show.tourDateId}
                reduceMotion={reduceMotion}
                labels={{ left: "Skip", right: "Going", up: "Interested" }}
                renderCard={(show, { pressAllowed }) => (
                  <Pressable style={StyleSheet.absoluteFill} onPress={() => { if (pressAllowed()) onOpenShow?.(show); }} accessibilityRole="button"
                    accessibilityLabel={`${show.artist} at ${show.venue}, ${crewDateLabel(show.date)}. Open the show.`}>
                    <ShowCard show={show} />
                  </Pressable>
                )}
                onSwipe={onSwipe}
                emptyState={(
                  <View style={styles.empty}>
                    <Icon name="calendar" size={28} color={colors.amber} />
                    <Text style={styles.emptyTitle}>{deck.status === "error" ? "Shows didn't load." : "That's every show here for now."}</Text>
                    <Text style={styles.emptyText}>{deck.status === "error" ? "Check your connection and try again." : "Try another city, or come back when new dates are announced."}</Text>
                    <Button small variant="secondary" title={deck.status === "error" ? "Try again" : "Change city"}
                      onPress={() => { if (deck.status === "error") void loadDeck(deck.city); else { setCityInput(""); setEditingCity(true); } }} />
                  </View>
                )}
              />
            )}
            {deck.shows.length ? (
              <DeckButtons
                onPass={() => deckRef.current?.swipe("left")}
                onInterested={() => deckRef.current?.swipe("up")}
                onGoing={() => deckRef.current?.swipe("right")}
              />
            ) : null}
            <Text style={styles.hint}>Swipe right if you're going, up if you're interested, left to skip.</Text>
          </>
        ) : null}

        {tab === "plans" ? (
          <>
            <Text style={styles.sectionText}>Plans you started or joined in a show's Lounge. Open one to see who's in and chat.</Text>
            {plans.status === "loading" && !plans.list.length ? <ActivityIndicator color={colors.amber} style={{ marginTop: 40 }} /> : null}
            {plans.status === "error" ? (
              <View style={styles.panel}>
                <Text style={styles.panelText}>Your plans didn't load.</Text>
                <Button small variant="secondary" title="Try again" onPress={loadPlans} style={{ marginTop: space(3) }} />
              </View>
            ) : null}
            {plans.status === "ready" && !plans.list.length ? (
              <View style={styles.panel}>
                <Text style={styles.panelTitle}>No plans yet</Text>
                <Text style={styles.panelText}>Open the Lounge for a show you're going to. You can start a plan there, like a carpool or a meetup before doors, or join someone else's.</Text>
              </View>
            ) : null}
            {plans.list.map((plan) => (
              <Pressable key={plan.id} style={styles.planRow} onPress={() => onOpenLounge?.(loungeLogForPlan(plan))} accessibilityRole="button"
                accessibilityLabel={`${plan.kindLabel}: ${plan.text}. ${plan.show.artist}. Open the Lounge.`}>
                <View style={styles.dateBadge}><Text style={styles.dateBadgeText}>{crewDateLabel(plan.show.date, { short: true }) || "Soon"}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.planKind}>{plan.kindLabel}{plan.isHost ? " · You're hosting" : ""}</Text>
                  <Text style={styles.planText} numberOfLines={2}>{plan.text}</Text>
                  <Text style={styles.planMeta} numberOfLines={1}>{plan.show.artist}{plan.show.venue ? ` · ${plan.show.venue}` : ""}</Text>
                </View>
                <Icon name="chevron-right" size={18} color={colors.amber} />
              </Pressable>
            ))}
          </>
        ) : null}
      </ScrollView>
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
  notice: { color: colors.danger, fontSize: 13, textAlign: "center", paddingTop: space(2), paddingHorizontal: space(4) },
  cityRow: { flexDirection: "row", alignItems: "center", gap: space(2), minHeight: 40 },
  cityText: { flex: 1, color: colors.text, fontSize: 15, fontWeight: "800" },
  cityInput: { flex: 1, color: colors.text, fontSize: 15, borderBottomWidth: 1, borderColor: colors.amber, paddingVertical: 4 },
  link: { color: colors.amber, fontWeight: "800", fontSize: 13 },
  savedCard: { flexDirection: "row", alignItems: "center", gap: space(3), padding: space(3), borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  savedText: { flex: 1, color: colors.text, fontSize: 14 },
  cardFill: { flex: 1, justifyContent: "flex-end" },
  cardBlank: { backgroundColor: colors.surfaceAlt, alignItems: "center" },
  cardArt: { marginTop: "18%", opacity: 0.22 },
  cardShade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(4,6,10,0.45)" },
  cardBody: { padding: space(5), gap: space(2) },
  cardKicker: { color: colors.amber, fontWeight: "900", fontSize: 13, letterSpacing: 0.6 },
  cardTitle: { color: "#fff", fontFamily: displayFont, fontSize: 32, fontWeight: "900", lineHeight: 36 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardMeta: { color: "#E6E1D8", fontSize: 14, flex: 1 },
  countChip: { flexDirection: "row", alignSelf: "flex-start", alignItems: "center", gap: 6, marginTop: space(1), paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.14)" },
  countText: { color: colors.text, fontSize: 12.5, fontWeight: "800" },
  credit: { color: "rgba(255,255,255,0.6)", fontSize: 10, marginTop: space(1) },
  deckButtons: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: space(5), marginTop: space(4) },
  roundButton: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  passButton: { borderColor: colors.danger, backgroundColor: colors.surface },
  upButton: { width: 52, height: 52, borderRadius: 26, borderColor: colors.gold, backgroundColor: colors.surface },
  yesButton: { borderColor: colors.amber, backgroundColor: colors.amberStrong },
  hint: { color: colors.textFaint, fontSize: 12, textAlign: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space(2), padding: space(6), borderRadius: radius.lg, borderWidth: 1, borderStyle: "dashed", borderColor: colors.line },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "900", textAlign: "center" },
  emptyText: { color: colors.textDim, fontSize: 14, textAlign: "center", lineHeight: 20 },
  sectionText: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
  panel: { padding: space(4), borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  panelTitle: { color: colors.text, fontSize: 16, fontWeight: "900", marginBottom: space(1) },
  panelText: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
  planRow: { flexDirection: "row", alignItems: "center", gap: space(3), padding: space(3), borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft },
  planKind: { color: colors.amber, fontSize: 12, fontWeight: "900", letterSpacing: 0.4 },
  planText: { color: colors.text, fontSize: 15, fontWeight: "700", marginTop: 2 },
  planMeta: { color: colors.textDim, fontSize: 12.5, marginTop: 2 },
  dateBadge: { minWidth: 52, paddingVertical: 6, paddingHorizontal: 8, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, alignItems: "center" },
  dateBadgeText: { color: colors.amber, fontSize: 12, fontWeight: "900" },
  pitch: { padding: space(5), gap: space(4), maxWidth: 560, alignSelf: "center", width: "100%" },
  pitchTitle: { color: colors.text, fontFamily: displayFont, fontSize: 30, fontWeight: "900", lineHeight: 34 },
  pitchRow: { flexDirection: "row", gap: space(3), alignItems: "flex-start" },
  pitchText: { flex: 1, color: colors.textDim, fontSize: 15, lineHeight: 22 },
});
