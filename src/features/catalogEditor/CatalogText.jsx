import { useEffect, useState } from "react";
import { Alert, Linking, StyleSheet, Text, View } from "react-native";
import { readCatalogPageText } from "../../lib/catalogTextApi";
import { colors, space } from "../../theme";
import { PublicPressableLink } from "../../components/PublicWebLinks";

export default function CatalogText({ type, entityKey }) {
  const scope = `${type}:${entityKey || ""}`;
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!entityKey) return undefined;
    const controller = new AbortController();
    readCatalogPageText({ type, key: entityKey, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setState({ scope, text: result.text }); })
      // architecture: allow-empty-catch -- optional sourced context; existing page content remains available
      .catch(() => {});
    return () => controller.abort();
  }, [scope, type, entityKey]);
  const content = state?.scope === scope ? state.text : null;
  if (!content) return null;
  return <View style={styles.box} accessibilityLabel="Sourced page context"><Text style={styles.label}>ABOUT THIS {type.toUpperCase()}</Text>
    <Text selectable style={styles.body}>{content.summary}</Text>
    <View style={styles.sources}>{content.sources.map(source => <PublicPressableLink key={source.url} href={source.url}
      onNavigate={() => Linking.openURL(source.url).catch(() => Alert.alert("Source unavailable", "This source could not open. Please try again."))} accessibilityLabel={`Source: ${source.label}`}><Text style={styles.link}>{source.label}</Text></PublicPressableLink>)}</View>
  </View>;
}
const styles = StyleSheet.create({ box: { paddingVertical: space(3), gap: space(2) }, label: { color: colors.textFaint, fontSize: 11, fontWeight: "700", letterSpacing: 1.3 },
  body: { color: colors.textDim, fontSize: 14, lineHeight: 21 }, sources: { flexDirection: "row", flexWrap: "wrap", gap: space(3) }, link: { color: colors.amber, fontSize: 13, paddingVertical: space(2) } });
