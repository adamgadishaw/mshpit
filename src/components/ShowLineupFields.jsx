import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, mono, radius } from "../theme";
import Icon from "./Icon";
import { addSupportingActs, MAX_SUPPORTING_ACTS, MAX_TIMES_SEEN, openerSearchTerm, openerSuggestions, parseTimesSeen, pickSupportingAct, timesSeenSentence } from "../domain/supportingActs.mjs";

// Openers (or festival acts seen) and "times seen" on the concert review form.
// `timesSeen` is null while the number is automatic; `automaticTimesSeen` is
// the server's count for this show. `searchArtists(term, { signal })` is the
// composer's catalog search; its results are offered under the opener input.
export default function ShowLineupFields({ artist, acts, onActsChange, timesSeen, automaticTimesSeen, onTimesSeenChange, festival = false, searchArtists }) {
  const [typed, setTyped] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const term = openerSearchTerm(typed);
  useEffect(() => {
    setResults([]);
    if (typeof searchArtists !== "function" || term.length < 2) { setSearching(false); return undefined; }
    const controller = new AbortController();
    let current = true;
    setSearching(true);
    const timer = setTimeout(() => {
      Promise.resolve(searchArtists(term, { signal: controller.signal }))
        .then((list) => { if (current) setResults(Array.isArray(list) ? list : []); })
        // Suggestions are a shortcut; typing the name and pressing Add still works.
        .catch(() => { if (current) setResults([]); })
        .finally(() => { if (current) setSearching(false); });
    }, 280);
    return () => { current = false; clearTimeout(timer); controller.abort(); };
  }, [term, searchArtists]);
  const suggestions = term.length >= 2 ? openerSuggestions(results, { acts, mainArtist: artist }) : [];
  const add = () => {
    const next = addSupportingActs(acts, typed, { mainArtist: artist });
    onActsChange(next);
    setTyped("");
  };
  const pick = (name) => {
    onActsChange(pickSupportingAct(acts, typed, name, { mainArtist: artist }));
    setTyped("");
  };
  const shown = timesSeen ?? automaticTimesSeen ?? null;
  const [editingCount, setEditingCount] = useState(false);
  const [countText, setCountText] = useState("");
  const full = acts.length >= MAX_SUPPORTING_ACTS;
  return <View style={styles.wrap}>
    <Text style={styles.label}>{festival ? "WHO ELSE DID YOU SEE?" : "WHO OPENED?"} <Text style={styles.optional}>optional</Text></Text>
    <Text style={styles.hint}>{festival
      ? "List the acts you caught. Each one counts as an artist you've seen live, and your own reviews of them from this day link here."
      : "Add the openers. Each one counts as an artist you've seen live, and your own review of an opener from the same night links here."}</Text>
    {acts.length ? <View style={styles.chips}>
      {acts.map((name) => <View key={name} style={styles.chip}>
        <Text style={styles.chipText} numberOfLines={1}>{name}</Text>
        <Pressable onPress={() => onActsChange(acts.filter((item) => item !== name))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${name}`}>
          <Icon name="x" size={12} color={colors.textDim} />
        </Pressable>
      </View>)}
    </View> : null}
    {!full ? <View style={styles.row}>
      <TextInput style={styles.input} value={typed} onChangeText={setTyped} onSubmitEditing={add} returnKeyType="done"
        placeholder={festival ? "e.g. Charli xcx, Chappell Roan" : "e.g. Muna, Phoebe Bridgers"} placeholderTextColor={colors.textFaint}
        maxLength={400} autoCorrect={false} accessibilityLabel={festival ? "Add an act you saw" : "Add an opener"} />
      <Pressable style={[styles.add, !typed.trim() && styles.addOff]} onPress={add} disabled={!typed.trim()} accessibilityRole="button"
        accessibilityLabel={festival ? "Add the act" : "Add the opener"} accessibilityState={{ disabled: !typed.trim() }}>
        <Text style={styles.addText}>Add</Text>
      </Pressable>
    </View> : <Text style={styles.hint}>That's the most acts one review can list.</Text>}
    {!full && suggestions.length ? <View style={styles.hits}>
      {suggestions.map((hit) => <Pressable key={hit.key} style={styles.hit} onPress={() => pick(hit.name)} accessibilityRole="button"
        accessibilityLabel={festival ? `Add ${hit.name} to the acts you saw` : `Add ${hit.name} as an opener`}>
        <Icon name="music" size={13} color={colors.amber} />
        <Text style={styles.hitName} numberOfLines={1}>{hit.name}</Text>
        {hit.detail ? <Text style={styles.hitDetail} numberOfLines={1}>{hit.detail}</Text> : null}
      </Pressable>)}
    </View> : null}
    {!full && searching && !suggestions.length ? <Text style={styles.hint} accessibilityLiveRegion="polite">Searching artists...</Text> : null}

    {artist.trim() ? <View style={styles.seen}>
      <Text style={styles.label}>TIMES SEEN</Text>
      {!editingCount ? <View style={styles.row}>
        <Text style={styles.seenText}>{shown ? timesSeenSentence(shown, artist) : "Counting your earlier shows…"}</Text>
        <Pressable onPress={() => { setCountText(shown ? String(shown) : ""); setEditingCount(true); }} hitSlop={8} accessibilityRole="button"
          accessibilityLabel="Change how many times you've seen them">
          <Text style={styles.change}>Change</Text>
        </Pressable>
      </View> : <View style={styles.row}>
        <TextInput style={[styles.input, styles.countInput]} value={countText} onChangeText={setCountText} keyboardType="number-pad" maxLength={3}
          accessibilityLabel={`How many times have you seen ${artist}, counting this show?`} />
        <Pressable style={[styles.add, !parseTimesSeen(countText) && styles.addOff]} disabled={!parseTimesSeen(countText)} accessibilityRole="button"
          accessibilityLabel="Save times seen" onPress={() => { onTimesSeenChange(parseTimesSeen(countText)); setEditingCount(false); }}>
          <Text style={styles.addText}>Save</Text>
        </Pressable>
        {timesSeen !== null ? <Pressable onPress={() => { onTimesSeenChange(null); setEditingCount(false); }} hitSlop={8} accessibilityRole="button"
          accessibilityLabel="Count automatically from your reviews"><Text style={styles.change}>Automatic</Text></Pressable> : null}
      </View>}
      <Text style={styles.hint}>{`Counted from your reviews by show date, including times they opened. If you saw them before you used Mshpit, change it (up to ${MAX_TIMES_SEEN}) and later reviews count on from there.`}</Text>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { marginTop: 18, gap: 8 },
  label: { color: colors.textDim, fontSize: 11, letterSpacing: 1.2, fontWeight: "800" },
  optional: { color: colors.textFaint, fontWeight: "600", letterSpacing: 0.4 },
  hint: { color: colors.textFaint, fontSize: 12, lineHeight: 17 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: 11, paddingVertical: 6 },
  chipText: { color: colors.text, fontSize: 13, fontWeight: "700", flexShrink: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  input: { flexGrow: 1, flexBasis: 180, minWidth: 0, color: colors.text, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  countInput: { flexGrow: 0, flexBasis: 72, width: 72 },
  add: { borderRadius: radius.pill, backgroundColor: colors.amber, paddingHorizontal: 14, paddingVertical: 9 },
  addOff: { opacity: 0.45 },
  addText: { color: colors.bg, fontSize: 13, fontWeight: "800" },
  hits: { backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, overflow: "hidden" },
  hit: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  hitName: { color: colors.text, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  hitDetail: { color: colors.textDim, fontSize: 11, fontFamily: mono, marginLeft: "auto", flexShrink: 1 },
  seen: { marginTop: 10, gap: 6 },
  seenText: { color: colors.gold, fontSize: 14, fontWeight: "800", flexShrink: 1 },
  change: { color: colors.amber, fontSize: 13, fontWeight: "800" },
});
