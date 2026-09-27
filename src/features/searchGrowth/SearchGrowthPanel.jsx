import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import Button from "../../components/Button";
import { colors, mono, radius } from "../../theme";
import useSearchGrowth from "./useSearchGrowth";
import { growthConnectionLabel, growthModeLabel, growthNumber, growthPercent, growthTime, growthWindow, visibleGrowthOpportunities } from "./searchGrowthState.mjs";

const modes = [
  { mode: "paused", title: "Pause", detail: "No new scheduled checks or priorities." },
  { mode: "monitor", title: "Monitor only", detail: "Read Google data without changing catalogue priorities." },
  { mode: "prioritize", title: "Prioritize pages", detail: "Send a small, bounded set of eligible pages to existing catalogue upkeep." },
];
const lastErrorMessage = code => ({
  configuration: "Google configuration needs attention.",
  invalid_window: "The reporting dates could not be confirmed.",
  oauth_unavailable: "Google access could not be reached. A later scheduled check can retry.",
  oauth_rejected: "Google rejected access. Check the server connection setup.",
  oauth_invalid_response: "Google access returned an unusable response.",
  query_unavailable: "Search performance data could not be reached.",
  query_rejected: "Google rejected the search performance request.",
  query_invalid_response: "Google returned an unusable search report.",
  response_too_large: "The search report exceeded the safety limit.",
  request_timeout: "The Google request timed out.",
  request_aborted: "The latest request was interrupted.",
})[code] || "The latest scheduled check needs attention. A successful refresh here does not mean the Google check succeeded.";
const reasonLabel = reason => ({
  ctr_opportunity: "Search impressions with room to improve click-through",
  content_visibility: "Page content and search visibility worth reviewing",
  low_ctr: "Low click-through rate",
  near_first_page: "Near first-page visibility",
  ctr_decline: "Click-through rate below the previous window",
  high_impressions: "Search visibility worth reviewing",
})[reason] || "Page selected for review";

function Section({ title, children }) {
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>{children}</View>;
}
function Metric({ label, current, previous }) {
  return <View style={styles.metric}><Text style={styles.label}>{label}</Text><Text selectable style={styles.value}>{current}</Text><Text selectable style={styles.hint}>Previous: {previous}</Text></View>;
}

