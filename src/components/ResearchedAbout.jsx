import { useEffect, useState } from "react";
import { Alert, Linking, StyleSheet, Text, View } from "react-native";

import Icon from "./Icon";
import { PublicPressableLink } from "./PublicWebLinks";
import { fetchArtistResearch, fetchVenueResearch } from "../lib/catalogResearchApi";
import { colors, radius, space } from "../theme";

const openSource = (url) => Linking.openURL(url).catch(() => Alert.alert("Source unavailable", "The source could not open. Please try again."));

// A short summary and facts for a page the catalogue sources left empty, with
// every source linked. Renders nothing until there is something to show, so a
// page without research looks exactly as it did.
export default function ResearchedAbout({ kind, entityKey, city = null, label = null }) {
  const [research, setResearch] = useState(null);

  useEffect(() => {
    if (!entityKey) return undefined;
    const controller = new AbortController();
    setResearch(null);
    const load = kind === "venue"
      ? fetchVenueResearch(entityKey, { city, signal: controller.signal })
      : fetchArtistResearch(entityKey, { signal: controller.signal });
    load.then((value) => { if (!controller.signal.aborted) setResearch(value); })
      // architecture: allow-empty-catch -- optional page text; the page is complete without it
      .catch(() => {});
    return () => controller.abort();
  }, [kind, entityKey, city]);

  if (!research?.summary) return null;
  return (
    <View accessibilityLabel={kind === "venue" ? "About this venue" : "About this artist"}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Text selectable style={styles.summary}>{research.summary}</Text>
      {research.facts?.length > 0 && (
        <View style={styles.facts}>
          {research.facts.map((fact) => (
            <View key={fact.field} style={styles.fact}>
              <Text style={styles.factLabel}>{fact.label}</Text>
              {fact.field === "website" ? (
                <PublicPressableLink href={fact.value} onNavigate={() => openSource(fact.value)} style={styles.factValueLink} accessibilityLabel={`${fact.label}: ${fact.value}`}>
                  <Text style={styles.link} numberOfLines={1}>{fact.value.replace(/^https:\/\/(www\.)?/u, "").replace(/\/$/u, "")}</Text>
                </PublicPressableLink>
              ) : (
                <Text selectable style={styles.factValue}>{fact.value}</Text>
              )}
            </View>
          ))}
        </View>
      )}
      {research.sources?.length > 0 && (
        <View style={styles.sources}>
          <Text style={styles.sourcesNote}>Summarised from</Text>
          {research.sources.map((source) => (
            <PublicPressableLink key={source.url} href={source.url} onNavigate={() => openSource(source.url)} style={styles.source} accessibilityLabel={`Source: ${source.site}`}>
              <Text style={styles.link}>{source.site}</Text>
              <Icon name="external" size={11} color={colors.amber} />
            </PublicPressableLink>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginTop: space(5), marginBottom: space(2) },
  summary: { color: colors.textDim, fontSize: 14, lineHeight: 21 },
  facts: { marginTop: space(3), borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.md, backgroundColor: colors.surface, padding: space(3), gap: space(2) },
  fact: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2) },
  factLabel: { color: colors.textDim, fontSize: 13, minWidth: 100 },
  factValue: { color: colors.text, fontSize: 14, fontWeight: "800", flex: 1 },
  factValueLink: { flex: 1, minHeight: 32, justifyContent: "center" },
  sources: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2), marginTop: space(2) },
  sourcesNote: { color: colors.textFaint, fontSize: 12 },
  source: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 4 },
  link: { color: colors.amber, fontSize: 12.5, fontWeight: "800" },
});
