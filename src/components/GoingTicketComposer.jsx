import { useMemo, useRef, useState } from "react";
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

export default function GoingTicketComposer({
  event,
  onDismiss,
  onPost,
  tourDateId,
  user,
}) {
  const [note, setNote] = useState("");
  const [shareSeatLocation, setShareSeatLocation] = useState(false);
  const [section, setSection] = useState("");
  const [row, setRow] = useState("");
  const [seat, setSeat] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const mutationRef = useRef(null);
  if (!mutationRef.current || mutationRef.current.tourDateId !== tourDateId) {
    mutationRef.current = {
      tourDateId,
      id: createAttendanceTicketClientMutationId(),
    };
  }
  const clientMutationId = mutationRef.current.id;
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

  const publish = async () => {
    if (posting || !tourDateId) return;
    setPosting(true);
    setError("");
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
    setPosting(false);
    if (result?.ok) {
      onDismiss?.();
      return;
    }
    setError("Couldn't share this ticket right now. Your Going status is still saved.");
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
        <Pressable style={styles.dismiss} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Do not share a Going post">
          <Icon name="x" size={16} color={colors.textDim} />
        </Pressable>
      </View>

      <ConcertTicketCard ticket={ticket} compact accessibilityHint="Preview of your public Going post" />

      <TextInput
        style={styles.note}
        value={note}
        onChangeText={setNote}
        maxLength={500}
        multiline
        placeholder="Add a note (optional)"
        placeholderTextColor={colors.textFaint}
        accessibilityLabel="Optional note for your Going post"
      />

      <Pressable
        style={({ pressed }) => [styles.seatToggle, pressed && styles.pressed]}
        onPress={() => setShareSeatLocation((value) => !value)}
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
          <TextInput style={styles.seatInput} value={section} onChangeText={setSection} maxLength={40} placeholder="Section or general admission" placeholderTextColor={colors.textFaint} accessibilityLabel="Public section or general admission area" />
          <TextInput style={styles.seatInput} value={row} onChangeText={setRow} maxLength={30} placeholder="Row (optional)" placeholderTextColor={colors.textFaint} accessibilityLabel="Public row, optional" />
          <TextInput style={styles.seatInput} value={seat} onChangeText={setSeat} maxLength={30} placeholder="Seat (optional)" placeholderTextColor={colors.textFaint} accessibilityLabel="Public seat, optional" />
        </View>
      ) : null}

      {error ? <Text selectable style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <View style={styles.actions}>
        <Button title="Not now" variant="secondary" small onPress={onDismiss} style={styles.action} disabled={posting} />
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
