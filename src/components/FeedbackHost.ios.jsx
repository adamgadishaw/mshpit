import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, focusRing, mono, radius } from "../theme";
import { subscribeFeedback, supportReferenceFor } from "../lib/diagnostics";
import Icon from "./Icon";
import useScreenReaderEnabled from "../hooks/useScreenReaderEnabled";

const severityColor = (severity) => {
  if (severity === "fatal" || severity === "error") return colors.danger;
  if (severity === "warning") return colors.gold;
  return colors.cool;
};

export default function FeedbackHost({ canViewDiagnostics = false, onOpenDiagnostics }) {
  const [notice, setNotice] = useState(null);
  const lifetime = useRef(null);
  const current = useRef(null);
  const latest = useRef(null);
  const screenReader = useScreenReaderEnabled();

  // Commit current permissions, callbacks and preferences before native events
  // can invoke a control retained from a previous render of this same notice.
  useLayoutEffect(() => {
    latest.current = { canViewDiagnostics, onOpenDiagnostics, screenReader };
  });
  useLayoutEffect(() => {
    const owner = {};
    lifetime.current = owner;
    // Effect reconnects can preserve React state (for example Suspense). A
    // retired notice must not reappear with controls owned by the old lifetime.
    current.current = null;
    setNotice(null);
    const unsubscribe = subscribeFeedback((entry) => {
      if (lifetime.current !== owner) return;
      const next = { entry, owner };
      current.current = next;
      setNotice(next);
    });
    return () => {
      lifetime.current = null;
      current.current = null;
      unsubscribe();
    };
  }, []);

  const dismiss = (expected) => {
    if (!expected || lifetime.current !== expected.owner || current.current !== expected) return false;
    current.current = null;
    setNotice((shown) => shown === expected ? null : shown);
    return true;
  };

  useEffect(() => {
    // Unknown preferences start conservatively enabled. VoiceOver readers keep
    // the message until dismissal/replacement, with a fresh interval on disable.
    if (!notice || screenReader) return undefined;
    let active = true;
    const timer = setTimeout(() => {
      if (active && !latest.current.screenReader) dismiss(notice);
    }, 7000);
    return () => { active = false; clearTimeout(timer); };
  }, [notice, screenReader]);

  if (!notice) return null;
  const { entry } = notice;
  const accent = severityColor(entry.severity);
  const supportReference = supportReferenceFor(entry);

  return (
    <View style={[styles.host, styles.hostPointerEvents]}>
      <View style={[styles.card, { borderColor: accent }]} accessibilityRole="alert" accessibilityLiveRegion={entry.severity === "info" ? "polite" : "assertive"}>
        <View style={[styles.signal, { backgroundColor: accent }]} />
        <View style={styles.icon}>
          <Icon name="music" size={18} color={accent} strokeWidth={2.2} />
        </View>
        <View style={styles.copy}>
          <View style={styles.heading}>
            <Text style={styles.title}>{entry.title}</Text>
            {canViewDiagnostics && <Text style={[styles.code, { color: accent }]}>{entry.code}</Text>}
          </View>
          <Text selectable style={styles.message}>{entry.message}</Text>
          {canViewDiagnostics ? (
            <Pressable
              style={({ focused, pressed }) => [styles.detailsButton, focused && focusRing, pressed && styles.controlPressed]}
              onPress={() => {
                if (!latest.current.canViewDiagnostics) return;
                const open = latest.current.onOpenDiagnostics;
                if (dismiss(notice)) open?.();
              }}
              accessibilityRole="button"
              accessibilityLabel={`View diagnostics for ${entry.code}`}
              hitSlop={6}
            >
              <Text style={[styles.details, { color: accent }]}>View failure details</Text>
            </Pressable>
          ) : supportReference ? (
            <Text selectable accessibilityLabel={`Support reference ${supportReference}`} style={[styles.reference, { color: accent }]}>Support reference: {supportReference}</Text>
          ) : null}
        </View>
        <Pressable style={({ focused, pressed }) => [styles.close, focused && focusRing, pressed && styles.controlPressed]} onPress={() => dismiss(notice)} accessibilityRole="button" accessibilityLabel="Dismiss message" hitSlop={8}>
          <Icon name="x" size={16} color={colors.textDim} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    top: 12,
    left: 14,
    right: 14,
    zIndex: 500,
    alignItems: "flex-end",
  },
  card: {
    width: "100%",
    maxWidth: 430,
    minHeight: 96,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
    overflow: "hidden",
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 14,
    paddingLeft: 17,
    shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12,
  },
  hostPointerEvents: { pointerEvents: "box-none" },
  signal: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  icon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  heading: { alignItems: "flex-start", gap: 4 },
  title: { alignSelf: "stretch", color: colors.text, fontSize: 14.5, fontWeight: "900" },
  code: { fontFamily: mono, fontSize: 10.5, fontWeight: "800" },
  message: { color: colors.textDim, fontSize: 12.5, lineHeight: 18 },
  details: { fontSize: 12, fontWeight: "800", marginTop: 2 },
  reference: { fontFamily: mono, fontSize: 10.5, lineHeight: 16, paddingTop: 3 },
  detailsButton: { minHeight: 44, minWidth: 44, maxWidth: "100%", alignSelf: "flex-start", justifyContent: "center" },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginTop: -9, marginRight: -9 },
  controlPressed: { opacity: 0.72 },
});
