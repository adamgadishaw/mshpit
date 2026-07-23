import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { colors, radius, mono, THEMES, themeKey, space } from "../theme";
import { useStore } from "../store";
import SheetHeader from "../components/SheetHeader";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";

function Row({ icon, label, sub, onPress, danger, right, disabled = false, accessibilityRole }) {
  return (
    <Pressable
      style={[styles.row, disabled && styles.rowDisabled]}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
    >
      <View style={[styles.rowIcon, danger && { borderColor: colors.danger }]}>
        <Icon name={icon} size={17} color={danger ? colors.danger : colors.amber} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, danger && { color: colors.danger }]}>{label}</Text>
        {!!sub && <Text style={styles.rowSub}>{sub}</Text>}
      </View>
      {right || (!danger && <Icon name="chevron-right" size={18} color={colors.textDim} />)}
    </Pressable>
  );
}

function Toggle({ value, busy = false }) {
  return (
    <View
      style={[styles.toggle, value && styles.toggleOn, busy && styles.toggleBusy]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.toggleKnob, value && styles.toggleKnobOn]} />
    </View>
  );
}

// Theme swatch: a mini preview of the preset's palette.
function Swatch({ theme, active, onPress }) {
  const s = theme.swatch;
  return (
    <Pressable style={[styles.swatch, { backgroundColor: s.bg, borderColor: active ? colors.amber : colors.line }]} onPress={onPress}>
      <View style={styles.swatchDots}>
        <View style={[styles.chip, { backgroundColor: s.accent }]} />
        <View style={[styles.chip, { backgroundColor: s.accent2 }]} />
        <View style={[styles.bar, { backgroundColor: s.surface, borderColor: s.accent }]} />
      </View>
      <Text style={[styles.swatchName, { color: s.text }]}>{theme.name}</Text>
      <Text style={[styles.swatchSub, { color: s.text, opacity: 0.6 }]} numberOfLines={1}>{theme.sub}</Text>
      {active && <View style={styles.swatchCheck}><Icon name="check" size={12} color="#1A1206" /></View>}
    </Pressable>
  );
}

