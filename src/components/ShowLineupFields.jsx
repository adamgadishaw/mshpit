import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, mono, radius } from "../theme";
import Icon from "./Icon";
import TapStars from "./TapStars";
import { MAX_TIMES_SEEN, openerSearchTerm, openerSuggestions, parseTimesSeen, timesSeenSentence } from "../domain/supportingActs.mjs";
import { addLineupActs, festivalDays, formatFestivalDay, LINEUP_LIMITS, moveLineupAct, removeLineupAct, updateLineupAct } from "../domain/lineup.mjs";

// The lineup on the concert review form: who opened (and how their set was),
// every headliner of a co-headline show, or each set seen at a festival with
// its day and stage. Each rating and note reaches that act's artist page.
// `timesSeen` is null while the number is automatic; `automaticTimesSeen` is
// the server's count for this show. `searchArtists(term, { signal })` is the
// composer's catalog search; `suggestions` come from the show's billing and
// from other fans' lineups (src/lib/lineupApi.js).
export default function ShowLineupFields({
  artist, showFormat = "headline", date = "", endDate = "", acts, onActsChange, mainRating = 0, onMainRatingChange,
  suggestions = [], timesSeen, automaticTimesSeen, onTimesSeenChange, searchArtists,
}) {
  const festival = showFormat === "festival";
  const coHeadline = showFormat === "co_headline";
  const days = festival ? festivalDays(date, endDate) : [];
  const [addDay, setAddDay] = useState(null);
  const dayForNew = days.includes(addDay) ? addDay : days.length === 1 ? days[0] : null;
  const shown = timesSeen ?? automaticTimesSeen ?? null;
  const [editingCount, setEditingCount] = useState(false);
  const [countText, setCountText] = useState("");
  const mainArtist = artist.trim();
  const byRole = (role) => acts.filter((act) => act.role === role);
  const add = (names, role, day = dayForNew) => onActsChange(addLineupActs(acts, names, { showFormat, mainArtist, role, day }));
  const rowProps = (act) => ({
    act, festival, coHeadline, days,
    onChange: (patch) => onActsChange(updateLineupAct(acts, act.name, patch)),
    onRemove: () => onActsChange(removeLineupAct(acts, act.name)),
    onMoveUp: () => onActsChange(moveLineupAct(acts, act.name, "up")),
    canMoveUp: acts.slice(0, acts.indexOf(act)).some((other) => other.role === act.role),
  });
  const offered = suggestions.filter((item) => item?.name && item.name.toLowerCase() !== mainArtist.toLowerCase()
    && !acts.some((act) => act.name.toLowerCase() === item.name.toLowerCase())).slice(0, 10);
  const full = acts.length >= LINEUP_LIMITS.acts;
  const coHeadliners = byRole("co_headliner");
  const openers = byRole("opener");
  const sets = byRole("festival_set");

  return <View style={styles.wrap}>
    {festival ? <>
      <Text style={styles.label}>SETS YOU SAW <Text style={styles.optional}>optional</Text></Text>
      <Text style={styles.hint}>Add every set you caught. Pick the day, rate it and say how it went. Each one shows on that artist's page and counts as a time you saw them.</Text>
      {days.length > 1 ? <View style={styles.dayPicker}>
        <Text style={styles.small}>Adding to</Text>
        {days.map((day) => <Pressable key={day} style={[styles.dayChip, dayForNew === day && styles.dayChipOn]} onPress={() => setAddDay(dayForNew === day ? null : day)}
          accessibilityRole="button" accessibilityState={{ selected: dayForNew === day }} accessibilityLabel={`Add sets to ${formatFestivalDay(day)}`}>
          <Text style={[styles.dayChipText, dayForNew === day && styles.dayChipTextOn]}>{formatFestivalDay(day)}</Text>
        </Pressable>)}
      </View> : null}
      {sets.map((act) => <ActRow key={act.name} {...rowProps(act)} />)}
    </> : <>
      {coHeadline ? <>
        <Text style={styles.label}>HEADLINERS</Text>
        <Text style={styles.hint}>Rate each headliner's set. Every rating shows on that artist's page.</Text>
        {mainArtist ? <View style={styles.row2}>
          <View style={styles.rowHead}>
            <Icon name="star" size={13} color={colors.amber} />
            <Text style={styles.actName} numberOfLines={1}>{mainArtist}</Text>
          </View>
          <View style={styles.starsRow}>
            <TapStars value={mainRating} onChange={onMainRatingChange} size={22} gap={4} color={colors.amber} accessibilityLabel={`Rate ${mainArtist}'s set`} />
            <Text style={styles.ratingText}>{mainRating ? mainRating.toFixed(1) : "Not rated"}</Text>
          </View>
        </View> : null}
        {coHeadliners.map((act) => <ActRow key={act.name} {...rowProps(act)} numberOffset={1} />)}
        {coHeadliners.length < LINEUP_LIMITS.coHeadliners && !full ? <AddAct acts={acts} role="co_headliner" mainArtist={mainArtist} searchArtists={searchArtists}
          onAdd={(names) => add(names, "co_headliner")} label="Add a headliner" placeholder="e.g. Usher" /> : null}
      </> : null}
      <Text style={[styles.label, coHeadline && { marginTop: 14 }]}>WHO OPENED? <Text style={styles.optional}>optional</Text></Text>
      <Text style={styles.hint}>A great opener can make the night. Add them in the order they played, rate their set and say what stood out. It shows on their artist page and counts as a time you saw them.</Text>
      {openers.map((act) => <ActRow key={act.name} {...rowProps(act)} />)}
    </>}

    {offered.length && !full ? <View style={styles.suggestBlock}>
      <Text style={styles.small}>{festival ? "On the lineup" : "Played this run"}</Text>
      <View style={styles.chips}>
        {offered.map((item) => <Pressable key={`${item.name}:${item.day || ""}`} style={styles.suggestChip}
          onPress={() => add([item.name], festival ? "festival_set" : "opener", festival ? item.day || dayForNew : null)}
          accessibilityRole="button" accessibilityLabel={festival ? `Add ${item.name}'s set` : `Add ${item.name} as an opener`}>
          <Icon name="plus" size={11} color={colors.amber} />
          <Text style={styles.suggestText} numberOfLines={1}>{item.name}</Text>
          {festival && item.day ? <Text style={styles.suggestMeta}>{formatFestivalDay(item.day).split(",")[0]}</Text>
            : item.source === "fans" && item.fans ? <Text style={styles.suggestMeta}>{item.fans === 1 ? "1 fan" : `${item.fans} fans`}</Text> : null}
        </Pressable>)}
      </View>
    </View> : null}

    {!full && (festival || openers.length < LINEUP_LIMITS.openers) ? <AddAct acts={acts} role={festival ? "festival_set" : "opener"} mainArtist={mainArtist}
      searchArtists={searchArtists} onAdd={(names) => add(names, festival ? "festival_set" : "opener")}
      label={festival ? "Add a set" : "Add an opener"} placeholder={festival ? "e.g. Travis Scott, Chappell Roan" : "e.g. Muna, Phoebe Bridgers"} /> : null}
    {full ? <Text style={styles.hint}>That's the most acts one review can list.</Text> : null}

    {mainArtist ? <View style={styles.seen}>
      <Text style={styles.label}>{festival ? "TIMES AT THIS FESTIVAL" : "TIMES SEEN"}</Text>
      {!editingCount ? <View style={styles.row}>
        <Text style={styles.seenText}>{shown ? timesSeenSentence(shown, mainArtist, { festival }) : "Counting your earlier shows…"}</Text>
        <Pressable onPress={() => { setCountText(shown ? String(shown) : ""); setEditingCount(true); }} hitSlop={8} accessibilityRole="button"
          accessibilityLabel={festival ? "Change how many times you've been" : "Change how many times you've seen them"}>
          <Text style={styles.change}>Change</Text>
        </Pressable>
      </View> : <View style={styles.row}>
        <TextInput style={[styles.input, styles.countInput]} value={countText} onChangeText={setCountText} keyboardType="number-pad" maxLength={3}
          accessibilityLabel={festival ? `How many times have you been to ${mainArtist}, counting this one?` : `How many times have you seen ${mainArtist}, counting this show?`} />
        <Pressable style={[styles.add, !parseTimesSeen(countText) && styles.addOff]} disabled={!parseTimesSeen(countText)} accessibilityRole="button"
          accessibilityLabel="Save times seen" onPress={() => { onTimesSeenChange(parseTimesSeen(countText)); setEditingCount(false); }}>
          <Text style={styles.addText}>Save</Text>
        </Pressable>
        {timesSeen !== null ? <Pressable onPress={() => { onTimesSeenChange(null); setEditingCount(false); }} hitSlop={8} accessibilityRole="button"
          accessibilityLabel="Count automatically from your reviews"><Text style={styles.change}>Automatic</Text></Pressable> : null}
      </View>}
      <Text style={styles.hint}>{festival
        ? `Counted from your reviews of this festival by date. If you went before you used Mshpit, change it (up to ${MAX_TIMES_SEEN}).`
        : `Counted from your reviews by show date, including times they opened. If you saw them before you used Mshpit, change it (up to ${MAX_TIMES_SEEN}) and later reviews count on from there.`}</Text>
    </View> : null}
  </View>;
}

function ActRow({ act, festival, coHeadline, days, onChange, onRemove, onMoveUp, canMoveUp }) {
  const [noteOpen, setNoteOpen] = useState(!!act.review);
  return <View style={styles.row2}>
    <View style={styles.rowHead}>
      <Icon name={act.role === "co_headliner" ? "star" : "music"} size={13} color={colors.amber} />
      <Text style={styles.actName} numberOfLines={1}>{act.name}</Text>
      {canMoveUp ? <Pressable onPress={onMoveUp} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Move ${act.name} earlier`}>
        <View style={styles.flip}><Icon name="chevron-down" size={15} color={colors.textDim} /></View>
      </Pressable> : null}
      <Pressable onPress={onRemove} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${act.name}`}>
        <Icon name="x" size={14} color={colors.textDim} />
      </Pressable>
    </View>
    {coHeadline ? <View style={styles.roleRow}>
      {[["co_headliner", "Headliner"], ["opener", "Opener"]].map(([role, label]) => <Pressable key={role} style={[styles.dayChip, act.role === role && styles.dayChipOn]}
        onPress={() => onChange({ role })} accessibilityRole="button" accessibilityState={{ selected: act.role === role }} accessibilityLabel={`${act.name} was ${label === "Headliner" ? "a headliner" : "an opener"}`}>
        <Text style={[styles.dayChipText, act.role === role && styles.dayChipTextOn]}>{label}</Text>
      </Pressable>)}
    </View> : null}
    <View style={styles.starsRow}>
      <TapStars value={act.rating || 0} onChange={(rating) => onChange({ rating })} size={22} gap={4} color={colors.amber} accessibilityLabel={`Rate ${act.name}'s set`} />
      <Text style={styles.ratingText}>{act.rating ? act.rating.toFixed(1) : "Not rated"}</Text>
      {act.rating ? <Pressable onPress={() => onChange({ rating: null })} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Leave ${act.name} unrated`}>
        <Text style={styles.change}>Clear</Text>
      </Pressable> : null}
    </View>
    {festival && days.length > 1 ? <View style={styles.roleRow}>
      {days.map((day) => <Pressable key={day} style={[styles.dayChip, act.day === day && styles.dayChipOn]} onPress={() => onChange({ day: act.day === day ? null : day })}
        accessibilityRole="button" accessibilityState={{ selected: act.day === day }} accessibilityLabel={`${act.name} played ${formatFestivalDay(day)}`}>
        <Text style={[styles.dayChipText, act.day === day && styles.dayChipTextOn]}>{formatFestivalDay(day).split(",")[0]}</Text>
      </Pressable>)}
    </View> : null}
    {festival ? <TextInput style={[styles.input, styles.stageInput]} value={act.stage || ""} onChangeText={(stage) => onChange({ stage })} maxLength={LINEUP_LIMITS.stage}
      placeholder="Stage, optional" placeholderTextColor={colors.textFaint} accessibilityLabel={`Stage ${act.name} played`} /> : null}
    {noteOpen ? <TextInput style={[styles.input, styles.note]} value={act.review} onChangeText={(review) => onChange({ review })} multiline maxLength={LINEUP_LIMITS.review}
      placeholder={`How was ${act.name}'s set?`} placeholderTextColor={colors.textFaint} accessibilityLabel={`Your note on ${act.name}'s set`} />
      : <Pressable onPress={() => setNoteOpen(true)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Add a note about ${act.name}'s set`}>
        <Text style={styles.change}>Add a note about their set</Text>
      </Pressable>}
  </View>;
}

