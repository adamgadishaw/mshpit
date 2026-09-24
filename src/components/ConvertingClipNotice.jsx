import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import Icon from "./Icon";
import { checkConvertingClip, retryConvertingClip } from "../lib/convertingClipsApi";
import { colors, radius } from "../theme";
import { convertingClipSummary } from "../domain/convertingClips.mjs";

const CHECK_EVERY_MS = 15_000;

// Only the author sees this: clips they posted while the server was still
// converting them. It checks on them while it is on screen and refreshes the
// feed as soon as one is ready, so the clip appears without any action. A clip
// that could not be converted says so and can be tried again; it is never
// quietly dropped from the post.
export default function ConvertingClipNotice({ clips, onReady }) {
  const [states, setStates] = useState(() => new Map(clips.map((clip) => [clip.id, clip.state])));
  const [retrying, setRetrying] = useState(false);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const clipKey = clips.map((clip) => `${clip.id}:${clip.state}`).join(",");

  useEffect(() => {
    setStates(new Map(clips.map((clip) => [clip.id, clip.state])));
    // clipKey captures every id and state the server reported.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipKey]);

  const waiting = [...states].filter(([, state]) => state === "processing").map(([id]) => id);
  const waitingKey = waiting.join(",");

  useEffect(() => {
    if (!waiting.length) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    const check = async () => {
      const results = await Promise.all(waiting.map(async (id) => [id, await checkConvertingClip(id, { signal: controller.signal })]));
      if (cancelled) return;
      setStates((current) => {
        const next = new Map(current);
        for (const [id, state] of results) {
          if (state === "ready") next.delete(id);
          else if (state === "failed") next.set(id, "failed");
        }
        return next;
      });
      if (results.some(([, state]) => state === "ready")) readyRef.current?.();
    };
    const timer = setInterval(() => { void check(); }, CHECK_EVERY_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
    // waitingKey lists the clips being checked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingKey]);

  const failed = [...states].filter(([, state]) => state === "failed").map(([id]) => id);
  const summary = convertingClipSummary({ converting: waiting.length, failed: failed.length });
  if (!summary) return null;

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    const outcomes = await Promise.allSettled(failed.map((id) => retryConvertingClip(id)));
    setStates((current) => {
      const next = new Map(current);
      outcomes.forEach((outcome, index) => {
        // A refused retry stays marked as not converted; the button remains.
        if (outcome.status !== "fulfilled") return;
        if (outcome.value === "ready") next.delete(failed[index]);
        else next.set(failed[index], "processing");
      });
      return next;
    });
    setRetrying(false);
    if (outcomes.some((outcome) => outcome.status === "fulfilled" && outcome.value === "ready")) readyRef.current?.();
  };

  return (
    <View style={styles.box} accessibilityLiveRegion="polite">
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