export default function SearchGrowthPanel({ accountId, role, emailVerified, active = true, refreshRegistry }) {
  const state = useSearchGrowth({ accountId, role, emailVerified, active, refreshRegistry });
  if (!state.available) return null;
  const data = state.resource.data;
  const loading = ["loading", "refreshing"].includes(state.resource.status);
  const blocked = !active || !state.confirmed || loading || !!state.pendingMode;
  const opportunities = visibleGrowthOpportunities(data);
  return <View style={styles.panel} testID="search-growth-panel">
    <View style={styles.heading}>
      <View style={styles.headingCopy}>
        <Text style={styles.eyebrow}>SEARCH GROWTH</Text>
        <Text accessibilityRole="header" style={styles.title}>Google visibility and page priorities</Text>
        <Text style={styles.copy}>Compare search performance, find pages worth improving, and control the scheduled worker. These figures do not prove that a change caused more traffic or signups.</Text>
      </View>
      <Button small title="Refresh Search Growth" variant="secondary" disabled={!active || loading || !!state.pendingMode} loading={loading} onPress={state.refresh} />
    </View>
    {state.errorMessage ? <Text selectable accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{state.errorMessage}</Text> : null}
    {state.notice ? <Text selectable accessibilityLiveRegion="polite" style={styles.notice}>{state.notice}</Text> : null}
    {!data ? <View style={styles.loading}>
      {!state.errorMessage && active ? <ActivityIndicator color={colors.amber} accessibilityLabel="Loading Search Growth" /> : null}
      <Text selectable style={styles.copy}>{state.errorMessage ? "Search Growth status is unavailable. Use Refresh to try again." : active ? "Loading Search Growth…" : "Status checks resume when this tab is active."}</Text>
    </View> : <>
      <Section title="Connection and schedule">
        <Text selectable style={styles.value}>{growthConnectionLabel(data)}</Text>
        {data.connection?.property ? <Text selectable style={styles.path}>{String(data.connection.property).slice(0, 300)}</Text> : null}
        {!data.configured ? <Text selectable style={styles.notice}>Google access not configured. Setup instructions: docs/search-growth-automation.md. Credentials belong in the server configuration, never in this panel.</Text> : null}
        {!data.enabled ? <Text selectable style={styles.hint}>The server worker is disabled. A saved mode alone does not enable it.</Text> : null}
        <Text selectable style={styles.copy}>Saved mode: {growthModeLabel(data.mode)} · {data.running ? "A scheduled check is running." : "No check is running."}</Text>
        <Text selectable style={styles.hint}>Last successful Google check: {growthTime(data.lastSuccessAt)}</Text>
        <Text selectable style={styles.hint}>Next scheduled check: {!data.enabled ? "Worker disabled" : !data.configured ? "Waiting for Google setup" : data.mode === "paused" ? "Paused" : growthTime(data.nextRunAt)}</Text>
        {data.lastErrorCode ? <Text selectable style={styles.error}>{lastErrorMessage(data.lastErrorCode)}</Text> : null}
        <View style={styles.modeRow}>
          {modes.map(option => <View key={option.mode} style={styles.modeOption}>
            <Button small title={data.mode === option.mode ? growthModeLabel(option.mode) + " (saved)" : option.title}
              variant={data.mode === option.mode ? "primary" : "secondary"}
              disabled={blocked || data.mode === option.mode || (option.mode !== "paused" && (!data.enabled || !data.configured))}
              loading={state.pendingMode === option.mode} onPress={() => state.setMode(option.mode)}
              accessibilityLabel={option.title + " Search Growth"} accessibilityHint={option.detail} />
            <Text style={styles.hint}>{option.detail}</Text>
          </View>)}
        </View>
        <Text selectable style={styles.hint}>Saving a mode does not start a run, bypass budgets, or publish changes to page titles.</Text>
      </Section>
      <Section title="Search performance">
        <Text selectable style={styles.copy}>Current window: {growthWindow(data.window)}</Text>
        <Text selectable style={styles.hint}>Previous window: {growthWindow(data.previousWindow)}</Text>
        <View style={styles.grid}>
          <Metric label="Clicks" current={growthNumber(data.totals.current?.clicks)} previous={growthNumber(data.totals.previous?.clicks)} />
          <Metric label="Impressions" current={growthNumber(data.totals.current?.impressions)} previous={growthNumber(data.totals.previous?.impressions)} />
          <Metric label="Click-through rate" current={growthPercent(data.totals.current?.ctr)} previous={growthPercent(data.totals.previous?.ctr)} />
          <Metric label="Average position" current={growthNumber(data.totals.current?.position, 2)} previous={growthNumber(data.totals.previous?.position, 2)} />
        </View>
        <Text selectable style={styles.hint}>CTR is clicks divided by impressions. Average position is not a fixed rank. Google reporting is delayed, and these windows can have different search audiences.</Text>
        {data.truncated ? <Text selectable accessibilityRole="alert" style={styles.notice}>Partial report: the page-row limit was reached. These figures and priorities may not represent all search traffic.</Text> : null}
        {!data.lastSuccessAt ? <Text selectable style={styles.hint}>No successful Google report is recorded yet. Missing measurements are not zero traffic.</Text> : null}
      </Section>
      <Section title="Pages worth reviewing">
        {!opportunities.length ? <Text selectable style={styles.copy}>{!data.lastSuccessAt ? "Page opportunities will appear after a successful scheduled Google check." : "No eligible page opportunities were found in the latest saved report."}</Text> : <>
          <Text style={styles.hint}>Top {opportunities.length} saved opportunities. Scores prioritize review; they are not predicted extra clicks.</Text>
          {opportunities.map((row, index) => <View key={row.path + ":" + index} style={styles.opportunity}>
            <Text selectable style={styles.path}>{row.path}</Text>
            <Text selectable style={styles.copy}>{growthNumber(row.clicks)} clicks · {growthNumber(row.impressions)} impressions · {growthPercent(row.ctr)} CTR</Text>
            <Text selectable style={styles.hint}>Average position {growthNumber(row.position, 2)} · Previous CTR {growthPercent(row.previousCtr)}</Text>
            <Text selectable style={styles.hint}>{reasonLabel(row.reason)} · Priority score {growthNumber(row.score, 2)}</Text>
          </View>)}
        </>}
      </Section>
      <Section title="Limits and recent checks">
        <Text selectable style={styles.copy}>Up to {growthNumber(data.limits.maxPages)} page rows per report; at most {growthNumber(data.limits.maxPrioritiesPerDay)} page priorities per day; {growthNumber(data.limits.retentionDays)} days of history.</Text>
        <Text style={styles.hint}>Page priorities use existing catalogue workers and their safety limits. They are not additional servers or unlimited AI jobs.</Text>
        {(data.history || []).slice(0, 5).map((entry, index) => <Text selectable key={String(entry.at) + ":" + index} style={styles.hint}>
          {growthTime(entry.at)} · {({ success: "Completed", succeeded: "Completed", failed: "Needs attention", skipped: "Skipped" })[entry.outcome] || "Check recorded"} · {growthNumber(entry.opportunities)} opportunities
        </Text>)}
        {!data.history.length ? <Text selectable style={styles.hint}>No scheduled checks recorded yet.</Text> : null}
      </Section>
      <Section title="Visitor-to-member measurement">
        <Text selectable style={styles.copy}>Signup conversion measurement is not connected to this report yet. No conversion rate or signup uplift is being claimed.</Text>
        <Text style={styles.hint}>Google clicks are not member signups. Any future conversion measurement must respect the site's analytics choices and avoid storing search text or private member content here.</Text>
      </Section>
    </>}
  </View>;
}
const styles = StyleSheet.create({
  panel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 16, gap: 16, marginBottom: 18 },
  heading: { flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "flex-start" },
  headingCopy: { flex: 1, minWidth: 200, gap: 6 },
  eyebrow: { fontFamily: mono, fontSize: 10, color: colors.amber, letterSpacing: 1.4, fontWeight: "700" },
  title: { color: colors.text, fontSize: 20, fontWeight: "800" },
  copy: { color: colors.textDim, fontSize: 13, lineHeight: 20 },
  hint: { color: colors.textDim, fontSize: 11, lineHeight: 17 },
  section: { borderTopWidth: 1, borderColor: colors.line, paddingTop: 14, gap: 9 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  metric: { minWidth: 126, flexGrow: 1, flexBasis: 126, gap: 4 },
  label: { color: colors.textDim, fontSize: 11 },
  value: { color: colors.text, fontSize: 18, fontWeight: "700", fontVariant: ["tabular-nums"] },
  path: { fontFamily: mono, color: colors.text, fontSize: 12, lineHeight: 19, flexShrink: 1 },
  modeRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  modeOption: { flexGrow: 1, flexBasis: 190, minWidth: 160, gap: 7 },
  opportunity: { borderTopWidth: 1, borderColor: colors.line, paddingTop: 10, gap: 5 },
  loading: { flexDirection: "row", gap: 10, alignItems: "center" },
  error: { color: colors.danger, fontSize: 13, lineHeight: 20 },
  notice: { color: colors.amber, fontSize: 13, lineHeight: 20 },
});