// Typed names (comma separated) or a catalog suggestion for the name being typed.
function AddAct({ acts, mainArtist, searchArtists, onAdd, label, placeholder }) {
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
  const hits = term.length >= 2 ? openerSuggestions(results, { acts: acts.map((act) => act.name), mainArtist }) : [];
  const submit = (picked) => {
    const parts = String(typed).split(/[,\n]/u);
    const names = picked ? [...parts.slice(0, -1), picked] : parts;
    onAdd(names);
    setTyped("");
  };
  return <>
    <View style={styles.row}>
      <TextInput style={styles.input} value={typed} onChangeText={setTyped} onSubmitEditing={() => submit(null)} returnKeyType="done"
        placeholder={placeholder} placeholderTextColor={colors.textFaint} maxLength={400} autoCorrect={false} accessibilityLabel={label} />
      <Pressable style={[styles.add, !typed.trim() && styles.addOff]} onPress={() => submit(null)} disabled={!typed.trim()} accessibilityRole="button"
        accessibilityLabel={label === "Add an opener" ? "Add the opener" : label === "Add a headliner" ? "Add the headliner" : "Add the set"} accessibilityState={{ disabled: !typed.trim() }}>
        <Text style={styles.addText}>Add</Text>
      </Pressable>
    </View>
    {hits.length ? <View style={styles.hits}>
      {hits.map((hit) => <Pressable key={hit.key} style={styles.hit} onPress={() => submit(hit.name)} accessibilityRole="button"
        accessibilityLabel={label === "Add an opener" ? `Add ${hit.name} as an opener` : label === "Add a headliner" ? `Add ${hit.name} as a headliner` : `Add ${hit.name}'s set`}>
        <Icon name="music" size={13} color={colors.amber} />
        <Text style={styles.hitName} numberOfLines={1}>{hit.name}</Text>
        {hit.detail ? <Text style={styles.hitDetail} numberOfLines={1}>{hit.detail}</Text> : null}
      </Pressable>)}
    </View> : null}
    {searching && !hits.length ? <Text style={styles.hint} accessibilityLiveRegion="polite">Searching artists...</Text> : null}
  </>;
}

