import { useEffect, useState } from "react";
import { ActivityIndicator, View, Text, TextInput, Pressable } from "react-native";
import { colors, radius } from "../../theme";
import DatePicker from "../../components/DatePicker";
import Button from "../../components/Button";
import { creatorUpdateError, CREATOR_UPDATE_KINDS } from "../../domain/creatorUpdate.mjs";
import { createLoadState, projectLoadState, resolveLoadState, rejectLoadState, isLoadCancellation } from "../../domain/loadState.mjs";
import { toAppError } from "../../lib/diagnostics";
import { fetchManagedCreatorEntities } from "./creatorPostsApi.mjs";

// Uses the existing shared form and date controls, so the same composer works
// on web and native without another picker/upload implementation or package.
export default function CreatorUpdateFields({ value, accountId, onChange, onAuthorization, disabled = false, readOnly = false }) {
  const scope = `${accountId || "guest"}:creator-entities`;
  const [resource, setResource] = useState(() => createLoadState({ scope, status: "loading" }));
  const [attempt, setAttempt] = useState(0);
  const current = projectLoadState(resource, scope);
  const entity = current.data?.find(row => row.entityType === value.entityType && row.entityKey === value.entityKey);
  useEffect(() => {
    const controller = new AbortController();
    setResource(createLoadState({ scope, status: "loading" }));
    if (accountId) fetchManagedCreatorEntities({ accountId, signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setResource(resolveLoadState({ scope, data }));
    }).catch(error => {
      if (!isLoadCancellation(error, controller.signal)) setResource(previous => rejectLoadState(previous, { scope, error: toAppError(error), retainData: false }));
    });
    return () => controller.abort();
  }, [scope, accountId, attempt]);
  useEffect(() => { onAuthorization?.(entity ? accountId : null); return () => onAuthorization?.(null); }, [entity, accountId, onAuthorization]);
  if (!accountId) return <Text style={{ color: colors.textDim }}>Sign in to manage this page.</Text>;
  if (current.status === "loading") return <ActivityIndicator accessibilityLabel="Checking page ownership" color={colors.amber} />;
  if (current.status === "error") return <View style={{ gap: 12 }}><Text selectable accessibilityRole="alert" style={{ color: colors.danger }}>{current.error.userMessage || current.error.message}</Text><Button title="Retry loading pages" onPress={() => setAttempt(n => n + 1)} /></View>;
  if (!entity) return <Text selectable accessibilityRole="alert" style={{ color: colors.danger }}>This account does not manage this page. Your draft is saved; reopen it with the page’s account.</Text>;
  const change = (key, next) => onChange({ ...value, [key]: next });
  const field = (key, label, maxLength, placeholder = "") => <View style={{ gap: 6 }} key={key}>
    <Text style={{ color: colors.text, fontWeight: "700" }}>{label}</Text>
    <TextInput value={value[key]} onChangeText={next => change(key, next)} editable={!disabled && !readOnly} maxLength={maxLength} placeholder={placeholder} placeholderTextColor={colors.textFaint}
      accessibilityLabel={label} autoCapitalize={key === "url" ? "none" : "sentences"} keyboardType={key === "url" ? "url" : "default"}
      style={{ color: colors.text, backgroundColor: colors.bgElev, borderColor: colors.line, borderWidth: 1, borderRadius: radius.md, padding: 12, minHeight: 46 }} />
  </View>;
  return <View style={{ padding: 16, gap: 14, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line }}>
    <Text style={{ color: colors.amber, fontWeight: "800" }}>Posting as {entity.name}</Text>
    <Text style={{ color: colors.textDim }}>Share news, a show date or a release. Followers with updates enabled will hear about it in Activity.</Text>
    {!readOnly && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{Object.entries(CREATOR_UPDATE_KINDS).map(([kind, label]) => <Pressable key={kind} disabled={disabled} onPress={() => change("kind", kind)} accessibilityRole="button" accessibilityState={{ selected: value.kind === kind, disabled }} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: value.kind === kind ? colors.amber : colors.bgElev }}><Text style={{ color: value.kind === kind ? colors.bg : colors.text, fontWeight: "700" }}>{label}</Text></Pressable>)}</View>}
    {field("title", "Title", 160, "What’s new?")}
    {(value.kind !== "update" || value.date) && <View style={{ gap: 6 }}><Text style={{ color: colors.text }}>Date{value.kind === "release" ? " (optional)" : ""}</Text>{readOnly ? <Text style={{ color: colors.text }}>{value.date || "No date"}</Text> : <View pointerEvents={disabled ? "none" : "auto"}><DatePicker value={value.date} onChange={date => change("date", date)} accessibilityLabel="Update date" /></View>}</View>}
    {value.kind === "show" && field("location", "Venue or location", 200, "Venue, city")}
    {field("url", value.kind === "show" ? "Ticket link (optional)" : "Release or information link (optional)", 2000, "https://")}
    {!!creatorUpdateError(value) && !readOnly && <Text selectable style={{ color: colors.textDim }}>{creatorUpdateError(value)}</Text>}
    {readOnly && <Text style={{ color: colors.textDim }}>Dates and release details stay attached to this update. Publish a new update to announce a change.</Text>}
  </View>;
}
