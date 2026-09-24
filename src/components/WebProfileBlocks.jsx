import { useEffect, useState } from "react";
import { Alert, Linking, StyleSheet, Text, View } from "react-native";

import Icon from "./Icon";
import { PublicPressableLink } from "./PublicWebLinks";
import { fetchArtistWebProfile, fetchVenueWebProfile } from "../lib/webProfilesApi";
import { colors, radius, space } from "../theme";

const openLink = (url) => Linking.openURL(url).catch(() => Alert.alert("Link unavailable", "The page could not open. Please try again."));

function useWebProfile(load, deps) {
  const [profile, setProfile] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    setProfile(null);
    const pending = load(controller.signal);
    if (!pending) return () => controller.abort();
    pending.then((value) => { if (!controller.signal.aborted) setProfile(value); })
      // architecture: allow-empty-catch -- optional page details; the page is complete without them
      .catch(() => {});
    return () => controller.abort();
    // deps are the page identity the record belongs to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return profile;
}

function SourceLine({ source, prefix }) {
  if (!source?.url) return <Text style={styles.source}>{prefix} {source?.name || "the venue"}</Text>;
  return (
    <View style={styles.sourceRow}>
      <Text style={styles.source}>{prefix}</Text>
      <PublicPressableLink href={source.url} onNavigate={() => openLink(source.url)} style={styles.sourceLink} accessibilityLabel={`Source: ${source.name}`}>
        <Text style={styles.link}>{source.name}</Text>
        <Icon name="external" size={11} color={colors.amber} />
      </PublicPressableLink>
    </View>
  );
}

// The artist's official site and profiles, as Ticketmaster lists them.
export function ArtistOfficialLinks({ artistKey, label = null }) {
  const profile = useWebProfile((signal) => (artistKey ? fetchArtistWebProfile(artistKey, { signal }) : null), [artistKey]);
  if (!profile?.links?.length) return null;
  return (
    <View accessibilityLabel="Official links">
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.pills}>
        {profile.links.map((link) => (
          <PublicPressableLink key={link.kind} href={link.url} onNavigate={() => openLink(link.url)} style={styles.pill} accessibilityLabel={`${link.label} (opens a new page)`}>
            <Text style={styles.pillText}>{link.label}</Text>
            <Icon name="external" size={11} color={colors.amber} />
          </PublicPressableLink>
        ))}
      </View>
      <SourceLine source={profile.source} prefix="Links from" />
    </View>
  );
}

const VENUE_DETAIL_LABELS = Object.freeze([
  ["boxOfficeHours", "Box office"],
  ["boxOfficePhone", "Box office phone"],
  ["willCall", "Ticket pickup"],
  ["payment", "Payment"],
  ["parking", "Parking"],
  ["accessibility", "Accessibility"],
  ["rules", "Entry rules"],
  ["children", "Ages"],
]);

// What the venue itself publishes for visitors, through its Ticketmaster page.
export function VenueVisitorDetails({ venueName, providerVenueId = null, city = null }) {
  const profile = useWebProfile(
    (signal) => (venueName ? fetchVenueWebProfile(venueName, { providerVenueId, city, signal }) : null),
    [venueName, providerVenueId, city],
  );
  const rows = VENUE_DETAIL_LABELS.filter(([key]) => typeof profile?.details?.[key] === "string");
  if (!rows.length) return null;
  return (
    <View style={styles.details} accessibilityLabel="Visitor details from the venue">
      {rows.map(([key, label]) => (
        <View key={key} style={styles.detail}>
          <Text style={styles.detailLabel}>{label}</Text>
          <Text selectable style={styles.detailValue}>{profile.details[key]}</Text>
        </View>
      ))}
      <SourceLine source={profile.source} prefix="From the venue's page on" />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginTop: space(5), marginBottom: space(2) },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  pill: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space(3), borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  pillText: { color: colors.text, fontSize: 13, fontWeight: "800" },
  details: { marginTop: space(3), borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.md, backgroundColor: colors.surface,
    padding: space(3), gap: space(3) },
  detail: { gap: 2 },
  detailLabel: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  detailValue: { color: colors.text, fontSize: 14, lineHeight: 20 },
  sourceRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2), marginTop: space(2) },
  sourceLink: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 4 },
  source: { color: colors.textFaint, fontSize: 12 },
  link: { color: colors.amber, fontSize: 12.5, fontWeight: "800" },
});
