import { useCallback, useContext, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { colors, displayFont, font, mono, radius, space } from "../../theme";
import Icon from "../../components/Icon";
import Button from "../../components/Button";
import Stars from "../../components/Stars";
import { PostNavigationContext } from "../../components/PostNavigationContext";
import SocialShareStudio from "../../components/SocialShareStudio";
import { buildFestivalShareModel } from "./festivalShare.mjs";
import { readFestival, removeFestivalPlan, saveFestivalPlan } from "./festivalApi.mjs";
import { festivalDateRange, festivalDayLabel, festivalLength, festivalPlace, lineupHasDays, lineupTiers } from "./festivalFormat.mjs";
import useFestivalResource from "./useFestivalResource";

const openLink = (url) => { if (url) void Linking.openURL(url).catch(() => {}); }; // architecture: allow-empty-catch -- an unopenable link leaves the page as it was

// One festival: its next edition (dates, lineup by day, who's going, your
// plan), what fans said about past years, when the next one is expected,
// past editions, and its history from Wikipedia.
export default function FestivalScreen({ slug, editionId = null, signedIn = false, accountId = null, author = null, onClose, onOpenArtist, onRequireAuth, onReviewFestival }) {
  const openPostById = useContext(PostNavigationContext);
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const load = useCallback((signal) => readFestival(slug, { signal }), [slug]);
  const resource = useFestivalResource(`festival:${slug}:${signedIn ? "member" : "guest"}`, load);
  const page = resource.data;
  const [selectedId, setSelectedId] = useState(editionId);
  const edition = page?.upcoming?.find((item) => item.id === selectedId) || page?.upcoming?.[0] || null;
  const [day, setDay] = useState(null);
  const [editing, setEditing] = useState(false);
  const [shareModel, setShareModel] = useState(null);

  if (!page) {
    return <View style={styles.screen}>
      <Header title="Festival" onClose={onClose} />
      <View style={styles.center}>
        {resource.error ? <>
          <Text style={styles.error} accessibilityRole="alert">{resource.error?.status === 404 ? "That festival is not on Mshpit yet." : "This festival could not load. Check your connection and try again."}</Text>
          {resource.error?.status === 404 ? null : <Button small variant="secondary" title="Try again" onPress={resource.reload} />}
        </> : <ActivityIndicator color={colors.amber} />}
      </View>
    </View>;
  }

  const festival = page.festival;
  const lineup = edition?.lineup || [];
  const days = edition?.days || [];
  const showDayTabs = days.length > 1 && lineupHasDays(lineup);
  const activeDay = showDayTabs && days.includes(day) ? day : null;
  const plan = edition?.plan || null;
  const mustSeeSet = new Set((plan?.mustSee || []).map((name) => name.toLowerCase()));
  const wanted = new Map((edition?.mustSee || []).map((act) => [act.name.toLowerCase(), act.fans]));
  const replacePlan = (nextPlan) => resource.replace((current) => ({
    ...current,
    upcoming: current.upcoming.map((item) => item.id !== edition.id ? item : {
      ...item,
      plan: nextPlan,
      going: Math.max(0, (Number(item.going) || 0) + (nextPlan && !item.plan ? 1 : !nextPlan && item.plan ? -1 : 0)),
    }),
  }));

  return <View style={styles.screen}>
    <Header title={festival.name} onClose={onClose} />
    <ScrollView contentContainerStyle={[styles.content, wide && styles.contentWide]} keyboardShouldPersistTaps="handled">
      {page.upcoming.length > 1 ? <View style={styles.editionChips} accessibilityRole="tablist">
        {page.upcoming.map((item) => <Pressable key={item.id} onPress={() => { setSelectedId(item.id); setDay(null); setEditing(false); }}
          style={[styles.chip, item.id === edition?.id && styles.chipOn]} accessibilityRole="tab" accessibilityState={{ selected: item.id === edition?.id }}>
          <Text style={[styles.chipText, item.id === edition?.id && styles.chipTextOn]}>{`${item.city || item.name} · ${festivalDateRange(item.startDate, item.endDate)}`}</Text>
        </Pressable>)}
      </View> : null}

      {edition ? <View style={styles.hero}>
        {edition.imageUrl ? <View style={styles.heroArt}>
          <ExpoImage source={{ uri: edition.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />
          <View style={styles.heroShade} />
        </View> : <View style={styles.heroBar} />}
        <View style={styles.heroBody}>
          <Text style={styles.kicker}>FESTIVAL</Text>
          <Text style={styles.heroTitle} accessibilityRole="header">{edition.name}</Text>
          <Text style={styles.heroWhen}>{festivalDateRange(edition.startDate, edition.endDate)}</Text>
          {festivalPlace(edition) ? <Text style={styles.heroWhere}>{festivalPlace(edition)}</Text> : null}
          <View style={styles.stats}>
            {festivalLength(edition) ? <Stat label="Length" value={festivalLength(edition)} /> : null}
            {edition.lineupCount ? <Stat label="Lineup" value={`${edition.lineupCount} acts`} /> : null}
            <Stat label="Going" value={edition.going ? Number(edition.going).toLocaleString("en-US") : "Be the first"} />
          </View>
          <View style={styles.actions}>
            <Button title={plan ? `Going · ${plan.days.map((item) => festivalDayLabel(item)).join(", ")}` : "I'm going"} small
              onPress={() => (signedIn ? setEditing((open) => !open) : onRequireAuth?.())} accessibilityLabel={plan ? "Edit your festival plan" : "Say you're going"} />
            {edition.ticketUrl ? <Button title="Tickets" variant="secondary" small onPress={() => openLink(edition.ticketUrl)} accessibilityLabel="Open tickets" /> : null}
            <Button title="Share lineup" variant="secondary" small onPress={() => setShareModel(buildFestivalShareModel({ festival, edition, intent: "lineup" }))} accessibilityLabel="Share this festival's lineup" />
            {plan ? <Button title="Share my plan" variant="secondary" small onPress={() => setShareModel(buildFestivalShareModel({ festival, edition, plan, intent: "going", author }))} accessibilityLabel="Share the days you're going" /> : null}
          </View>
          {edition.imageAttribution ? <Text style={styles.attribution}>{`Image: ${edition.imageAttribution}`}</Text> : null}
        </View>
      </View> : <View style={styles.hero}>
        <View style={styles.heroBody}>
          <Text style={styles.kicker}>FESTIVAL</Text>
          <Text style={styles.heroTitle} accessibilityRole="header">{festival.name}</Text>
          {page.expected ? <>
            <Text style={styles.heroWhen}>{page.expected.label}</Text>
            <Text style={styles.heroWhere}>{`Not announced yet. Estimated from the last edition: ${festivalDateRange(page.expected.basis.startDate, page.expected.basis.endDate)}${page.expected.basis.city ? `, ${page.expected.basis.city}` : ""}.`}</Text>
          </> : <Text style={styles.heroWhere}>No dates listed yet. New dates show up here as soon as tickets are listed.</Text>}
        </View>
      </View>}

      {edition && editing ? <PlanEditor key={edition.id} slug={festival.slug} edition={edition} plan={plan}
        onSaved={(next) => { replacePlan(next); setEditing(false); }} onCancel={() => setEditing(false)} /> : null}

      {edition ? <Section title={lineup.length ? "Lineup" : "Lineup not announced yet"}>
        {showDayTabs ? <View style={styles.editionChips} accessibilityRole="tablist">
          {[null, ...days].map((item) => <Pressable key={item || "all"} onPress={() => setDay(item)} style={[styles.chip, activeDay === item && styles.chipOn]}
            accessibilityRole="tab" accessibilityState={{ selected: activeDay === item }}>
            <Text style={[styles.chipText, activeDay === item && styles.chipTextOn]}>{item ? festivalDayLabel(item, { long: true }) : "All days"}</Text>
          </Pressable>)}
        </View> : null}
        {lineup.length ? lineupTiers(lineup, { day: activeDay }).map((tier) => <View key={tier.key} style={styles.tier}>
          {tier.acts.map((act, index) => <View key={act.name} style={styles.tierItem}>
            <Pressable onPress={() => onOpenArtist?.(act.name)} accessibilityRole="link"
              accessibilityLabel={`Open ${act.name}${mustSeeSet.has(act.name.toLowerCase()) ? ", on your must-see list" : ""}${wanted.get(act.name.toLowerCase()) ? `, ${wanted.get(act.name.toLowerCase())} members want to see them` : ""}`}>
              <Text style={[styles.tierName, styles[`tier_${tier.key}`], mustSeeSet.has(act.name.toLowerCase()) && styles.mustSeeName]}>{act.name}</Text>
            </Pressable>
            {index < tier.acts.length - 1 ? <Text style={[styles.tierDot, styles[`tier_${tier.key}`]]}> · </Text> : null}
          </View>)}
        </View>) : <Text style={styles.muted}>Acts appear here as soon as the lineup is listed with tickets.</Text>}
        {lineup.length && !showDayTabs && days.length > 1 ? <Text style={styles.muted}>Day-by-day times are not listed yet.</Text> : null}
      </Section> : null}

      {edition && edition.going ? <Section title="Who's going">
        <View style={styles.dayBars}>
          {days.map((item) => {
            const count = Number(edition.goingByDay?.[item]) || 0;
            const max = Math.max(1, ...days.map((other) => Number(edition.goingByDay?.[other]) || 0));
            return <View key={item} style={styles.dayBar} accessibilityLabel={`${festivalDayLabel(item, { long: true })}: ${count} going`}>
              <View style={styles.dayBarTrack}><View style={[styles.dayBarFill, { height: `${Math.round((count / max) * 100)}%` }]} /></View>
              <Text style={styles.dayBarCount}>{count}</Text>
              <Text style={styles.dayBarLabel}>{festivalDayLabel(item)}</Text>
            </View>;
          })}
        </View>
        {edition.mustSee?.length ? <Text style={styles.muted}>{`Most wanted: ${edition.mustSee.slice(0, 6).map((act) => `${act.name} (${act.fans})`).join(", ")}`}</Text> : null}
      </Section> : null}

      {page.reviews.some((review) => review.photos?.length) ? <Section title="From the crowd">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>
          {page.reviews.flatMap((review) => (review.photos || []).map((uri, index) => <Pressable key={`${review.postId}:${index}`}
            onPress={() => openPostById?.(review.postId)} accessibilityRole="button" accessibilityLabel={`Open ${review.user.name}'s photo from ${review.name}`}>
            <ExpoImage source={{ uri }} style={styles.photo} contentFit="cover" transition={120} accessibilityIgnoresInvertColors />
          </Pressable>))}
        </ScrollView>
      </Section> : null}

      <Section title={page.reviewStats.reviews ? `Fan reviews · ${page.reviewStats.reviews}` : "Fan reviews"}>
        {page.reviewStats.average ? <View style={styles.reviewScore}><Text style={styles.reviewScoreNumber}>{page.reviewStats.average.toFixed(1)}</Text><Stars value={page.reviewStats.average} size={14} /></View> : null}
        {page.reviews.length ? page.reviews.map((review) => <Pressable key={review.postId} onPress={() => openPostById?.(review.postId)} style={({ pressed }) => [styles.review, pressed && styles.pressed]}
          accessibilityRole="button" accessibilityLabel={`Open ${review.user.name}'s review of ${review.name}`}>
          <View style={styles.reviewHead}>
            <Text style={styles.reviewName} numberOfLines={1}>{review.name}</Text>
            <Text style={styles.reviewScoreSmall}>{Number(review.overall).toFixed(1)}</Text>
          </View>
          <Text style={styles.muted}>{[festivalDateRange(review.date, review.endDate), review.city].filter(Boolean).join(" · ")}</Text>
          {review.review ? <Text style={styles.reviewText} numberOfLines={4}>{review.review}</Text> : null}
          <Text style={styles.by}>{`${review.user.name} @${review.user.handle}`}</Text>
        </Pressable>) : <Text style={styles.muted}>No reviews yet. Been before? Yours can be the first.</Text>}
        {onReviewFestival ? <Button title="Review this festival" variant="secondary" small onPress={() => onReviewFestival({
          showFormat: "festival", artist: festival.name, artistKey: null,
          ...(edition && edition.startDate <= new Date().toISOString().slice(0, 10) ? { date: edition.startDate, endDate: edition.endDate, venue: edition.venue || "", city: [edition.city, edition.region].filter(Boolean).join(", ") } : {}),
        })} /> : null}
      </Section>

      {page.past.length ? <Section title="Past editions">
        {page.past.map((item) => <View key={item.id} style={styles.pastRow}>
          <Text style={styles.pastYear}>{item.startDate.slice(0, 4)}</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.pastWhen}>{festivalDateRange(item.startDate, item.endDate)}</Text>
            <Text style={styles.muted} numberOfLines={1}>{[festivalPlace(item), item.headliners?.slice(0, 3).join(", ")].filter(Boolean).join(" · ")}</Text>
          </View>
        </View>)}
      </Section> : null}

      {festival.about ? <Section title="About">
        <Text style={styles.about}>{festival.about}</Text>
        <View style={styles.facts}>
          {festival.foundedYear ? <Text style={styles.fact}>{`First held in ${festival.foundedYear}`}</Text> : null}
          {festival.website ? <Pressable onPress={() => openLink(festival.website)} accessibilityRole="link"><Text style={styles.link}>Official site</Text></Pressable> : null}
        </View>
        {festival.aboutSource?.url ? <Pressable onPress={() => openLink(festival.aboutSource.url)} accessibilityRole="link" accessibilityLabel="Open the Wikipedia article">
          <Text style={styles.source}>{`From Wikipedia, ${festival.aboutSource.license || "CC BY-SA 4.0"}`}</Text>
        </Pressable> : null}
      </Section> : null}
    </ScrollView>
    {shareModel ? <SocialShareStudio key={shareModel.id} accountId={accountId} model={shareModel} onClose={() => setShareModel(null)} /> : null}
  </View>;
}

function Header({ title, onClose }) {
  return <View style={styles.header}>
    <Pressable onPress={onClose} style={styles.back} accessibilityRole="button" accessibilityLabel="Back"><Icon name="chevron-left" size={20} color={colors.text} /></Pressable>
    <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
    <View style={styles.back} />
  </View>;
}

function Section({ title, children }) {
  return <View style={styles.section}>
    <Text style={styles.sectionTitle} accessibilityRole="header">{title.toUpperCase()}</Text>
    {children}
  </View>;
}

function Stat({ label, value }) {
  return <View style={styles.stat}><Text style={styles.statLabel}>{label.toUpperCase()}</Text><Text style={styles.statValue}>{value}</Text></View>;
}

// Going: pick the days and the sets you don't want to miss.
function PlanEditor({ slug, edition, plan, onSaved, onCancel }) {
  const [days, setDays] = useState(() => plan?.days || (edition.days.length === 1 ? edition.days : []));
  const [mustSee, setMustSee] = useState(() => plan?.mustSee || []);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    // Acts on the chosen days, plus any already picked.
    const pool = (edition.lineup || []).filter((act) => mustSee.includes(act.name) || !days.length || !act.days?.length || act.days.some((item) => days.includes(item)));
    return (term ? pool.filter((act) => act.name.toLowerCase().includes(term)) : pool).slice(0, 24);
  }, [query, edition.lineup, days, mustSee]);
  const toggle = (list, setList, value) => setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  const save = async () => {
    setBusy(true); setError("");
    try {
      const result = await saveFestivalPlan(slug, { editionId: edition.id, days, mustSee });
      onSaved(result?.plan || { days, mustSee });
    } catch (failure) {
      setError(failure?.status < 500 && failure?.message ? failure.message : "Your plan could not be saved. Try again.");
    } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError("");
    try { await removeFestivalPlan(slug, edition.id); onSaved(null); }
    catch { setError("Your plan could not be removed. Try again."); }
    finally { setBusy(false); }
  };
  return <View style={styles.plan}>
    <Text style={styles.sectionTitle}>WHICH DAYS ARE YOU GOING?</Text>
    <View style={styles.editionChips}>
      {edition.days.map((item) => <Pressable key={item} onPress={() => toggle(days, setDays, item)} style={[styles.chip, days.includes(item) && styles.chipOn]}
        accessibilityRole="checkbox" accessibilityState={{ checked: days.includes(item) }} accessibilityLabel={festivalDayLabel(item, { long: true })}>
        <Text style={[styles.chipText, days.includes(item) && styles.chipTextOn]}>{festivalDayLabel(item, { long: true })}</Text>
      </Pressable>)}
    </View>
    {edition.lineup?.length ? <>
      <Text style={styles.sectionTitle}>{`MUST-SEE SETS${mustSee.length ? ` · ${mustSee.length}` : ""}`}</Text>
      <TextInput style={styles.input} value={query} onChangeText={setQuery} placeholder="Find an act on the lineup" placeholderTextColor={colors.textFaint}
        accessibilityLabel="Find an act on the lineup" autoCorrect={false} />
      <View style={styles.editionChips}>
        {matches.map((act) => <Pressable key={act.name} onPress={() => toggle(mustSee, setMustSee, act.name)} style={[styles.chip, mustSee.includes(act.name) && styles.chipOn]}
          accessibilityRole="checkbox" accessibilityState={{ checked: mustSee.includes(act.name) }} accessibilityLabel={`${act.name} is a must-see`}>
          <Text style={[styles.chipText, mustSee.includes(act.name) && styles.chipTextOn]}>{act.name}</Text>
        </Pressable>)}
      </View>
    </> : null}
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    <View style={styles.actions}>
      <Button title={busy ? "Saving..." : "Save my plan"} small onPress={save} disabled={busy || !days.length} />
      {plan ? <Button title="Not going" variant="secondary" small onPress={remove} disabled={busy} /> : null}
      <Button title="Cancel" variant="secondary" small onPress={onCancel} disabled={busy} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", gap: space(2), paddingHorizontal: space(3), paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  back: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, color: colors.text, fontFamily: font, fontSize: 16, fontWeight: "900", textAlign: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space(3), padding: space(5) },
  content: { padding: space(4), gap: space(5), paddingBottom: space(10) },
  contentWide: { maxWidth: 980, width: "100%", alignSelf: "center" },
  editionChips: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  chip: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: colors.amber, borderColor: colors.amber },
  chipText: { color: colors.textDim, fontFamily: font, fontSize: 13, fontWeight: "800" },
  chipTextOn: { color: colors.bg },
  hero: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: "hidden" },
  heroArt: { height: 240, backgroundColor: colors.bgElev },
  heroBar: { height: 8, backgroundColor: colors.amber },
  heroShade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.15)" },
  heroBody: { padding: space(4), gap: 6 },
  kicker: { color: colors.amber, fontFamily: mono, fontSize: 11, fontWeight: "900", letterSpacing: 1.4 },
  heroTitle: { color: colors.text, fontFamily: displayFont, fontSize: 30, fontWeight: "900", lineHeight: 34 },
  heroWhen: { color: colors.amber, fontFamily: font, fontSize: 16, fontWeight: "900" },
  heroWhere: { color: colors.textDim, fontFamily: font, fontSize: 14, lineHeight: 20 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) },
  stat: { flexGrow: 1, flexBasis: 90, gap: 2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, paddingHorizontal: 12, paddingVertical: 8 },
  statLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  statValue: { color: colors.text, fontFamily: font, fontSize: 14, fontWeight: "900" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) },
  attribution: { color: colors.textFaint, fontFamily: font, fontSize: 11 },
  section: { gap: space(3) },
  sectionTitle: { color: colors.textDim, fontFamily: mono, fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  tier: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "center" },
  tierItem: { flexDirection: "row", alignItems: "baseline" },
  tierName: { color: colors.text, fontFamily: displayFont, fontWeight: "900", textAlign: "center" },
  tierDot: { color: colors.textFaint },
  tier_top: { fontSize: 26, lineHeight: 34 },
  tier_middle: { fontSize: 18, lineHeight: 26 },
  tier_rest: { fontSize: 14, lineHeight: 21, fontWeight: "700", color: colors.textDim },
  mustSeeName: { color: colors.amber },
  muted: { color: colors.textFaint, fontFamily: font, fontSize: 12.5, lineHeight: 18 },
  dayBars: { flexDirection: "row", gap: space(3), alignItems: "flex-end" },
  dayBar: { alignItems: "center", gap: 4, flex: 1, maxWidth: 80 },
  dayBarTrack: { width: 22, height: 80, borderRadius: 6, backgroundColor: colors.surfaceAlt, justifyContent: "flex-end", overflow: "hidden" },
  dayBarFill: { width: "100%", backgroundColor: colors.amber, borderRadius: 6 },
  dayBarCount: { color: colors.text, fontFamily: mono, fontSize: 12, fontWeight: "900" },
  dayBarLabel: { color: colors.textDim, fontFamily: font, fontSize: 11.5, fontWeight: "800" },
  reviewScore: { flexDirection: "row", alignItems: "center", gap: space(2) },
  reviewScoreNumber: { color: colors.text, fontFamily: displayFont, fontSize: 26, fontWeight: "900" },
  review: { gap: 4, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface, padding: space(3) },
  pressed: { opacity: 0.85 },
  reviewHead: { flexDirection: "row", alignItems: "center", gap: space(2) },
  reviewName: { flex: 1, color: colors.text, fontFamily: font, fontSize: 14, fontWeight: "900" },
  reviewScoreSmall: { color: colors.amber, fontFamily: mono, fontSize: 13, fontWeight: "900" },
  reviewText: { color: colors.textDim, fontFamily: font, fontSize: 13.5, lineHeight: 19 },
  by: { color: colors.textFaint, fontFamily: font, fontSize: 12, fontWeight: "700" },
  photoStrip: { gap: space(2) },
  photo: { width: 160, height: 200, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  pastRow: { flexDirection: "row", alignItems: "center", gap: space(3), paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  pastYear: { color: colors.amber, fontFamily: displayFont, fontSize: 20, fontWeight: "900", width: 56 },
  pastWhen: { color: colors.text, fontFamily: font, fontSize: 13.5, fontWeight: "800" },
  about: { color: colors.textDim, fontFamily: font, fontSize: 14, lineHeight: 21 },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: space(3) },
  fact: { color: colors.text, fontFamily: font, fontSize: 13, fontWeight: "800" },
  link: { color: colors.amber, fontFamily: font, fontSize: 13, fontWeight: "900" },
  source: { color: colors.textFaint, fontFamily: font, fontSize: 11.5, textDecorationLine: "underline" },
  plan: { gap: space(3), borderRadius: radius.lg, borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.surface, padding: space(4) },
  input: { color: colors.text, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  error: { color: colors.danger, fontFamily: font, fontSize: 13, textAlign: "center" },
});
