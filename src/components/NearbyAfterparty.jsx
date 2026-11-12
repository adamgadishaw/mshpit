import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, displayFont, focusRing, font, isKeyboardFocus, radius, space } from "../theme";
import { AFTER_SHOW_INTENTS, AFTER_SHOW_TRAVEL_MODES, afterpartySearches, afterShowContext, afterShowDirections } from "../lib/afterparty";
import { catalogEntry } from "../lib/errorCatalog.mjs";
import Icon from "./Icon";
import { PublicPressableLink } from "./PublicWebLinks";

// Preserve the caller contract; a concert-page section can provide its own
// heading with showTitle={false}, without a second nested card.
export default function NearbyAfterparty({ log, coord, lifecycle, showTitle = true }) {
  const context = afterShowContext(log, coord, lifecycle);
  return <AfterShowChoices key={context.scope} context={context} showTitle={showTitle} />;
}

function Choice({ label, icon, selected, expanded, disabled, onPress, href, role = "button", hint, children, style }) {
  const [focused, setFocused] = useState(false);
  const Control = href ? PublicPressableLink : Pressable;
  return (
    <Control
      {...(href ? { href, onNavigate: onPress, hrefAttrs: { target: "_blank", rel: "noopener noreferrer" } } : { onPress })}
      disabled={disabled} accessibilityRole={role}
      accessibilityLabel={label} accessibilityHint={hint}
      aria-expanded={expanded} aria-pressed={selected}
      accessibilityState={{ ...(selected == null ? {} : { selected }), ...(expanded == null ? {} : { expanded }), disabled: !!disabled }}
      onFocus={(event) => setFocused(isKeyboardFocus(event))} onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.choice, selected && styles.selected, pressed && styles.pressed, disabled && styles.disabled, focused && focusRing, style]}
    >
      {icon ? <Icon name={icon} size={16} color={selected ? colors.amber : colors.textDim} /> : null}
      {children || <Text style={[styles.choiceText, selected && styles.selectedText]}>{label}</Text>}
    </Control>
  );
}

function AfterShowChoices({ context, showTitle }) {
  const [expanded, setExpanded] = useState(false);
  const [intent, setIntent] = useState("food");
  const [destination, setDestination] = useState("");
  const [mode, setMode] = useState("transit");
  const [pending, setPending] = useState(false);
  const [mapsError, setMapsError] = useState(false);
  const [destinationFocused, setDestinationFocused] = useState(false);
  const mounted = useRef(true);
  const opening = useRef(false);
  const operation = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current += 1; }; }, []);
  const selectedIntent = AFTER_SHOW_INTENTS.find(({ id }) => id === intent);
  const guidance = intent === "get-home" ? AFTER_SHOW_TRAVEL_MODES.find(({ id }) => id === mode).note : selectedIntent.note;
  const searches = afterpartySearches(context.location, context.place, intent);
  const directions = afterShowDirections(context.location, destination, mode);
  const error = catalogEntry("PIT-LINK-001");

  const clearOpen = () => {
    operation.current += 1;
    opening.current = false;
    setPending(false);
    setMapsError(false);
  };
  const openMaps = async (url) => {
    if (!url || opening.current) return;
    const current = ++operation.current;
    opening.current = true;
    setPending(true);
    setMapsError(false);
    try {
      await Linking.openURL(url);
    } catch {
      if (mounted.current && operation.current === current) setMapsError(true);
    } finally {
      if (mounted.current && operation.current === current) { opening.current = false; setPending(false); }
    }
  };

  return (
    <View testID="after-show" style={styles.wrap}>
      {showTitle ? (
        <Choice label={context.neutral ? "Around the venue" : "After the show"} expanded={expanded}
          onPress={() => { clearOpen(); setExpanded(!expanded); }} style={styles.disclosure}>
          <View style={styles.copy}>
            <Text style={styles.title}>{context.title}</Text>
            <Text style={styles.meta}>Food, places to go & routes home</Text>
          </View>
          <View style={expanded && styles.expandedArrow}><Icon name="chevron-down" size={18} color={colors.textDim} /></View>
        </Choice>
      ) : null}
      {!showTitle || expanded ? <>
      <View style={styles.context}>
        <Icon name="pin" size={16} color={colors.amber} />
        <View style={styles.copy}>
          <Text style={styles.place} selectable>{context.place || (context.location ? "Around the venue’s map location" : "Venue location unavailable")}</Text>
          {context.showDate ? <Text style={styles.meta} selectable>Show date · {context.showDate}</Text> : null}
        </View>
      </View>
      {!context.location ? (
        <View style={styles.unavailable}>
          <Text style={styles.place}>Nearby planning unavailable</Text>
          <Text style={styles.body}>This venue’s map location is missing. Check the venue’s official directions before choosing somewhere nearby.</Text>
        </View>
      ) : (
        <>
          <Text style={styles.prompt}>{context.neutral ? "Explore the area" : "Where to next?"}</Text>
          <View style={styles.choices}>
            {AFTER_SHOW_INTENTS.map((item) => (
              <Choice key={item.id} label={item.label} icon={item.icon} selected={intent === item.id}
                onPress={() => { clearOpen(); setIntent(item.id); }} />
            ))}
          </View>
          {intent === "get-home" ? (
            <View style={styles.route}>
              <Text style={styles.place}>Plan your route from the venue</Text>
              <TextInput
                value={destination} onChangeText={(value) => { clearOpen(); setDestination(value); }}
                placeholder="Hotel, station or address" placeholderTextColor={colors.textFaint}
                accessibilityLabel="Where are you heading after the show?" maxLength={200}
                onFocus={() => setDestinationFocused(true)} onBlur={() => setDestinationFocused(false)}
                style={[styles.input, destinationFocused && focusRing]} returnKeyType="go"
                onSubmitEditing={() => { void openMaps(directions); }}
              />
              <View style={styles.choices}>
                {AFTER_SHOW_TRAVEL_MODES.map((item) => (
                  <Choice key={item.id} label={item.label} selected={mode === item.id}
                    onPress={() => { clearOpen(); setMode(item.id); }} />
                ))}
              </View>
              <Choice label={pending ? "Opening Google Maps…" : "Open route in Google Maps"} icon="external"
                disabled={!directions || pending} onPress={() => { void openMaps(directions); }} style={styles.routeButton}
                hint={`Starts at ${context.venue}.`} />
              <Text style={styles.meta}>Your destination is sent to Google Maps when you open the route. It isn’t saved in mshpit.</Text>
            </View>
          ) : (
            <View style={styles.searches}>
              {searches.map((search, index) => (
                <Choice key={search.id} label={`Search Google Maps for ${search.label} near ${context.venue}`}
                  href={search.url}
                  role="link" disabled={pending} onPress={() => { void openMaps(search.url); }}
                  hint="Search results are not checked recommendations." style={[styles.search, index > 0 && styles.separator]}>
                  <View style={styles.copy}>
                    <Text style={styles.place}>{search.label}</Text>
                    <Text style={styles.meta}>{search.description}</Text>
                  </View>
                  <Icon name="external" size={16} color={colors.amber} />
                </Choice>
              ))}
            </View>
          )}
          {mapsError ? (
            <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.errorBox}>
              <Text style={styles.error} selectable>{error.message} {error.guidance} (PIT-LINK-001)</Text>
            </View>
          ) : null}
          <View style={styles.guidance}>
            <Text style={styles.body}>{guidance}</Text>
            <Text style={styles.meta}>{context.timingNote}</Text>
          </View>
          <Text style={styles.source}>Google Maps · Hours and availability aren’t verified by mshpit.</Text>
        </>
      )}
      </> : null}
    </View>
  );
}