export default function SettingsScreen({ onClose, onEditProfile, onOpenProfile, onOpenPrivacy, onOpenTerms, onOpenDiagnostics, onOpenDeleteAccount, onLogout }) {
  const { session, chooseTheme, blockedUsers, unblockUser, exportMyData, updateProfile } = useStore();
  const blocked = session ? blockedUsers() : [];
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const [savingAnalytics, setSavingAnalytics] = useState(false);
  const [analyticsResult, setAnalyticsResult] = useState(null);
  const doExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportResult(null);
    const result = await exportMyData();
    setExportResult(result);
    setExporting(false);
  };
  const toggleAnalytics = async () => {
    if (!session || savingAnalytics) return;
    setSavingAnalytics(true);
    setAnalyticsResult(null);
    const optingOut = !session.analyticsOptOut;
    const result = await updateProfile({ analyticsOptOut: optingOut });
    setAnalyticsResult(result?.ok
      ? (optingOut ? "Product analytics are off and your prior product events were deleted." : "Product analytics are on for this account.")
      : "That preference did not save. Please try again.");
    setSavingAnalytics(false);
  };

  return (
    <View style={styles.wrap}>
      <SheetHeader title="Settings" onClose={onClose} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.section}>APPEARANCE</Text>
        <Text style={styles.hint}>{session ? "Pick a theme. It's saved to your account and follows you to any device." : "Pick a theme. It applies across the whole app."}</Text>
        <View style={styles.swatchGrid}>
          {THEMES.map((t) => (
            <Swatch key={t.key} theme={t} active={t.key === themeKey} onPress={() => t.key !== themeKey && chooseTheme(t.key)} />
          ))}
        </View>

        {session && (
          <>
            <Text style={styles.section}>ACCOUNT</Text>
            <Row icon="you" label="Go to profile" sub={`@${session.handle}`} onPress={onOpenProfile} />
            <Row icon="edit" label="Edit profile" sub="Photo, bio, music, banner" onPress={onEditProfile} />
          </>
        )}

        {session && (
          <>
            <Text style={styles.section}>PRIVACY & SAFETY</Text>
            <Row
              icon="activity"
              label="Product analytics"
              sub={session.analyticsOptOut
                ? "Off. Pit will not record product-usage events for this account."
                : "On. Helps improve Pit using a limited set of account activity events."}
              onPress={toggleAnalytics}
              disabled={savingAnalytics}
              accessibilityRole="switch"
              right={<Toggle value={!session.analyticsOptOut} busy={savingAnalytics} />}
            />
            {!!analyticsResult && (
              <Text style={[styles.exportStatus, analyticsResult.startsWith("That preference") && styles.exportError]} accessibilityRole="alert">
                {analyticsResult}
              </Text>
            )}
            <Row
              icon="share"
              label={exporting ? "Preparing your backup..." : "Download your data"}
              sub="A portable backup of your profile, reviews, playlists, and activity (JSON)"
              onPress={exporting ? undefined : doExport}
            />
            {exportResult && (
              <Text style={[styles.exportStatus, !exportResult.ok && styles.exportError]} accessibilityRole="alert">
                {exportResult.ok ? "Your Pit data file is ready." : exportResult.error}
              </Text>
            )}
            <Text style={[styles.hint, { marginTop: 6 }]}>BLOCKED ACCOUNTS{blocked.length ? ` · ${blocked.length}` : ""}</Text>
            {blocked.length === 0 && <Text style={styles.blockedEmpty}>No one blocked. Block someone from their profile and they can't message you, follow you, or see your posts.</Text>}
            {blocked.map((u) => (
              <View key={u.id} style={styles.blockedRow}>
                <Avatar user={u} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel} numberOfLines={1}>{u.name}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>@{u.handle}</Text>
                </View>
                <Pressable style={styles.unblockBtn} onPress={() => unblockUser(u.id)}>
                  <Text style={styles.unblockTxt}>Unblock</Text>
                </Pressable>
              </View>
            ))}
          </>
        )}

        <Text style={styles.section}>ABOUT</Text>
        <Row icon="discover" label="Diagnostics" sub="Recent errors, request references, and failure points" onPress={onOpenDiagnostics} />
        <Row icon="lock" label="Privacy policy" onPress={onOpenPrivacy} />
        <Row icon="shield" label="Terms & conditions" onPress={onOpenTerms} />
        <Row icon="globe" label="Version" sub="Pit · prototype build" onPress={undefined} right={<Text style={styles.ver}>0.1</Text>} />

        {session && (
          <>
            <View style={{ height: 12 }} />
            <Row icon="logout" label="Log out" danger onPress={onLogout} />
            <Text style={styles.section}>DANGER ZONE</Text>
            <Row icon="trash" label="Delete account" sub="Permanently remove your account and activity" danger onPress={onOpenDeleteAccount} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 48 },
  section: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginTop: space(6), marginBottom: space(2) },
  hint: { color: colors.textDim, fontSize: 13, marginBottom: 12 },
  swatchGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  swatch: { width: "47.5%", borderWidth: 2, borderRadius: radius.md, padding: 14, minHeight: 96 },
  swatchDots: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  chip: { width: 18, height: 18, borderRadius: 9 },
  bar: { flex: 1, height: 10, borderRadius: 5, borderWidth: 1 },
  swatchName: { fontSize: 15, fontWeight: "800" },
  swatchSub: { fontSize: 11, marginTop: 2 },
  swatchCheck: { position: "absolute", top: 10, right: 10, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.amber, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 8 },
  rowDisabled: { opacity: 0.62 },
  rowIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: "700" },
  rowSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  ver: { color: colors.textFaint, fontFamily: mono, fontSize: 13 },
  blockedRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginBottom: 8 },
  blockedEmpty: { color: colors.textFaint, fontSize: 12.5, lineHeight: 18, marginBottom: 8 },
  exportStatus: { color: colors.good, fontSize: 12.5, lineHeight: 18, marginTop: -1, marginBottom: 10, paddingHorizontal: 4 },
  exportError: { color: colors.danger },
  unblockBtn: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.danger, paddingHorizontal: 14, paddingVertical: 7 },
  unblockTxt: { color: colors.danger, fontSize: 12.5, fontWeight: "800" },
  toggle: { width: 48, height: 28, borderRadius: 14, padding: 3, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, justifyContent: "center" },
  toggleOn: { backgroundColor: colors.amberStrong, borderColor: colors.amberStrong },
  toggleBusy: { opacity: 0.65 },
  toggleKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.textDim },
  toggleKnobOn: { alignSelf: "flex-end", backgroundColor: colors.bg },
});