const styles = StyleSheet.create({
  wrap: { marginTop: 18, gap: 8 },
  label: { color: colors.textDim, fontSize: 11, letterSpacing: 1.2, fontWeight: "800" },
  optional: { color: colors.textFaint, fontWeight: "600", letterSpacing: 0.4 },
  hint: { color: colors.textFaint, fontSize: 12, lineHeight: 17 },
  small: { color: colors.textDim, fontSize: 11.5, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  row2: { gap: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: 12 },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  actName: { color: colors.text, fontSize: 15, fontWeight: "800", flex: 1 },
  starsRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  ratingText: { color: colors.textDim, fontFamily: mono, fontSize: 12 },
  roleRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  dayPicker: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  dayChip: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 10, paddingVertical: 5 },
  dayChipOn: { backgroundColor: colors.amber, borderColor: colors.amber },
  dayChipText: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  dayChipTextOn: { color: colors.bg },
  input: { flexGrow: 1, flexBasis: 180, minWidth: 0, color: colors.text, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  // Inside a column the shared input's flexBasis would become a height.
  stageInput: { flexGrow: 0, flexBasis: "auto", paddingVertical: 8, fontSize: 13 },
  note: { flexGrow: 0, flexBasis: "auto", minHeight: 64, textAlignVertical: "top" },
  countInput: { flexGrow: 0, flexBasis: 72, width: 72 },
  add: { borderRadius: radius.pill, backgroundColor: colors.amber, paddingHorizontal: 14, paddingVertical: 9 },
  addOff: { opacity: 0.45 },
  addText: { color: colors.bg, fontSize: 13, fontWeight: "800" },
  suggestBlock: { gap: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  suggestChip: { flexDirection: "row", alignItems: "center", gap: 5, maxWidth: "100%", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 10, paddingVertical: 6 },
  suggestText: { color: colors.text, fontSize: 13, fontWeight: "700", flexShrink: 1 },
  suggestMeta: { color: colors.textFaint, fontSize: 11, fontFamily: mono },
  hits: { backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, overflow: "hidden" },
  hit: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  hitName: { color: colors.text, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  hitDetail: { color: colors.textDim, fontSize: 11, fontFamily: mono, marginLeft: "auto", flexShrink: 1 },
  seen: { marginTop: 10, gap: 6 },
  seenText: { color: colors.gold, fontSize: 14, fontWeight: "800", flexShrink: 1 },
  change: { color: colors.amber, fontSize: 13, fontWeight: "800" },
  flip: { transform: [{ rotate: "180deg" }] },
});
