import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import Button from "../../components/Button";
import { colors, mono, radius } from "../../theme";
import useCatalogMaintenance from "./useCatalogMaintenance";
import { catalogBytes, catalogCount, catalogModeLabel, catalogTime, catalogSourceSchedulerLabel } from "./catalogMaintenanceState.mjs";

function Datum({ label, value, detail }) {
  return <View style={styles.datum}>
    <Text style={styles.label}>{label}</Text>
    <Text selectable style={styles.value}>{value}</Text>
    {detail ? <Text selectable style={styles.hint}>{detail}</Text> : null}
  </View>;
}
function Section({ title, children }) {
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>{children}
  </View>;
}

export default function CatalogMaintenancePanel({ accountId, role, active = true, refreshRegistry }) {
  const state = useCatalogMaintenance({ accountId, role, active, refreshRegistry });
  const data = state.data;
  const catalog = data?.catalog;
  const knowledge = data?.artistKnowledge;
  const pass = knowledge?.lastPass;
  const limits = catalog?.limits || {};
  const progress = catalog?.progress || {};
  const storage = data?.storage;
  const blocked = !state.confirmed || !catalog || !active || !!state.pendingMode || knowledge?.enabled === false;
  const mode = catalog?.mode;
  if (!state.available) return null;
  return <View style={styles.panel} testID="catalog-maintenance-panel">
    <View style={styles.heading}>
      <View style={styles.headingCopy}>
        <Text style={styles.eyebrow}>CATALOG UPKEEP</Text>
        <Text accessibilityRole="header" style={styles.title}>Fill the gaps. Keep the facts.</Text>
        <Text style={styles.copy}>Automatic artist biography and country gap filling. These controls do not run venue or event page enrichment. Staff edits stay protected; no unsourced copy is generated.</Text>
      </View>
      <Button small title="Refresh upkeep status" accessibilityLabel="Refresh catalog upkeep status" variant="secondary"
        disabled={!active || state.loading || !!state.pendingMode} loading={state.loading}
        onPress={state.refresh} />
    </View>
    {state.error ? <Text selectable accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{state.error}</Text> : null}
    {state.notice ? <Text selectable accessibilityLiveRegion="polite" style={styles.notice}>{state.notice}</Text> : null}
    {!data ? <View style={styles.loading}>
      {!state.error && active ? <ActivityIndicator color={colors.amber} accessibilityLabel="Loading catalog upkeep" /> : null}
      <Text style={styles.copy}>{state.error ? "Live upkeep status is unavailable." : active ? "Loading catalog upkeep…" : "Status checks resume when this tab is active."}</Text>
    </View> : <>
      {!catalog ? <Text selectable style={styles.error}>The upkeep controller is not initialized. No controls are enabled; server setup needs to finish first.</Text> : <>
        <View style={styles.modeRow}>
          <View style={styles.modeCopy}>
            <Text style={styles.label}>SAVED MODE</Text>
            <Text selectable style={styles.mode}>{catalogModeLabel(mode)}</Text>
            <Text selectable style={styles.copy}>
              {mode === "catch_up" ? "Bounded parallel checks for the initial eligible artist sweep. When that sweep finishes, the scheduler steps down to one maintenance lane."
                : mode === "maintenance" ? "One lane revisits due artist records at the maintenance pace."
                  : "No new checks start while paused. Previously saved improvements remain."}
            </Text>
          </View>
          <View style={styles.modeActions}>
            {mode !== "catch_up" ? <Button small title="Start catch-up" accessibilityLabel="Start catalog catch-up"
              disabled={blocked} loading={state.pendingMode === "catch_up"} onPress={() => state.setMode("catch_up")} /> : null}
            {mode !== "maintenance" ? <Button small title="Use maintenance" accessibilityLabel="Use catalog maintenance mode" variant="secondary"
              disabled={blocked} loading={state.pendingMode === "maintenance"} onPress={() => state.setMode("maintenance")} /> : null}
            {mode !== "paused" ? <Button small title="Pause upkeep" accessibilityLabel="Pause catalog upkeep" variant="secondary"
              disabled={blocked} loading={state.pendingMode === "paused"} onPress={() => state.setMode("paused")} /> : null}
          </View>
        </View>
        {knowledge?.enabled === false ? <Text selectable style={styles.error}>The server scheduler is disabled. A saved mode alone does not start work; the server enablement needs attention.</Text> : null}
        <Text selectable style={styles.hint}>Mode changes do not bypass provider cooldowns, daily allowances, memory checks, disk safeguards, or the next due time.</Text>
        <Section title="Artist coverage">
          <View style={styles.grid}>
            <Datum label="Catalog artists" value={catalogCount(progress.totalArtists)} />
            <Datum label="Tracked checks" value={catalogCount(progress.totalTracked ?? knowledge?.ledger?.tracked)} detail="Latest recorded result per artist, not number of provider requests." />
            <Datum label="Eligible gaps remaining" value={catalogCount(progress.eligible)} detail="Missing biography or country; exact source identity available." />
            <Datum label="Awaiting first check" value={catalogCount(progress.unprocessed)} />
            <Datum label="Needs identity review" value={catalogCount(progress.needsIdentity)} detail="Not guessed from a matching name." />
            <Datum label="Fields present / protected" value={catalogCount(progress.alreadyComplete)} detail="Not a claim that the whole page is complete." />
            <Datum label="Checked, unresolved" value={catalogCount(progress.unresolved)} />
            <Datum label="Waiting to retry" value={catalogCount(progress.retrying)} />
            <Datum label="Latest-result fills" value={catalogCount(progress.filled ?? knowledge?.ledger?.filled)} detail="Artist records whose latest result filled a field; not every completed page." />
          </View>
          {progress.fieldCoverage ? <Text selectable style={styles.hint}>Biographies: {catalogCount(progress.fieldCoverage.biographyPresent)} present, {catalogCount(progress.fieldCoverage.biographyMissing)} missing, {catalogCount(progress.fieldCoverage.biographyProtected)} protected by an existing artist profile. Countries: {catalogCount(progress.fieldCoverage.countryPresent)} present, {catalogCount(progress.fieldCoverage.countryMissing)} missing.</Text> : null}
          <Text selectable style={styles.hint}>Initial eligible sweep finished: {catalogTime(catalog.initialSweepFinishedAt)}. Unmatched or identity-missing records can still need review afterward.</Text>
        </Section>
        <Section title="Work and provider limits">
          <View style={styles.grid}>
            <Datum label="Configured lanes" value={catalogCount(limits.lanes)} detail="Parallel tasks in the existing service, not extra billed servers." />
            <Datum label="Pass allowance" value={`${catalogCount(limits.maxArtistsPerPass)} artists / ${catalogCount(limits.intervalMinutes)} min`} detail={`Maximum pass duration: ${catalogCount(limits.maxPassSeconds)} seconds.`} />
            <Datum label="Today's artist attempts" value={`${catalogCount(catalog.budget?.attempts)} / ${catalogCount(limits.maxAttemptsPerDay)}`} detail={`UTC day: ${catalog.budget?.utcDay || "Unavailable"}`} />
            <Datum label="Today's provider requests" value={`${catalogCount(catalog.budget?.requests)} / ${catalogCount(limits.maxRequestsPerDay)}`} detail={`Shared request spacing: ${catalogCount(limits.providerSpacingMs)} ms.`} />
          </View>
          <Text selectable style={styles.copy}>Worker evidence: {knowledge?.state?.replaceAll("_", " ") || "Unavailable"}.</Text>
          <Text selectable style={styles.hint}>Last pass: {catalogTime(pass?.at)} · Next due: {catalogTime(catalog.nextPassAt)} · Provider cooldown until: {catalogTime(knowledge?.cooldownUntil)}</Text>
          {pass ? <Text selectable style={styles.hint}>Last pass checked {catalogCount(pass.checked)}; filled {catalogCount(pass.filled)} artist records: {catalogCount(pass.bios)} biographies and {catalogCount(pass.countries)} countries. Unmatched {catalogCount(pass.unmatched)}; provider failures {catalogCount(pass.failed)}; interrupted checks {catalogCount(pass.deferred)}. This is a pass summary, not a lifetime total.</Text> : null}
          {pass?.prioritized != null ? <Text selectable style={styles.hint}>Discover priority: {catalogCount(pass.prioritized)} of the last pass's checks were for artists recently shown in Discover. Regular catalogue work continues within the same allowance.</Text> : null}
          {pass?.stoppedEarly ? <Text selectable style={styles.hint}>The batch yielded before all checks finished. Interrupted work stays queued; this does not mean the catalogue is complete.</Text> : null}
        </Section>
      </>}
      <Section title="Storage safeguards">
        <View style={styles.grid}>
          <Datum label="Database" value={catalogBytes(storage?.databaseBytes)} />
          <Datum label="Write-ahead log" value={catalogBytes(storage?.walBytes)} />
          <Datum label="Disk free" value={catalogBytes(storage?.freeBytes)} />
          <Datum label="Backup headroom estimate" value={catalogBytes(storage?.snapshotHeadroomBytes)} />
        </View>
        <Text selectable style={styles.copy}>Storage: {storage?.status?.replaceAll("_", " ") || "Unavailable"} · measured {catalogTime(storage?.checkedAt)}.</Text>
        {catalog ? <Text selectable style={styles.hint}>Catch-up database growth guard: {catalogCount(limits.maxGrowthMiB)} MiB above the saved baseline. Provider response ceiling: {catalogCount(limits.maxResponseKiB)} KiB; biography ceiling: {catalogCount(limits.maxBiographyCharacters)} characters. No raw page or image archive is retained by this worker.</Text> : null}
        {[...(storage?.issues || []), ...(storage?.warnings || [])].length ? <Text selectable style={styles.error}>{[...(storage?.issues || []), ...(storage?.warnings || [])].join(" · ").replaceAll("_", " ")}</Text> : null}
      </Section>
      <Section title="Sources and Google readiness">
        {["artist", "venues", "events"].map(key => <Text selectable key={key} style={styles.copy}>
          {key === "artist" ? "Artists" : key === "venues" ? "Venues" : "Events"}: {data.sources?.[key]?.name || "Source status unavailable."}{data.sources?.[key]?.scope ? ` — ${data.sources[key].scope}` : ""}
        </Text>)}
        <Text selectable style={styles.copy}>Show-date scheduler: {catalogSourceSchedulerLabel(data.sourceRefresh)}. Separate from artist upkeep controls.</Text>
        <Text selectable style={data.sourceRefresh?.state === "failed" ? styles.error : styles.copy}>Show-date refresh (not venue page enrichment): saved result {data.sourceRefresh?.state || "Unverified"} at {catalogTime(data.sourceRefresh?.at)}. Last success: {catalogTime(data.sourceRefresh?.lastSuccessAt)}. Historical evidence, not a live running indicator.</Text>
        {data.sourceRefresh?.state === "failed" ? <Text selectable style={styles.hint}>Latest attempt: {catalogTime(data.sourceRefresh.at)} · stage: {data.sourceRefresh.stage || "Unavailable"} · category: {data.sourceRefresh.category || "Unavailable"}. Saved public data remains separate from this failed refresh.</Text> : null}
        <View style={styles.grid}>
          <Datum label="Sitemap evidence" value={data.seo?.state || "Unavailable"} detail={`Built: ${catalogTime(data.seo?.lastBuiltAt)}`} />
          <Datum label="URLs in sitemap snapshot" value={catalogCount(data.seo?.totalUrls)} />
          <Datum label="Next scheduled rebuild" value={`${catalogCount(data.seo?.nextRefreshMinutes)} min`} detail={data.seo?.retryAt ? `Retry after: ${catalogTime(data.seo.retryAt)}` : "Saved content changes are reflected on the next successful rebuild."} />
        </View>
        <Text selectable style={styles.hint}>Sitemap URL: {data.seo?.sitemapUrl || "Unavailable"}</Text>
        <Text selectable style={styles.hint}>Google indexing: not measured here. Verified improvements can strengthen public pages; actual crawl and indexing results must be checked separately in Search Console.</Text>
        <Text selectable style={styles.hint}>Saving more records does not guarantee indexing. This panel does not claim to submit every page to Google or verify Search Console.</Text>
      </Section>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 18, gap: 16, marginBottom: 20 },
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 14 },
  headingCopy: { flexGrow: 1, flexShrink: 1, flexBasis: 420, minWidth: 0, gap: 7 },
  eyebrow: { fontFamily: mono, color: colors.amber, fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
  title: { color: colors.text, fontSize: 24, lineHeight: 30, fontWeight: "800" },
  copy: { color: colors.textDim, fontSize: 13, lineHeight: 20, flexShrink: 1 },
  hint: { color: colors.textDim, fontSize: 12, lineHeight: 18, flexShrink: 1 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 20 },
  notice: { color: colors.good, fontSize: 13, lineHeight: 20 },
  loading: { gap: 12, alignItems: "flex-start", paddingVertical: 14 },
  modeRow: { flexDirection: "row", flexWrap: "wrap", gap: 16, alignItems: "center" },
  modeCopy: { flexGrow: 1, flexShrink: 1, flexBasis: 380, minWidth: 0, gap: 5 },
  mode: { color: colors.amber, fontSize: 23, fontWeight: "800" },
  modeActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  section: { borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: 16, gap: 10 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  datum: { flexGrow: 1, flexBasis: 160, gap: 4, paddingVertical: 7, minWidth: 0 },
  label: { color: colors.textDim, fontSize: 11, lineHeight: 16, fontWeight: "700" },
  value: { color: colors.text, fontSize: 17, lineHeight: 24, fontWeight: "700", fontVariant: ["tabular-nums"] },
});
