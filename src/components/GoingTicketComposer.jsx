import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  buildAttendanceTicketPreview,
  createAttendanceTicketClientMutationId,
} from "../domain/attendanceTicket.mjs";
import { colors, displayFont, mono, radius, shadow } from "../theme";
import Button from "./Button";
import ConcertTicketCard from "./ConcertTicketCard";
import Icon from "./Icon";

const cleanSeatPart = (value, max = 40) => String(value || "").trim().slice(0, max);
const POST_ERROR = "Couldn't share this ticket right now. Your Going status is still saved.";
const EMPTY_DRAFT = { note: "", shareSeatLocation: false, section: "", row: "", seat: "" };

export default function GoingTicketComposer({
  event,
  onDismiss,
  onPost,
  tourDateId,
  user,
}) {
  const [draft, setDraft] = useState(null);
  const [postingMutation, setPostingMutation] = useState(null);
  const [failure, setFailure] = useState(null);
  const mutationRef = useRef(null);
  const accountId = user?.id || null;
  if (!mutationRef.current || mutationRef.current.tourDateId !== tourDateId
    || mutationRef.current.accountId !== accountId) {
    mutationRef.current = {
      tourDateId,
      accountId,
      id: createAttendanceTicketClientMutationId(),
      draftScope: mutationRef.current?.accountId === accountId ? mutationRef.current.draftScope : {},
      pending: null,
      cancelled: false,
    };
  }
  const mutation = mutationRef.current;
  const clientMutationId = mutation.id;
  // A departing account's private text and seat consent never render under its
  // replacement, even before effect cleanup. Same-account retries keep drafts.
  const { note, shareSeatLocation, section, row, seat } = draft?.scope === mutation.draftScope ? draft : EMPTY_DRAFT;
  const posting = postingMutation === mutation;
  const error = failure?.mutation === mutation ? failure.message : "";
  useEffect(() => {
    mutation.cancelled = false;
    return () => {
      mutation.cancelled = true;
      mutation.pending = null;
    };
  }, [mutation]);
  const seatLocation = useMemo(() => ({
    section: cleanSeatPart(section),
    row: cleanSeatPart(row),
    seat: cleanSeatPart(seat),
  }), [row, seat, section]);
  const ticket = useMemo(() => buildAttendanceTicketPreview({
    author: user?.name || user?.handle || "A Mshpit member",
    show: event,
    seatLocation,
    shareSeatLocation,
  }), [event, seatLocation, shareSeatLocation, user?.handle, user?.name]);

  const isCurrent = () => mutationRef.current === mutation && !mutation.cancelled;
  const updateDraft = (field, value) => {
    if (!isCurrent()) return;
    setDraft((previous) => {
      const current = previous?.scope === mutation.draftScope ? previous : EMPTY_DRAFT;
      return {
        ...current,
        scope: mutation.draftScope,
        [field]: typeof value === "function" ? value(current[field]) : value,
      };
    });
  };
  const dismiss = () => {
    if (!isCurrent()) return;
    mutation.cancelled = true;
    mutation.pending = null;
    setPostingMutation(null);
    onDismiss?.();
  };
  const publish = async () => {
    if (!isCurrent() || mutation.pending || !tourDateId) return;
    // Claim synchronously: two presses can arrive before loading re-renders.
    const request = {};
    mutation.pending = request;
    const ownsRequest = () => isCurrent() && mutation.pending === request;
    setPostingMutation(mutation);
    setFailure(null);
    try {
      const result = await onPost?.({
        id: clientMutationId,
        kind: "status",
        review: note.trim(),
        attendanceTicket: {
          ...ticket,
          tourDateId,
          includeSeat: shareSeatLocation,
          ...(shareSeatLocation ? seatLocation : {}),
        },
      });
      if (!ownsRequest() || result?.stale) return;
      if (result?.ok) {
        dismiss();
        return;
      }
      setFailure({ mutation, message: POST_ERROR });
    } catch (error) {
      if (ownsRequest() && error?.name !== "AbortError" && !error?.stale) {
        setFailure({ mutation, message: POST_ERROR });
      }
    } finally {
      if (ownsRequest()) {
        mutation.pending = null;
        setPostingMutation(null);
      }
    }
  };

  return (
    <View style={styles.card} accessibilityLabel="Share your Going post">
      <View style={styles.headingRow}>
        <View style={styles.headingIcon}><Icon name="ticket" size={18} color={colors.amber} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.kicker}>YOU’RE GOING</Text>
          <Text style={styles.title}>Share your Going post?</Text>
          <Text style={styles.intro}>Optional. Your Going status is already saved. This creates a public feed post and is not a ticket for entry.</Text>
        </View>
        <Pressable style={styles.dismiss} onPress={dismiss} accessibilityRole="button" accessibilityLabel="Do not share a Going post">
          <Icon name="x" size={16} color={colors.textDim} />
        </Pressable>
      </View>

      <ConcertTicketCard ticket={ticket} compact accessibilityHint="Preview of your public Going post" />

      <TextInput
        style={styles.note}
        value={note}
        onChangeText={(value) => updateDraft("note", value)}
        maxLength={500}
        multiline
        placeholder="Add a note (optional)"
        placeholderTextColor={colors.textFaint}
        accessibilityLabel="Optional note for your Going post"
      />

      <Pressable
        style={({ pressed }) => [styles.seatToggle, pressed && styles.pressed]}
        onPress={() => updateDraft("shareSeatLocation", (value) => !value)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: shareSeatLocation }}
        accessibilityLabel="Share my seat location publicly"
        accessibilityHint="Seat details are off by default and appear on the public ticket post only when enabled"
      >
        <View style={[styles.checkbox, shareSeatLocation && styles.checkboxOn]}>
          {shareSeatLocation ? <Icon name="check" size={13} color="#1A1206" /> : null}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.seatToggleTitle}>Share seat details</Text>
          <Text style={styles.seatToggleCopy}>Optional and public. Never add a barcode, order number, transfer link, or ticket screenshot.</Text>
        </View>
      </Pressable>

      {shareSeatLocation ? (
        <View style={styles.seatFields}>
          <TextInput style={styles.seatInput} value={section} onChangeText={(value) => updateDraft("section", value)} maxLength={40} placeholder="Section or general admission" placeholderTextColor={colors.textFaint} accessibilityLabel="Public section or general admission area" />
          <TextInput style={styles.seatInput} value={row} onChangeText={(value) => updateDraft("row", value)} maxLength={30} placeholder="Row (optional)" placeholderTextColor={colors.textFaint} accessibilityLabel="Public row, optional" />
          <TextInput style={styles.seatInput} value={seat} onChangeText={(value) => updateDraft("seat", value)} maxLength={30} placeholder="Seat (optional)" placeholderTextColor={colors.textFaint} accessibilityLabel="Public seat, optional" />
        </View>
      ) : null}

      {error ? <Text selectable style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <View style={styles.actions}>
        <Button title="Not now" variant="secondary" small onPress={dismiss} style={styles.action} disabled={posting} />
        <Button title="Share post" icon="share" small onPress={() => { void publish(); }} style={styles.action} loading={posting} disabled={!tourDateId} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 14, padding: 14, gap: 12, borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: "rgba(242,166,90,0.42)", backgroundColor: colors.surface, ...shadow.card },
  headingRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  headingIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(242,166,90,0.10)", borderWidth: 1, borderColor: "rgba(242,166,90,0.28)" },
  kicker: { color: colors.amber, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  title: { color: colors.text, fontFamily: displayFont, fontSize: 17, fontWeight: "900", marginTop: 2 },
  intro: { color: colors.textDim, fontSize: 11.5, lineHeight: 16, marginTop: 3 },
  dismiss: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, borderWidth: 1, borderColor: colors.line },
  note: { minHeight: 72, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev, color: colors.text, fontSize: 14, lineHeight: 20, textAlignVertical: "top" },
  seatToggle: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev },
  checkbox: { width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: 7, borderWidth: 1, borderColor: colors.line },
  checkboxOn: { borderColor: colors.amberStrong, backgroundColor: colors.amberStrong },
  seatToggleTitle: { color: colors.text, fontSize: 12.5, fontWeight: "900" },
  seatToggleCopy: { color: colors.textDim, fontSize: 10.5, lineHeight: 14, marginTop: 2 },
  seatFields: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  seatInput: { minWidth: 125, minHeight: 44, flexGrow: 1, flexBasis: "30%", paddingHorizontal: 11, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev, color: colors.text, fontSize: 12.5 },
  error: { color: colors.danger, fontSize: 11.5, lineHeight: 16 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: { flexGrow: 1, minWidth: 130 },
  pressed: { opacity: 0.76 },
});
