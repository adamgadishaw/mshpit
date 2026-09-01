import { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Button from "../Button";
import Icon from "../Icon";
import { colors, displayFont, focusRing, mono, radius, shadow, space } from "../../theme";
import {
  ARTIST_DEATH_WATCH_FILTERS,
  artistDeathWatchEmptyMessage,
  artistDeathWatchProviderWarning,
  normalizeArtistDeathWatchFilter,
} from "../../domain/artistDeathWatchPresentation.mjs";

const when = (value) => value != null && Number.isFinite(Number(value))
  ? new Date(Number(value)).toLocaleString()
  : "Not yet";

export default function ArtistDeathWatchPanel({ watch, isAdmin = false }) {
  const [evidenceError, setEvidenceError] = useState("");
  const data = watch?.data || {};
  const pending = Number(data.counts?.pending) || 0;
  const dismissed = Number(data.counts?.dismissed) || 0;
  const memorialized = Number(data.counts?.memorialized) || 0;
  const counts = { pending, dismissed, memorialized };
  const status = normalizeArtistDeathWatchFilter(watch?.status);
  const running = data.running === true;
  const error = evidenceError || watch?.error?.userMessage || watch?.error?.message || "";
  const providerWarning = running ? "" : artistDeathWatchProviderWarning(data.settings?.lastErrorCode);
  const eligibleArtists = Number(data.eligibleCount ?? data.eligibleArtists) || 0;
  const scanChecked = Math.max(0, Number(data.scanProgress?.checked) || 0);
  const scanTotal = Math.max(0, Number(data.scanProgress?.total) || eligibleArtists);
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
          {isAdmin ? <Button title={running ? "Checking" : "Check now"} variant="secondary" small icon="search" loading={running} disabled={watch?.loading || running} onPress={watch?.runNow} /> : null}
        </View>
      </View>

      <View style={[styles.status, shadow.card]}>
        <View><Text style={styles.statusValue}>{pending}</Text><Text style={styles.statusLabel}>NEEDS REVIEW</Text></View>
        <View><Text style={styles.statusValue}>{eligibleArtists}</Text><Text style={styles.statusLabel}>ARTISTS ELIGIBLE TO CHECK</Text></View>
        <View><Text style={styles.statusValue}>{scanChecked} / {scanTotal}</Text><Text style={styles.statusLabel}>CURRENT CATALOG PASS</Text></View>
        <View><Text style={styles.statusValue}>{when(data.settings?.lastSuccessAt)}</Text><Text style={styles.statusLabel}>LAST COMPLETED CHECK</Text></View>
      </View>
      <Text style={styles.countNote}>Needs review is only the number of confirmed alerts waiting for staff. It is not a count of every deceased artist in the catalog.</Text>

      <View accessibilityRole="tablist" style={styles.filters}>
        {ARTIST_DEATH_WATCH_FILTERS.map((filter) => {
          const selected = status === filter.status;
          return (
            <Pressable
              key={filter.status}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => watch?.setStatus?.(filter.status)}
              style={({ pressed, focused }) => [
                styles.filter,
                selected && styles.filterSelected,
                focused && focusRing,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.filterText, selected && styles.filterTextSelected]}>{filter.label}</Text>
              <Text style={[styles.filterCount, selected && styles.filterTextSelected]}>{counts[filter.status]}</Text>
            </Pressable>
          );
        })}
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

      {running ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.running}>Checking artist sources in the background. You can leave this page; confirmed alerts will be saved.</Text> : null}
      {providerWarning ? (
        <View style={styles.providerWarning}>
          <Text style={styles.providerWarningLabel}>LAST SOURCE WARNING</Text>
          <Text accessibilityRole="alert" style={styles.warning}>{providerWarning}</Text>
        </View>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {!watch?.loading && !running && !data.candidates?.length ? <Text style={styles.empty}>{artistDeathWatchEmptyMessage(status)}</Text> : null}
      {(data.candidates || []).map((candidate) => (
        <View key={candidate.artistKey} style={[styles.card, shadow.card]}>
          <View style={styles.cardTop}>
            <View style={styles.cardCopy}><Text style={styles.name}>{candidate.artistName}</Text><Text selectable style={styles.ids}>{candidate.wikidataId} · {candidate.artistMbid}</Text></View>
            <Text style={styles.date}>{candidate.deathDate}</Text>
          </View>
          <Text style={styles.candidateWarning}>Two catalog sources agree this exact identity is a person and report the same full death date. Confirm with a trusted announcement before publishing a memorial.</Text>
          <View style={styles.evidence}>
            {(candidate.evidence || []).map((source) => (
              <Pressable key={source.provider} accessibilityRole="link" onPress={() => { void openEvidence(source.url); }} style={({ focused }) => [styles.source, focused && focusRing]}>
                <Icon name="external" size={13} color={colors.cool} /><Text style={styles.sourceText}>{source.provider} source</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.cardActions}>
            {candidate.status === "pending" ? <Button title="Not this artist / incorrect" variant="secondary" small disabled={watch?.loading || running} onPress={() => watch?.review?.(candidate.artistKey, "dismissed")} /> : null}
            {candidate.status === "dismissed" ? <Button title="Return to review" variant="secondary" small disabled={watch?.loading || running} onPress={() => watch?.review?.(candidate.artistKey, "pending")} /> : null}
            {candidate.status === "memorialized" ? <Text style={styles.memorialized}>Memorial published</Text> : null}
            {isAdmin && candidate.status === "pending" ? <Text style={styles.adminHint}>Use Memorials to verify the announcement and publish the permanent tribute.</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space(4) }, heading: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: space(3) }, headingCopy: { flex: 1, minWidth: 240, maxWidth: 760 },
  kicker: { color: colors.gold, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.2 }, title: { color: colors.text, fontFamily: displayFont, fontSize: 24, lineHeight: 30, fontWeight: "900" }, detail: { color: colors.textDim, fontSize: 12.5, lineHeight: 19, paddingTop: 4 }, actions: { flexDirection: "row", gap: space(2) },
  status: { flexDirection: "row", flexWrap: "wrap", gap: space(5), padding: space(4), borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface }, statusValue: { color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: "900" }, statusLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 8.5, letterSpacing: 1 }, countNote: { color: colors.textFaint, fontSize: 10.5, lineHeight: 16 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: space(2) }, filter: { flexDirection: "row", alignItems: "center", gap: space(1.5), paddingHorizontal: space(3), paddingVertical: space(2), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface }, filterSelected: { borderColor: colors.amber, backgroundColor: colors.amberSoft }, filterText: { color: colors.textDim, fontSize: 11, fontWeight: "800" }, filterTextSelected: { color: colors.text }, filterCount: { minWidth: 20, color: colors.textFaint, fontFamily: mono, fontSize: 9, fontWeight: "900", textAlign: "center" },
  setting: { flexDirection: "row", gap: space(3), alignItems: "center", padding: space(3.5), borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev }, settingCopy: { flex: 1 }, settingTitle: { color: colors.text, fontWeight: "900" }, settingDetail: { color: colors.textFaint, fontSize: 11, lineHeight: 16, paddingTop: 2 }, switchTrack: { width: 44, height: 26, padding: 3, justifyContent: "center", borderRadius: 13, backgroundColor: colors.surfaceAlt }, switchOn: { backgroundColor: colors.amberStrong }, switchThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.textDim }, thumbOn: { alignSelf: "flex-end", backgroundColor: "#1A1206" },
  running: { color: colors.cool, fontSize: 12, lineHeight: 18, fontWeight: "800", padding: space(3), borderWidth: 1, borderColor: colors.cool, borderRadius: radius.md, backgroundColor: colors.bgElev }, providerWarning: { gap: space(1), padding: space(3), borderWidth: 1, borderColor: colors.gold, borderRadius: radius.md, backgroundColor: colors.bgElev }, providerWarningLabel: { color: colors.gold, fontFamily: mono, fontSize: 8.5, fontWeight: "900", letterSpacing: 1 }, warning: { color: colors.gold, fontSize: 12, lineHeight: 18, fontWeight: "800" }, error: { color: colors.danger, fontSize: 12, fontWeight: "800" }, empty: { color: colors.textDim, textAlign: "center", padding: space(5), borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.md },
  card: { gap: space(3), padding: space(4), borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface }, cardTop: { flexDirection: "row", justifyContent: "space-between", gap: space(3) }, cardCopy: { flex: 1, minWidth: 0 }, name: { color: colors.text, fontSize: 17, fontWeight: "900" }, ids: { color: colors.textFaint, fontFamily: mono, fontSize: 8.5, paddingTop: 2 }, date: { color: colors.gold, fontFamily: mono, fontWeight: "900" }, candidateWarning: { color: colors.textDim, fontSize: 11.5, lineHeight: 17 }, evidence: { flexDirection: "row", flexWrap: "wrap", gap: space(2) }, source: { flexDirection: "row", alignItems: "center", gap: space(1), padding: space(2), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineSoft }, sourceText: { color: colors.cool, fontSize: 10.5, fontWeight: "800" }, cardActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2) }, memorialized: { color: colors.cool, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 0.6 }, adminHint: { flex: 1, minWidth: 220, color: colors.textFaint, fontSize: 10.5, lineHeight: 15 }, pressed: { opacity: 0.75 },
});
