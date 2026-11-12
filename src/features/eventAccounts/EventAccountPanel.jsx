import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View, Text, TextInput } from "react-native";
import { colors, radius } from "../../theme";
import Button from "../../components/Button";
import { createLoadState, resolveLoadState, rejectLoadState, projectLoadState, isLoadCancellation } from "../../domain/loadState.mjs";
import { toAppError } from "../../lib/diagnostics";
import { readEventAccount, requestEventAccess, setEventFollowing } from "./eventAccountApi.mjs";
import useIOSDetailPresentation from "../../hooks/useIOSDetailPresentation";

// Render from an existing event/festival identity. The server supplies the
// registry key and management permission; callers never grant themselves access.
export default function EventAccountPanel({ targetKind, targetId, accountId = null, onCompose, onOpenPost, onRequireAuth, renderUpdates }) {
  const { guard, canAct } = useIOSDetailPresentation();
  const scope = `${accountId || "guest"}:${targetKind}:${targetId}`;
  const [resource, setResource] = useState(() => createLoadState({ scope, status: "loading" }));
  const [attempt, setAttempt] = useState(0), [form, setForm] = useState(false), [note, setNote] = useState("");
  const [commandState, setCommandState] = useState({ scope, busy: false, error: null });
  const operation = useRef(null), currentScope = useRef(scope); currentScope.current = scope;
  const current = projectLoadState(resource, scope), state = commandState.scope === scope ? commandState : { busy: false, error: null };
  useEffect(() => {
    const controller = new AbortController(); setResource(createLoadState({ scope, status: "loading" }));
    readEventAccount({ kind: targetKind, id: targetId, accountId, signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setResource(resolveLoadState({ scope, data }));
    }).catch(error => { if (!isLoadCancellation(error, controller.signal)) setResource(previous => rejectLoadState(previous, { scope, error: toAppError(error), retainData: false })); });
    return () => { controller.abort(); operation.current?.abort(); operation.current = null; };
  }, [scope, targetKind, targetId, accountId, attempt]);
  useEffect(() => { setNote(""); setForm(false); }, [scope]);
  const run = async action => {
    if (!canAct() || operation.current) return;
    const controller = new AbortController(); operation.current = controller; setCommandState({ scope, busy: true, error: null });
    const result = await action(controller.signal);
    if (controller.signal.aborted || currentScope.current !== scope) return;
    operation.current = null; setCommandState({ scope, busy: false, error: result.ok ? null : result.error });
    if (result.ok) { setForm(false); setAttempt(n => n + 1); }
  };
  if (current.status === "loading") return <ActivityIndicator accessibilityLabel="Loading event page access" color={colors.amber} />;
  if (current.status === "error") return <View style={{ gap: 10 }}><Text accessibilityRole="alert" style={{ color: colors.textDim }}>Event page access could not load.</Text><Button small title="Try again" onPress={guard(() => setAttempt(n => n + 1))} /></View>;
  const page = current.data;
  if (!page) return null;
  return <View style={{ gap: 12, marginVertical: 16 }}>
    {page.canFollow && renderUpdates?.({ entityType: "event", entityKey: page.entity.entityKey, accountId, onOpenPost: guard(onOpenPost),
      onCompose: page.canManage && onCompose ? guard(() => onCompose(page.entity)) : undefined, following: page.following })}
    {!page.canManage && page.canFollow && <Button small title={page.following ? "Unfollow event updates" : "Follow event updates"} loading={state.busy}
      onPress={guard(() => accountId ? void run(signal => setEventFollowing({ entityKey: page.entity.entityKey, following: !page.following, notifyUpdates: page.notifyUpdates, accountId, signal })) : onRequireAuth?.())} />}
    {!page.claimed && page.canFollow && <Text style={{ color: colors.textDim }}>Follow now for updates when an approved representative starts posting.</Text>}
    {!page.claimed && !form && <>
      {page.claim?.status === "pending" ? <Text style={{ color: colors.textDim }}>Your access request is awaiting staff review. It has not changed your account.</Text>
        : <Button small variant="secondary" title="Represent this event or festival?" onPress={guard(() => accountId ? setForm(true) : onRequireAuth?.())} />}
      {!!page.claim?.reviewReason && <Text selectable style={{ color: colors.textDim }}>{page.claim.reviewReason}</Text>}
    </>}
    {form && <View style={{ gap: 12, padding: 16, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg }}>
      <Text style={{ color: colors.text, fontWeight: "800" }}>Request page access</Text>
      <Text style={{ color: colors.textDim }}>{page.canRequest ? "Use an account dedicated to this event or festival. Staff must check your authority. Approval changes this account to an event account and signs it out." : "Use a separate account dedicated to this event or festival. This account cannot request access."}</Text>
      {page.canRequest && <><TextInput multiline accessibilityLabel="Your role and official contact" value={note} onChangeText={guard(setNote)} maxLength={2000} editable={!state.busy}
        placeholder="Your role, official website and a contact staff can verify" placeholderTextColor={colors.textFaint}
        style={{ color: colors.text, backgroundColor: colors.bgElev, padding: 12, minHeight: 100, borderRadius: radius.md }} />
      <Button title="Send access request" disabled={note.trim().length < 12} loading={state.busy} onPress={guard(() => void run(signal => requestEventAccess({ kind: targetKind, id: targetId, note, accountId, signal })))} /></>}
      <Button small variant="secondary" title="Cancel" disabled={state.busy} onPress={guard(() => setForm(false))} />
    </View>}
    {!!state.error && <Text selectable accessibilityRole="alert" style={{ color: colors.danger }}>{state.error.userMessage || state.error.message}</Text>}
  </View>;
}
