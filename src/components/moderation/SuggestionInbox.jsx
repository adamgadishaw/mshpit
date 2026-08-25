import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  SUGGESTION_CATEGORIES,
  SUGGESTION_STATUSES,
  normalizeSuggestionCategory,
  normalizeSuggestionStatus,
} from "../../domain/suggestionBox.mjs";
import { colors, focusRing, mono, radius, space } from "../../theme";
import Button from "../Button";
import Icon from "../Icon";

const CATEGORY_LABELS = Object.fromEntries(SUGGESTION_CATEGORIES.map((category) => [category.key, category.shortLabel]));
const STATUS_LABELS = { new: "New", considering: "Considering", planned: "Planned", shipped: "Shipped", closed: "Closed" };

function FilterChip({ label, selected, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed, focused }) => [styles.filter, selected && styles.filterOn, pressed && styles.pressed, focused && focusRing]}
    >
      <Text style={[styles.filterText, selected && styles.filterTextOn]}>{label}</Text>
    </Pressable>
  );
}

function SuggestionRow({ item, busy, onChangeStatus }) {
  const status = normalizeSuggestionStatus(item?.status) || "new";
  const category = normalizeSuggestionCategory(item?.category) || "other";
  const created = Number(item?.createdAt || item?.created_at);
  const date = Number.isFinite(created) && created > 0 ? new Date(created).toLocaleString() : "Unknown time";
  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <View style={styles.tags}>
          <Text style={styles.categoryTag}>{CATEGORY_LABELS[category] || "Other"}</Text>
          <Text style={styles.statusTag}>{STATUS_LABELS[status]}</Text>
          {item?.surface ? <Text style={styles.surfaceTag}>{String(item.surface).toUpperCase()}</Text> : null}
        </View>
        <Text selectable style={styles.date}>{date}</Text>
      </View>
      <Text selectable style={styles.body}>{typeof item?.body === "string" ? item.body : ""}</Text>
      <View style={styles.actions} accessibilityLabel="Suggestion status actions">
        {SUGGESTION_STATUSES.filter((next) => next !== status).map((next) => (
          <Pressable
            key={next}
            onPress={() => onChangeStatus?.(item.id, next)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Mark suggestion ${STATUS_LABELS[next].toLowerCase()}`}
            accessibilityState={{ disabled: busy }}
            style={({ pressed, focused }) => [styles.action, pressed && !busy && styles.pressed, focused && focusRing, busy && styles.disabled]}
          >
            <Text style={styles.actionText}>{STATUS_LABELS[next]}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function SuggestionInbox({
  suggestions = [],
  loading = false,
  error = "",
  busyId = null,
  hasMore = false,
  loadingMore = false,
  onRefresh,
  onLoadMore,
  onChangeStatus,
}) {
  const [status, setStatus] = useState("new");
  const [category, setCategory] = useState("all");
  const rows = useMemo(() => (Array.isArray(suggestions) ? suggestions : []).filter((item) => {
    const itemStatus = normalizeSuggestionStatus(item?.status) || "new";
    const itemCategory = normalizeSuggestionCategory(item?.category) || "other";
    return (status === "all" || itemStatus === status) && (category === "all" || itemCategory === category);
  }), [suggestions, status, category]);

  return (
    <View style={styles.wrap}>
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text accessibilityRole="header" style={styles.title}>Product suggestions</Text>
          <Text selectable style={styles.detail}>Anonymous notes from members and signed-out visitors. No account or request metadata is attached; submitters are asked not to include contact details in the note.</Text>
        </View>
        {onRefresh ? <Button title="Refresh" variant="secondary" small loading={loading} onPress={onRefresh} /> : null}
      </View>

      <Text style={styles.filterLabel}>STATUS</Text>
      <View style={styles.filters}>
        {["all", ...SUGGESTION_STATUSES].map((value) => <FilterChip key={value} label={value === "all" ? "All" : STATUS_LABELS[value]} selected={status === value} onPress={() => setStatus(value)} />)}
      </View>
      <Text style={styles.filterLabel}>CATEGORY</Text>
      <View style={styles.filters}>
        <FilterChip label="All" selected={category === "all"} onPress={() => setCategory("all")} />
        {SUGGESTION_CATEGORIES.map((value) => <FilterChip key={value.key} label={value.shortLabel} selected={category === value.key} onPress={() => setCategory(value.key)} />)}
      </View>

      {!!error && (
        <View style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          <Icon name="x" size={15} color={colors.danger} />
          <Text selectable style={styles.errorText}>{error}</Text>
        </View>
      )}
      {loading && !suggestions.length ? <Text style={styles.empty} accessibilityLiveRegion="polite">Loading suggestions...</Text> : null}
      {!loading && !rows.length ? <Text style={styles.empty}>No suggestions match these filters.</Text> : null}
      {rows.map((item) => <SuggestionRow key={item.id} item={item} busy={busyId === item.id} onChangeStatus={onChangeStatus} />)}
      {hasMore ? <Button title={loadingMore ? "Loading older suggestions..." : "Load older suggestions"} variant="secondary" loading={loadingMore} onPress={onLoadMore} style={styles.loadMore} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space(3) },
  heading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space(3) },
  headingCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 20, lineHeight: 26, fontWeight: "900" },
  detail: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, paddingTop: 3 },
  filterLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 9.5, letterSpacing: 1.2, fontWeight: "900", paddingTop: space(1) },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: space(1.5) },
  filter: { minHeight: 38, justifyContent: "center", paddingHorizontal: space(2.5), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  filterOn: { borderColor: colors.amber, backgroundColor: colors.amberStrong },
  filterText: { color: colors.textDim, fontSize: 11.5, fontWeight: "800" },
  filterTextOn: { color: "#1A1206" },
  row: { gap: space(2.5), padding: space(3.5), borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  rowHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: space(2) },
  tags: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space(1.5) },
  categoryTag: { color: colors.amber, fontFamily: mono, fontSize: 9.5, fontWeight: "900", letterSpacing: 0.7 },
  statusTag: { color: colors.good, fontFamily: mono, fontSize: 9.5, fontWeight: "900", letterSpacing: 0.7 },
  surfaceTag: { color: colors.cool, fontFamily: mono, fontSize: 9.5, fontWeight: "900", letterSpacing: 0.7 },
  date: { color: colors.textFaint, fontFamily: mono, fontSize: 9.5 },
  body: { color: colors.text, fontSize: 13.5, lineHeight: 20 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space(1.5) },
  action: { minHeight: 40, justifyContent: "center", paddingHorizontal: space(2.5), borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev },
  actionText: { color: colors.textDim, fontSize: 11, fontWeight: "800" },
  error: { flexDirection: "row", alignItems: "flex-start", gap: space(2), padding: space(3), borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, backgroundColor: `${colors.danger}0D` },
  errorText: { flex: 1, color: colors.danger, fontSize: 12.5, lineHeight: 18, fontWeight: "700" },
  empty: { color: colors.textDim, fontSize: 13, lineHeight: 19, paddingVertical: space(5), textAlign: "center" },
  loadMore: { marginTop: space(1) },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.5 },
});
