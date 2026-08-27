import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import Icon from "../../components/Icon";
import {
  attendanceControlsVisible,
  attendanceMutationIdentity,
  attendanceOptionsForPhase,
  optimisticViewerAttendance,
} from "../../domain/showAttendance.mjs";
import { colors, mono, radius } from "../../theme";
import { writeShowAttendance } from "./showSocialService";

const STATE_COPY = Object.freeze({
  interested: { label: "Interested", detail: "Keep this night on your radar", icon: "star" },
  going: { label: "Going", detail: "Plan to be in the Crowd", icon: "calendar" },
  here: { label: "Here", detail: "Quick live check-in", icon: "pin" },
  went: { label: "Went", detail: "Add it to your live history", icon: "check" },
});

const VISIBILITY_COPY = Object.freeze({
  members: { label: "Members", detail: "Visible to signed-in Mshpit members" },
  followers: { label: "Followers", detail: "Visible to people who follow you" },
  private: { label: "Only me", detail: "Hidden from everyone else" },
});

const attendanceErrorMessage = (error) => error?.userMessage
  || "Your attendance was not changed. Try again.";

export default function ShowAttendanceControls({
  accountId,
  currentAttendance,
  lifecycle,
  onRequireAuth,
  onSaved,
  show,
}) {
  const options = attendanceOptionsForPhase(lifecycle);
  const identity = attendanceMutationIdentity(show?.id, accountId);
  const activeIdentityRef = useRef(identity);
  const inFlightIdentityRef = useRef(null);
  activeIdentityRef.current = identity;
  const [mutation, setMutation] = useState(null);
  const scopedMutation = mutation?.identity === identity ? mutation : null;
  const attendance = scopedMutation?.attendance !== undefined
    ? scopedMutation.attendance
    : currentAttendance || null;
  const pending = scopedMutation?.status === "saving";

  useEffect(() => () => {
    if (activeIdentityRef.current === identity) activeIdentityRef.current = null;
  }, [identity]);

  if (!attendanceControlsVisible({
    showId: show?.id,
    phase: lifecycle,
    currentAttendance: attendance,
    mutationPending: pending,
  })) return null;

  const save = async ({ state, visibility }) => {
    if (!accountId) {
      onRequireAuth?.();
      return;
    }
    if (pending || inFlightIdentityRef.current === identity) return;
    const claim = identity;
    inFlightIdentityRef.current = claim;
    const previous = attendance;
    const hasVisibility = visibility !== undefined;
    const optimistic = optimisticViewerAttendance(previous, { state, ...(hasVisibility ? { visibility } : {}) });
    setMutation({ identity: claim, status: "saving", attendance: optimistic, error: null });
    try {
      const result = await writeShowAttendance({
        showId: show.id,
        state,
        ...(hasVisibility ? { visibility } : {}),
        show,
        accountId,
      });
      if (activeIdentityRef.current !== claim) return;
      setMutation({ identity: claim, status: "ready", attendance: result.attendance, error: null });
      onSaved?.(result);
    } catch (error) {
      if (activeIdentityRef.current !== claim) return;
      setMutation({ identity: claim, status: "error", attendance: previous, error });
    } finally {
      if (inFlightIdentityRef.current === claim) inFlightIdentityRef.current = null;
    }
  };

  const currentStateCopy = attendance?.state ? STATE_COPY[attendance.state] : null;
  const visibilityCopy = attendance?.visibility ? VISIBILITY_COPY[attendance.visibility] : null;
  return (
    <View style={styles.card} accessibilityLabel="Your attendance for this show">
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>YOUR SHOW STATUS</Text>
          <Text style={styles.title}>{currentStateCopy?.label || "Make a plan"}</Text>
          <Text style={styles.intro}>
            {currentStateCopy?.detail || "Choose the one status that fits this exact night."}
          </Text>
        </View>
        {attendance ? (
          <Pressable
            style={({ pressed }) => [styles.clear, pressed && styles.pressed, pending && styles.disabled]}
            onPress={() => { void save({ state: null }); }}
            disabled={pending}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${currentStateCopy?.label || "attendance"} from this show`}
            accessibilityState={{ disabled: pending, busy: pending }}
          >
            <Icon name="x" size={13} color={colors.textDim} />
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
        ) : null}
      </View>

      {options.length > 0 ? <View style={styles.stateOptions} accessibilityRole="radiogroup" accessibilityLabel="Choose show attendance">
        {options.map((state) => {
          const copy = STATE_COPY[state];
          const selected = attendance?.state === state;
          return (
            <Pressable
              key={state}
              style={({ pressed }) => [
                styles.stateOption,
                selected && styles.stateOptionSelected,
                pressed && styles.pressed,
                pending && styles.disabled,
              ]}
              onPress={() => { if (!selected) void save({ state }); }}
              disabled={pending}
              accessibilityRole="radio"
              accessibilityLabel={copy.label}
              accessibilityHint={copy.detail}
              accessibilityState={{ checked: selected, disabled: pending, busy: pending }}
            >
              <View style={[styles.stateIcon, selected && styles.stateIconSelected]}>
                {pending && selected
                  ? <ActivityIndicator size="small" color="#1A1206" />
                  : <Icon name={copy.icon} size={17} color={selected ? "#1A1206" : colors.amber} />}
              </View>
              <View style={styles.stateCopy}>
                <Text style={[styles.stateLabel, selected && styles.stateLabelSelected]}>{copy.label}</Text>
                <Text style={[styles.stateDetail, selected && styles.stateDetailSelected]}>{copy.detail}</Text>
              </View>
            </Pressable>
          );
        })}
      </View> : null}

      {attendance && accountId ? (
        <View style={styles.privacy}>
          <View style={styles.privacyHeading}>
            <Icon name="lock" size={14} color={colors.textDim} />
            <Text style={styles.privacyTitle}>Who can see this?</Text>
          </View>
          <View style={styles.visibilityOptions} accessibilityRole="radiogroup" accessibilityLabel="Attendance visibility">
            {Object.entries(VISIBILITY_COPY).map(([visibility, copy]) => {
              const selected = attendance.visibility === visibility;
              return (
                <Pressable
                  key={visibility}
                  style={({ pressed }) => [
                    styles.visibilityOption,
                    selected && styles.visibilityOptionSelected,
                    pressed && styles.pressed,
                    pending && styles.disabled,
                  ]}
                  onPress={() => { if (!selected) void save({ state: attendance.state, visibility }); }}
                  disabled={pending}
                  accessibilityRole="radio"
                  accessibilityLabel={copy.label}
                  accessibilityHint={copy.detail}
                  accessibilityState={{ checked: selected, disabled: pending, busy: pending }}
                >
                  <Text style={[styles.visibilityLabel, selected && styles.visibilityLabelSelected]}>{copy.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.privacyDetail}>
            {attendance.state === "here" && attendance.visibility === "private"
              ? "Live check-ins start Only me. Share this only if you want your attendance visible."
              : visibilityCopy?.detail || "You control this show's visibility."}
          </Text>
          {attendance.verified ? (
            <View style={styles.verified} accessibilityRole="text" accessibilityLabel="Verified attendance">
              <Icon name="check" size={12} color={colors.good} />
              <Text style={styles.verifiedText}>Verified attendance</Text>
            </View>
          ) : (
            <Text style={styles.unverified}>This records your status. It does not verify attendance.</Text>
          )}
        </View>
      ) : null}

      {scopedMutation?.status === "error" ? (
        <Text selectable style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          {attendanceErrorMessage(scopedMutation.error)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 16, padding: 14, gap: 12, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  header: { minHeight: 44, flexDirection: "row", alignItems: "flex-start", gap: 10 },
  headerCopy: { flex: 1, minWidth: 0 },
  kicker: { color: colors.amber, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  title: { color: colors.text, fontSize: 17, fontWeight: "900", marginTop: 3 },
  intro: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: 2 },
  clear: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 11 },
  clearText: { color: colors.textDim, fontSize: 11, fontWeight: "800" },
  stateOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stateOption: { minWidth: 140, minHeight: 64, flexGrow: 1, flexBasis: "45%", flexDirection: "row", alignItems: "center", gap: 9, borderRadius: radius.sm, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev, padding: 10 },
  stateOptionSelected: { borderColor: colors.amberStrong, backgroundColor: colors.amberStrong },
  stateIcon: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 17, backgroundColor: colors.surface },
  stateIconSelected: { backgroundColor: "rgba(26,18,6,0.12)" },
  stateCopy: { flex: 1, minWidth: 0 },
  stateLabel: { color: colors.text, fontSize: 13, fontWeight: "900" },
  stateLabelSelected: { color: "#1A1206" },
  stateDetail: { color: colors.textDim, fontSize: 10.5, lineHeight: 14, marginTop: 2 },
  stateDetailSelected: { color: "rgba(26,18,6,0.7)" },
  privacy: { gap: 8, borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: 12 },
  privacyHeading: { flexDirection: "row", alignItems: "center", gap: 6 },
  privacyTitle: { color: colors.text, fontSize: 12, fontWeight: "800" },
  visibilityOptions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  visibilityOption: { minHeight: 44, flexGrow: 1, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev, paddingHorizontal: 10 },
  visibilityOptionSelected: { borderColor: colors.amber, backgroundColor: colors.surfaceAlt },
  visibilityLabel: { color: colors.textDim, fontSize: 11, fontWeight: "800" },
  visibilityLabelSelected: { color: colors.amber },
  privacyDetail: { color: colors.textDim, fontSize: 11, lineHeight: 16 },
  verified: { flexDirection: "row", alignItems: "center", gap: 5 },
  verifiedText: { color: colors.good, fontFamily: mono, fontSize: 9.5, fontWeight: "800" },
  unverified: { color: colors.textFaint, fontSize: 10.5, lineHeight: 15 },
  error: { color: colors.danger, fontSize: 11.5, lineHeight: 17, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.bgElev, padding: 10 },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.7 },
});
