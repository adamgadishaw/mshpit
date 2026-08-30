import { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Button from "../Button";
import Icon from "../Icon";
import { colors, displayFont, focusRing, mono, radius, shadow, space } from "../../theme";

const when = (value) => value != null && Number.isFinite(Number(value))
  ? new Date(Number(value)).toLocaleString()
  : "Not yet";

export default function ArtistDeathWatchPanel({ watch, isAdmin = false }) {
  const [evidenceError, setEvidenceError] = useState("");
  const data = watch?.data || {};
  const pending = Number(data.counts?.pending) || 0;
  const error = evidenceError || watch?.error?.userMessage || watch?.error?.message || "";
  const openEvidence = async (url) => {
    setEvidenceError("");
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) throw new Error("This evidence link cannot be opened on this device.");
      await Linking.openURL(url);
    } catch (linkError) {
      setEvidenceError(linkError?.message || "This evidence link could not be opened.");
    }
  };
  return (
    <View style={styles.wrap}>
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text style={styles.kicker}>IDENTITY-VERIFIED WATCH</Text>
          <Text accessibilityRole="header" style={styles.title}>Artist alerts</Text>
          <Text style={styles.detail}>Mshpit checks exact Wikidata and MusicBrainz identities for individual people. A match only enters this private review queue; it never changes a page or publishes a memorial.</Text>
        </View>
        <View style={styles.actions}>
          <Button title="Refresh" variant="secondary" small loading={watch?.loading} onPress={watch?.reload} />
          {isAdmin ? <Button title="Check now" variant="secondary" small icon="search" disabled={watch?.loading} onPress={watch?.runNow} /> : null}
        </View>
      </View>

      <View style={[styles.status, shadow.card]}>
        <View><Text style={styles.statusValue}>{pending}</Text><Text style={styles.statusLabel}>NEEDS REVIEW</Text></View>
        <View><Text style={styles.statusValue}>{Number(data.eligibleArtists) || 0}</Text><Text style={styles.statusLabel}>EXACT IDENTITIES COVERED</Text></View>
        <View><Text style={styles.statusValue}>{when(data.settings?.lastSuccessAt)}</Text><Text style={styles.statusLabel}>LAST COMPLETED CHECK</Text></View>
      </View>

      {isAdmin ? (
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: data.settings?.enabled === true, disabled: watch?.loading }}
          disabled={watch?.loading}
          onPress={() => watch?.setEnabled?.(data.settings?.enabled !== true)}
          style={({ pressed, focused }) => [styles.setting, focused && focusRing, pressed && styles.pressed]}
        >
          <View style={[styles.switchTrack, data.settings?.enabled && styles.switchOn]}><View style={[styles.switchThumb, data.settings?.enabled && styles.thumbOn]} /></View>
          <View style={styles.settingCopy}><Text style={styles.settingTitle}>Automatic artist alerts {data.settings?.enabled ? "on" : "off"}</Text><Text style={styles.settingDetail}>The worker is bounded and rate-limited. Staff still verify the sources and write every tribute themselves.</Text></View>
        </Pressable>
      ) : null}

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {!watch?.loading && !data.candidates?.length ? <Text style={styles.empty}>No exact, corroborated artist deaths currently need review.</Text> : null}
      {(data.candidates || []).map((candidate) => (
        <View key={candidate.artistKey} style={[styles.card, shadow.card]}>
          <View style={styles.cardTop}>
            <View style={styles.cardCopy}><Text style={styles.name}>{candidate.artistName}</Text><Text selectable style={styles.ids}>{candidate.wikidataId} · {candidate.artistMbid}</Text></View>
            <Text style={styles.date}>{candidate.deathDate}</Text>
          </View>
          <Text style={styles.warning}>Two catalog sources agree this exact identity is a person and report the same full death date. Confirm with a trusted announcement before publishing a memorial.</Text>
          <View style={styles.evidence}>
            {(candidate.evidence || []).map((source) => (
              <Pressable key={source.provider} accessibilityRole="link" onPress={() => { void openEvidence(source.url); }} style={({ focused }) => [styles.source, focused && focusRing]}>
                <Icon name="external" size={13} color={colors.cool} /><Text style={styles.sourceText}>{source.provider} source</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.cardActions}>
            <Button title="Not this artist / incorrect" variant="secondary" small disabled={watch?.loading} onPress={() => watch?.review?.(candidate.artistKey, "dismissed")} />
            {isAdmin ? <Text style={styles.adminHint}>Use Memorials to verify the announcement and publish the permanent tribute.</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space(4) }, heading: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: space(3) }, headingCopy: { flex: 1, minWidth: 240, maxWidth: 760 },
  kicker: { color: colors.gold, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.2 }, title: { color: colors.text, fontFamily: displayFont, fontSize: 24, lineHeight: 30, fontWeight: "900" }, detail: { color: colors.textDim, fontSize: 12.5, lineHeight: 19, paddingTop: 4 }, actions: { flexDirection: "row", gap: space(2) },
  status: { flexDirection: "row", flexWrap: "wrap", gap: space(5), padding: space(4), borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface }, statusValue: { color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: "900" }, statusLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 8.5, letterSpacing: 1 },
  setting: { flexDirection: "row", gap: space(3), alignItems: "center", padding: space(3.5), borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev }, settingCopy: { flex: 1 }, settingTitle: { color: colors.text, fontWeight: "900" }, settingDetail: { color: colors.textFaint, fontSize: 11, lineHeight: 16, paddingTop: 2 }, switchTrack: { width: 44, height: 26, padding: 3, justifyContent: "center", borderRadius: 13, backgroundColor: colors.surfaceAlt }, switchOn: { backgroundColor: colors.amberStrong }, switchThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.textDim }, thumbOn: { alignSelf: "flex-end", backgroundColor: "#1A1206" },
  error: { color: colors.danger, fontSize: 12, fontWeight: "800" }, empty: { color: colors.textDim, textAlign: "center", padding: space(5), borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.md },
  card: { gap: space(3), padding: space(4), borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface }, cardTop: { flexDirection: "row", justifyContent: "space-between", gap: space(3) }, cardCopy: { flex: 1, minWidth: 0 }, name: { color: colors.text, fontSize: 17, fontWeight: "900" }, ids: { color: colors.textFaint, fontFamily: mono, fontSize: 8.5, paddingTop: 2 }, date: { color: colors.gold, fontFamily: mono, fontWeight: "900" }, warning: { color: colors.textDim, fontSize: 11.5, lineHeight: 17 }, evidence: { flexDirection: "row", flexWrap: "wrap", gap: space(2) }, source: { flexDirection: "row", alignItems: "center", gap: space(1), padding: space(2), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineSoft }, sourceText: { color: colors.cool, fontSize: 10.5, fontWeight: "800" }, cardActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2) }, adminHint: { flex: 1, minWidth: 220, color: colors.textFaint, fontSize: 10.5, lineHeight: 15 }, pressed: { opacity: 0.75 },
});
