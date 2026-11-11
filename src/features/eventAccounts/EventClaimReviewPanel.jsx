import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import Button from "../../components/Button";
import { colors, radius } from "../../theme";
import { createLoadState, projectLoadState, resolveLoadState, rejectLoadState, isLoadCancellation } from "../../domain/loadState.mjs";
import { toAppError } from "../../lib/diagnostics";
import { readEventClaims, reviewEventClaim } from "./eventAccountApi.mjs";

function ClaimReview({ claim, busy, onReview }) {
  const [reason, setReason] = useState(""), [url, setUrl] = useState("");
  const [official, setOfficial] = useState(false), [authority, setAuthority] = useState(false);
  const pending = claim.status === "pending";
  const evidence = { reason, reviewedUrl: url, officialAccountConfirmed: official, ownershipConfirmed: authority, expectedOwnerId: pending ? null : claim.accountId, confirmed: authority };
  const field = (label, value, change, multiline = false) => <TextInput accessibilityLabel={label} value={value} onChangeText={change} multiline={multiline} editable={!busy}
    placeholder={label} placeholderTextColor={colors.textFaint} maxLength={1000} autoCapitalize={multiline ? "sentences" : "none"}
    style={{ color: colors.text, padding: 12, backgroundColor: colors.bgElev, borderRadius: radius.md, minHeight: multiline ? 76 : 44 }} />;
  const check = (label, value, change) => <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: value, disabled: busy }} disabled={busy}
    onPress={() => change(!value)} style={{ paddingVertical: 12, flexDirection: "row", gap: 10 }}><Text style={{ color: colors.amber }}>{value ? "[x]" : "[ ]"}</Text><Text style={{ color: colors.text, flex: 1 }}>{label}</Text></Pressable>;
  return <View style={{ gap: 12, padding: 16, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg }}>
    <Text style={{ color: colors.text, fontWeight: "800" }}>{claim.entityKey}</Text>
    <Text selectable style={{ color: colors.textDim }}>{claim.accountName} · {claim.accountId}</Text>
    <Text selectable style={{ color: colors.text }}>{claim.note}</Text>
    {pending && <>{field("Official evidence link reviewed", url, setUrl)}{check("I checked the established official event or festival identity", official, setOfficial)}</>}
    {check(pending ? "I checked this account's authority to represent it" : "Remove this account's event page access", authority, setAuthority)}
    {field("Review reason", reason, setReason, true)}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {pending ? <><Button small title="Approve event access" disabled={!official || !authority || !url.trim() || reason.trim().length < 12} loading={busy} onPress={() => onReview(claim.id, "approve", evidence)} />
        <Button small variant="secondary" title="Reject request" disabled={reason.trim().length < 12 || busy} onPress={() => onReview(claim.id, "reject", { reason })} /></>
        : <Button small variant="secondary" title="Revoke event access" disabled={!authority || reason.trim().length < 12} loading={busy} onPress={() => onReview(claim.id, "revoke", evidence)} />}
    </View>
  </View>;
}

export default function EventClaimReviewPanel({ accountId }) {
  const [filter, setFilter] = useState("pending"), [cursor, setCursor] = useState(null), [previousCursors, setPreviousCursors] = useState([]);
  const scope = `${accountId}:event-claims:${filter}:${cursor || "first"}`;
  const [resource, setResource] = useState(() => createLoadState({ scope, status: "loading" }));
  const [attempt, setAttempt] = useState(0), [command, setCommand] = useState({ scope, busy: false, error: null });
  const controllerRef = useRef(null), currentScope = useRef(scope); currentScope.current = scope;
  const current = projectLoadState(resource, scope), state = command.scope === scope ? command : { busy: false, error: null };
  useEffect(() => {
    const controller = new AbortController(); setResource(createLoadState({ scope, status: "loading" }));
    readEventClaims({ accountId, signal: controller.signal, status: filter, cursor }).then(data => {
      if (!controller.signal.aborted) setResource(resolveLoadState({ scope, data }));
    }).catch(error => { if (!isLoadCancellation(error, controller.signal)) setResource(previous => rejectLoadState(previous, { scope, error: toAppError(error), retainData: false })); });
    return () => { controller.abort(); controllerRef.current?.abort(); controllerRef.current = null; };
  }, [scope, accountId, filter, cursor, attempt]);
  const review = async (id, action, evidence) => {
    if (controllerRef.current) return;
    const controller = new AbortController(); controllerRef.current = controller; setCommand({ scope, busy: true, error: null });
    const result = await reviewEventClaim({ id, action, evidence, accountId, signal: controller.signal });
    if (controller.signal.aborted || currentScope.current !== scope) return;
    controllerRef.current = null; setCommand({ scope, busy: false, error: result.ok ? null : result.error });
    if (result.ok) setAttempt(n => n + 1);
  };
  return <View style={{ gap: 14, marginVertical: 24 }}>
    <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: "800", color: colors.text }}>Event and festival access</Text>
    <Text style={{ color: colors.textDim }}>Check the established official identity and the claimant's authority directly. A supplied link alone is not proof. Approval changes the account to an event account and signs it out.</Text>
    <View style={{ flexDirection: "row", gap: 12 }} accessibilityRole="tablist">{[["pending", "Pending requests"], ["approved", "Approved pages"]].map(([value, label]) => <Pressable key={value}
      accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: filter === value, disabled: state.busy }} disabled={state.busy}
      onPress={() => { setFilter(value); setCursor(null); setPreviousCursors([]); }} style={{ paddingVertical: 12 }}><Text style={{ color: filter === value ? colors.amber : colors.textDim, fontWeight: "700" }}>{label}</Text></Pressable>)}</View>
    {!!state.error && <Text selectable accessibilityRole="alert" style={{ color: colors.danger }}>{state.error.userMessage || state.error.message}</Text>}
    {current.status === "loading" ? <ActivityIndicator accessibilityLabel="Loading event access requests" color={colors.amber} />
      : current.status === "error" ? <><Text accessibilityRole="alert" style={{ color: colors.danger }}>Event access requests could not load.</Text><Button small title="Retry event requests" onPress={() => setAttempt(n => n + 1)} /></>
        : current.data.claims.length ? current.data.claims.map(claim => <ClaimReview key={`${scope}:${claim.id}:${claim.status}`} claim={claim} busy={state.busy} onReview={review} />)
          : <Text style={{ color: colors.textDim }}>{filter === "pending" ? "No pending event requests on this page." : "No approved event accounts on this page."}</Text>}
    <View style={{ flexDirection: "row", gap: 12 }}>
      {!!previousCursors.length && <Button small variant="secondary" title="Previous page" disabled={state.busy} onPress={() => { setCursor(previousCursors[previousCursors.length - 1]); setPreviousCursors(rows => rows.slice(0, -1)); }} />}
      {!!current.data?.nextCursor && <Button small title="Next page" disabled={state.busy} onPress={() => { setPreviousCursors(rows => [...rows, cursor]); setCursor(current.data.nextCursor); }} />}
    </View>
  </View>;
}