// Typography follows ShowScreen; spacing, color, radius and focus treatment
// come from mshpit's existing system, including its light themes.
const styles = StyleSheet.create({
  wrap: { gap: space(3) },
  title: { color: colors.text, fontFamily: displayFont, fontSize: 18, fontWeight: "900", letterSpacing: 0.5 },
  disclosure: { borderWidth: 0, backgroundColor: "transparent", paddingHorizontal: 0, paddingVertical: space(1), justifyContent: "space-between" },
  expandedArrow: { transform: [{ rotate: "180deg" }] },
  context: { flexDirection: "row", alignItems: "flex-start", gap: space(2) },
  copy: { flex: 1, minWidth: 0, gap: space(1) },
  place: { color: colors.text, fontFamily: font, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  meta: { color: colors.textDim, fontFamily: font, fontSize: 12, lineHeight: 18 },
  prompt: { color: colors.text, fontFamily: displayFont, fontSize: 16, fontWeight: "800" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  choice: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space(2), paddingHorizontal: space(3), paddingVertical: space(2), borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  selected: { backgroundColor: colors.surfaceAlt, borderColor: colors.amber },
  choiceText: { color: colors.textDim, fontFamily: font, fontSize: 13, lineHeight: 19, fontWeight: "700", flexShrink: 1 },
  selectedText: { color: colors.amber },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
  searches: { borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: colors.surface, overflow: "hidden" },
  search: { justifyContent: "space-between", borderWidth: 0, borderRadius: 0, minHeight: 64, padding: space(3) },
  separator: { borderTopWidth: 1, borderTopColor: colors.lineSoft },
  route: { gap: space(3) },
  routeButton: { borderColor: colors.amber },
  input: { minWidth: 0, minHeight: 48, padding: space(3), borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: colors.surface, color: colors.text, fontFamily: font, fontSize: 14 },
  guidance: { gap: space(2) },
  body: { color: colors.textDim, fontFamily: font, fontSize: 13, lineHeight: 20 },
  source: { color: colors.textFaint, fontFamily: font, fontSize: 11, lineHeight: 17 },
  errorBox: { paddingVertical: space(2) },
  error: { color: colors.danger, fontFamily: font, fontSize: 12, lineHeight: 18 },
  unavailable: { gap: space(2), padding: space(3), borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: colors.surface },
});
