import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import DiscoverBrowse from "./DiscoverBrowse.ios";
import DiscoverSectionTabs from "./DiscoverSectionTabs.ios";
import NativeDiscoverSectionPager from "../NativeDiscoverSectionPager.ios";
import { ScrollView } from "../NativeTabScroll";
import NativeLargeTitle, { NativeLargeTitleProvider } from "../NativeLargeTitle.ios";
import Icon from "../Icon";
import { colors } from "../../theme";
import useNativeTabPreview from "../../hooks/useNativeTabPreview";
import useNativeTabContentReady from "../../hooks/useNativeTabContentReady";
import useAppActive from "../../lib/useAppActive";

export default function DiscoverSectionBrowser(props) {
  return <DiscoverOwner key={`${props.accountId || "guest"}:${props.browseReturn?.key || "discover"}`} {...props} />;
}
export function DiscoverOwner(props) {
  const inheritedPreview = useNativeTabPreview();
  const appActive = useAppActive();
  const [areaOpen, setAreaOpen] = useState(false);
  const [genreFocused, setGenreFocused] = useState(props.initialBrowse?.genreFocused === true);
  const [tapRevision, setTapRevision] = useState(0);
  const initialSection = useRef(props.programme);
  const latest = useRef(null); latest.current = props;
  const scope = useMemo(() => ({ route: props.swipeScope, account: props.accountId, region: props.region,
    local: props.local, days: props.selectedRangeDays, genre: props.selectedGenre, query: props.query, eventView: props.eventView, appActive, inheritedPreview }), [props.swipeScope, props.accountId, props.region, props.local, props.selectedRangeDays, props.selectedGenre, props.query, props.eventView, appActive, inheritedPreview]);
  const life = useRef(null);
  const [admission, setAdmission] = useState(null);
  useLayoutEffect(() => {
    const next = { scope }; life.current = next; setAdmission(next);
    return () => { if (life.current === next) life.current = null; };
  }, [scope]);
  const current = useCallback(() => !!admission && life.current === admission && admission.scope === scope
    && appActive && !inheritedPreview && latest.current.swipeEnabled !== false
    && (!latest.current.isCurrentSwipeRoute || latest.current.isCurrentSwipeRoute())
    && (!latest.current.browseReturn?.current || latest.current.browseReturn.current()), [admission, scope, appActive, inheritedPreview]);
  const choose = value => {
    if (!current()) return;
    setTapRevision(revision => revision + 1); setGenreFocused(false);
    latest.current.browseReturn?.save({ scrollY: 0, genreFocused: false });
    if (value !== latest.current.programme) { initialSection.current = null; latest.current.onProgramme(value); }
  };
  const commit = useCallback(value => { if (!current()) return false; setGenreFocused(false); initialSection.current = null; latest.current.browseReturn?.save({ scrollY: 0, genreFocused: false }); latest.current.onProgramme(value); return true; }, [current]);
  const changeArea = country => { if (!current()) return; setTapRevision(revision => revision + 1); setAreaOpen(false); initialSection.current = null; latest.current.browseReturn?.save({ scrollY: 0 }); props.onRegion(country); };
  const navigation = (x, width, origin) => <View testID="discover-fixed-navigation">
      <View style={styles.header}>
        <NativeLargeTitle><Text style={styles.title} accessibilityRole="header">Discover</Text></NativeLargeTitle>
        <Pressable onPress={() => { if (current()) { setTapRevision(revision => revision + 1); setAreaOpen(value => !value); } }} accessibilityRole="button"
          accessibilityLabel={`Choose an area to explore. Current area: ${props.region}`} accessibilityState={{ expanded: areaOpen }} style={styles.areaButton}>
          <Icon name={props.region === "Worldwide" ? "globe" : "pin"} size={16} color={colors.amber} />
          <Text style={styles.areaText}>{props.region}</Text><Icon name="chevron-down" size={14} color={colors.amber} />
        </Pressable>
      </View>
      <DiscoverSectionTabs selected={props.programme} onSelect={choose} enabled={current()}
        x={x} width={width} origin={origin} onInteraction={() => { if (current()) setTapRevision(value => value + 1); }} />
      {areaOpen ? <ScrollView observePageTitle={false} style={styles.areaChoices} contentContainerStyle={styles.areaContent} accessibilityLabel="Choose an area to explore">
        {props.countries.map(country => <Pressable key={country.country} onPress={() => changeArea(country.country)} accessibilityRole="radio"
          accessibilityState={{ checked: country.country === props.region }} style={styles.areaButton}><Text style={styles.areaText}>{country.country}</Text></Pressable>)}
        <Pressable onPress={() => setAreaOpen(false)} accessibilityRole="button" style={styles.areaButton}><Text style={styles.areaText}>Done</Text></Pressable>
      </ScrollView> : null}
    </View>;
  return <NativeLargeTitleProvider><View style={styles.root}>
    <NativeDiscoverSectionPager renderNavigation={navigation} active={props.programme} onChange={commit} swipeScope={scope} tapRevision={tapRevision}
      loading={props.loading} swipeEnabled={appActive && !inheritedPreview && !areaOpen && props.swipeEnabled !== false} isCurrentSwipeRoute={current}
      renderPage={(section, preview) => <DiscoverPane {...props} programme={section} localSection
        initialBrowse={section === initialSection.current ? props.initialBrowse : null}
        sectionGenreFocused={section === "artists" && genreFocused} onSectionGenreFocus={setGenreFocused}
        onProgramme={choose} navigationRevision={tapRevision} preview={preview} isCurrent={current} />} />
  </View></NativeLargeTitleProvider>;
}
export function DiscoverPane({ preview, isCurrent, browseReturn, ...props }) {
  const permitted = useRef(null); permitted.current = () => !preview && isCurrent();
  const lease = useMemo(() => browseReturn && ({
    key: browseReturn.key,
    current: () => permitted.current() && (!browseReturn.current || browseReturn.current()),
    save: value => { if (permitted.current() && (!browseReturn.current || browseReturn.current())) browseReturn.save(value); },
  }), [browseReturn]);
  // Shared data already belongs to the screen; independently loaded sections
  // report through their existing resource hooks below this same boundary.
  const ready = props.programme === "shows" ? !!(props.events?.length || props.rangeEvents?.length) || ["ready", "error"].includes(props.eventStatus)
    : props.programme === "artists" ? (!!props.chart?.rows?.length || ["ready", "error"].includes(props.overviewStatus)) && (!props.sectionGenreFocused || !!props.genreRows?.length || ["ready", "error"].includes(props.genreStatus))
    : props.programme === "venues";
  return <>{["shows", "artists", "venues"].includes(props.programme) ? <SectionReadiness ready={ready} /> : null}<DiscoverBrowse {...props} browseReturn={lease} /></>;
}
function SectionReadiness({ ready }) { useNativeTabContentReady(ready); return null; }
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, alignItems: "flex-start" },
  title: { color: colors.text, fontFamily: "System", fontSize: 36, fontWeight: "700", letterSpacing: -1.1 },
  areaButton: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 7 },
  areaText: { color: colors.amber, fontFamily: "System", fontSize: 15, fontWeight: "600", flexShrink: 1 },
  areaChoices: { maxHeight: 220 }, areaContent: { paddingHorizontal: 20, paddingBottom: 12 },
});
