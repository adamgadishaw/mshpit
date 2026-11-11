import { useEffect, useRef, useState } from "react";
import { View, Text } from "react-native";
import Button from "../../components/Button";
import { colors } from "../../theme";
import { createLoadState, projectLoadState, resolveLoadState, rejectLoadState, isLoadCancellation } from "../../domain/loadState.mjs";
import { toAppError } from "../../lib/diagnostics";
import { fetchCreatorPreference, setCreatorUpdatePreference } from "./creatorPostsApi.mjs";

export default function CreatorUpdatePreference({ entityType, entityKey, accountId }) {
  const scope = `${accountId}:${entityType}:${entityKey}:updates`;
  const [resource, setResource] = useState(() => createLoadState({ scope, status: "loading" }));
  const [attempt, setAttempt] = useState(0);
  const [pendingScope, setPendingScope] = useState(null);
  const operation = useRef(null), currentScope = useRef(scope);
  currentScope.current = scope;
  const current = projectLoadState(resource, scope);
  useEffect(() => {
    const controller = new AbortController();
    fetchCreatorPreference({ entityType, entityKey, accountId, signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setResource(resolveLoadState({ scope, data }));
    }).catch(error => { if (!isLoadCancellation(error, controller.signal)) setResource(previous => rejectLoadState(previous, { scope, error: toAppError(error) })); });
    return () => { controller.abort(); operation.current?.abort(); operation.current = null; };
  }, [scope, entityType, entityKey, accountId, attempt]);
  const save = async () => {
    if (!current.data || operation.current) return;
    const controller = new AbortController(); operation.current = controller; setPendingScope(scope);
    try {
      const data = await setCreatorUpdatePreference({ entityType, entityKey, accountId, notifyUpdates: !current.data.notifyUpdates, signal: controller.signal });
      if (!controller.signal.aborted && currentScope.current === scope) setResource(resolveLoadState({ scope, data }));
    } catch (error) {
      if (!isLoadCancellation(error, controller.signal) && currentScope.current === scope) setResource(previous => rejectLoadState(previous, { scope, error: toAppError(error) }));
    } finally {
      if (operation.current === controller) { operation.current = null; setPendingScope(null); }
    }
  };
  if (current.status === "loading") return <Text style={{ color: colors.textDim }}>Loading update preferences…</Text>;
  if (current.data && !current.data.following && !current.error) return null;
  return <View style={{ gap: 8 }}>
    {!!current.error && <Text selectable accessibilityRole="alert" style={{ color: colors.danger }}>Update preferences couldn’t be saved or loaded. Try again.</Text>}
    {current.data ? <Button title={current.data.notifyUpdates ? "Turn off update alerts" : "Turn on update alerts"} onPress={() => void save()} loading={pendingScope === scope} small />
      : <Button title="Retry update preferences" onPress={() => setAttempt(n => n + 1)} small />}
  </View>;
}
