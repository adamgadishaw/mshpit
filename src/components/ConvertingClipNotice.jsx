import { useContext, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import Icon from "./Icon";
import { CompletionVisibilityContext } from "./CompletionVisibilityContext";
import { convertingClipPoller, retryConvertingClip } from "../lib/convertingClipsApi";
import useAppActive from "../lib/useAppActive";
import usePosterViewability from "../lib/usePosterViewability";
import { colors, radius } from "../theme";
import { convertingClipSummary } from "../domain/convertingClips.mjs";

// Only the author sees this: clips they posted while the server was still
// converting them. It checks on them while it is on screen and refreshes the
// feed as soon as one is ready, so the clip appears without any action. A clip
// that could not be converted says so and can be tried again; it is never
// quietly dropped from the post.
export default function ConvertingClipNotice({ clips, accountId, active = true, onReady }) {
  const appActive = useAppActive();
  const surfaceVisible = useContext(CompletionVisibilityContext);
  // A tall card can be visible while its notice is below the viewport. Measure
  // the notice itself; screen visibility is an additional veto, never a grant.
  const { targetRef, autoViewable, onLayout } = usePosterViewability(active && appActive && surfaceVisible ? null : false);
  const scope = JSON.stringify([accountId, clips.map(({ id, state }) => [id, state])]);
  const initialStates = () => new Map(clips.map((clip) => [clip.id, clip.state]));
  const [record, setRecord] = useState(() => ({ scope, states: initialStates() }));
  const states = record.scope === scope ? record.states : initialStates();
  const enabled = !!accountId && active && appActive && surfaceVisible && autoViewable && states.size > 0;
  const [retrying, setRetrying] = useState(false);
  const readyRef = useRef(onReady);
  const ownerRef = useRef(null);
  const retryRef = useRef(null);
  readyRef.current = onReady;
  // Fence callbacks at render time, including the gap before effect cleanup.
  ownerRef.current = { scope, enabled };

  useEffect(() => {
    setRetrying(false);
    return () => {
      retryRef.current?.abort();
      retryRef.current = null;
    };
  }, [scope, enabled]);

  const waiting = [...states].filter(([, state]) => state === "processing").map(([id]) => id);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const isCurrent = () => !cancelled && ownerRef.current.scope === scope && ownerRef.current.enabled;
    // Failed clips retain a passive subscription, so an explicit successful
    // retry in another visible card updates every copy without another POST.
    const subscriptions = clips.map(({ id, state }) => convertingClipPoller.subscribe({
      accountId, assetId: id, state, isCurrent,
      onState(state) {
        if (!isCurrent()) return;
        setRecord((current) => {
          const next = new Map(current.scope === scope ? current.states : initialStates());
          if (state === "ready") next.delete(id);
          else next.set(id, state);
          return { scope, states: next };
        });
      },
      onReady: ({ signal }) => isCurrent() ? readyRef.current?.({ signal }) : false,
    }));
    return () => {
      cancelled = true;
      subscriptions.forEach((unsubscribe) => unsubscribe());
    };
    // scope captures the account and all server states. Local transitions do
    // not restart subscriptions or mistake old props for a fresh projection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, enabled, scope]);

  const failed = [...states].filter(([, state]) => state === "failed").map(([id]) => id);
  const summary = convertingClipSummary({ converting: waiting.length, failed: failed.length });
  if (!summary) return null;

  const retry = async () => {
    if (!enabled || retryRef.current || ownerRef.current.scope !== scope || !ownerRef.current.enabled) return;
    const controller = new AbortController();
    retryRef.current = controller;
    setRetrying(true);
    const outcomes = await Promise.allSettled(failed.map((id) => retryConvertingClip(id, { accountId, signal: controller.signal })));
    if (controller.signal.aborted || retryRef.current !== controller || ownerRef.current.scope !== scope || !ownerRef.current.enabled) return;
    for (let index = 0; index < outcomes.length; index++) {
      if (outcomes[index].status === "fulfilled") convertingClipPoller.retryAccepted(accountId, failed[index]);
    }
    setRecord((current) => {
      const next = new Map(current.scope === scope ? current.states : initialStates());
      outcomes.forEach((outcome, index) => {
        // A refused retry stays marked as not converted; the button remains.
        if (outcome.status !== "fulfilled") return;
        // Even an already-ready retry reconciles through the shared feed
        // refresh before retiring the notice.
        next.set(failed[index], "processing");
      });
      return { scope, states: next };
    });
    retryRef.current = null;
    setRetrying(false);
  };

  return (
    <View ref={targetRef} onLayout={onLayout} style={styles.box} accessibilityLiveRegion="polite">
      {waiting.length > 0
        ? <ActivityIndicator size="small" color={colors.amber} />
        : <Icon name="flag" size={14} color={colors.danger} />}
      <Text style={styles.text}>{summary}</Text>
      {failed.length > 0 && (
        <Pressable style={styles.retry} onPress={retry} disabled={retrying} accessibilityRole="button" accessibilityLabel="Try converting the clip again">
          <Text style={styles.retryText}>{retrying ? "Trying..." : "Try again"}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.lineSoft,
  },
  text: { flex: 1, color: colors.textDim, fontSize: 13, lineHeight: 18 },
  retry: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.amber },
  retryText: { color: colors.amber, fontSize: 12, fontWeight: "700" },
});
