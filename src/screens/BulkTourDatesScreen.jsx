import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore, isArtist } from "../store";
import Icon from "../components/Icon";
import LocationPicker from "../components/LocationPicker";
import DatePicker from "../components/DatePicker";
import SheetHeader from "../components/SheetHeader";
import { createBulkTourSubmissionLifecycle, scheduledTourRelease } from "../domain/bulkTourSubmission.mjs";

const emptyRow = () => ({ venue: "", place: "", date: "", ticketUrl: "" });

export default function BulkTourDatesScreen({ onClose }) {
  const { session, addTourDatesBatch } = useStore();
  const [artist, setArtist] = useState(session?.artistName || "");
  const [rows, setRows] = useState([emptyRow()]);
  const [scheduled, setScheduled] = useState(false);
  const [releaseDate, setReleaseDate] = useState("");
  const [picker, setPicker] = useState(null); // { type, index }
  const [tempDate, setTempDate] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const lifecycleRef = useRef(null);
  if (!lifecycleRef.current) lifecycleRef.current = createBulkTourSubmissionLifecycle();
  const closeTimerRef = useRef(null);
  useEffect(() => {
    lifecycleRef.current.mount();
    return () => {
      lifecycleRef.current.unmount();
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const saving = status === "saving";
  const formLocked = saving || status === "success";
  const closeScreen = () => {
    lifecycleRef.current.invalidate();
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    onClose?.();
  };

  const resetResult = () => {
    lifecycleRef.current.invalidate();
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    setStatus("idle");
    setError("");
  };
  const setRow = (i, patch) => {
    resetResult();
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const addRow = () => {
    resetResult();
    setRows((rs) => (rs.length < 50 ? [...rs, emptyRow()] : rs));
  };
  const removeRow = (i) => { resetResult(); setRows((rs) => (rs.length === 1 ? rs : rs.filter((_, idx) => idx !== i))); };

  const ready = rows.filter((r) => r.venue.trim() && r.place.trim() && r.date);
  const canSave = !formLocked && artist.trim() && ready.length === rows.length && (!scheduled || releaseDate);

  const save = async () => {
    if (!canSave) return;
    const release = scheduled ? scheduledTourRelease(releaseDate) : { ok: true, releaseAt: 0 };
    if (!release.ok) {
      setStatus("error");
      setError(release.error);
      return;
    }
    const submission = lifecycleRef.current.begin();
    setStatus("saving");
    setError("");
    const result = await addTourDatesBatch(
      ready.map((r) => ({
        artist: artist.trim(),
        venue: r.venue.trim(),
        place: r.place.trim(),
        date: r.date,
        ticketUrl: r.ticketUrl.trim(),
      })),
      release.releaseAt,
    );
    if (!lifecycleRef.current.isCurrent(submission)) return;
    if (!result?.ok) {
      setStatus("error");
      setError(result?.error || "Nothing was published. Check every date and try again.");
      return;
    }
    setStatus("success");
    closeTimerRef.current = setTimeout(() => {
      if (lifecycleRef.current.isCurrent(submission)) onClose?.();
    }, 800);
  };

  if (!isArtist(session?.role)) {
    return (
      <View style={styles.wrap}>
        <Header onClose={closeScreen} title="TOUR DATES" />
        <Text style={styles.denied}>Only approved artist accounts can post tour dates.</Text>
      </View>
    );
  }

  // picker overlays
  if (picker?.type === "location") {
    return (
      <LocationPicker
        onClose={() => setPicker(null)}
        onSelect={(place) => {
          setRow(picker.index, { place: place.label });
          setPicker(null);
        }}
      />
    );
  }
  if (picker?.type === "date" || picker?.type === "release") {
    return (
      <View style={styles.wrap}>
        <Header onClose={() => setPicker(null)} title={picker.type === "release" ? "RELEASE DATE" : "SHOW DATE"} backLabel="cancel" />
        <View style={{ padding: 16 }}>
          <DatePicker onChange={setTempDate} />
          <Pressable
            style={styles.primary}
            onPress={() => {
              if (picker.type === "release") setReleaseDate(tempDate);
              else setRow(picker.index, { date: tempDate });
              setPicker(null);
            }}
          >
            <Text style={styles.primaryTxt}>USE THIS DATE</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Header onClose={closeScreen} title="BULK TOUR DATES" leadDisabled={saving} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>ARTIST</Text>
        <TextInput
          style={[styles.input, session?.role === "artist" && styles.locked]}
          value={artist}
          onChangeText={(value) => { resetResult(); setArtist(value); }}
          editable={!formLocked && session?.role !== "artist"}
          placeholder="Artist"
          placeholderTextColor={colors.textFaint}
        />

        <Text style={[styles.label, { marginTop: 22 }]}>DATES · {ready.length} ready</Text>
        {rows.map((r, i) => (
          <View key={i} style={styles.rowCard}>
            <View style={styles.rowHead}>
              <Text style={styles.rowNum}>{String(i + 1).padStart(2, "0")}</Text>
              {rows.length > 1 && (
                <Pressable onPress={() => removeRow(i)} hitSlop={8} disabled={formLocked}>
                  <Icon name="x" size={16} color={colors.textFaint} />
                </Pressable>
              )}
            </View>
            <TextInput style={styles.input} value={r.venue} onChangeText={(v) => setRow(i, { venue: v })} editable={!formLocked} placeholder="Venue name" placeholderTextColor={colors.textFaint} />
            <Pressable style={styles.pick} onPress={() => setPicker({ type: "location", index: i })} disabled={formLocked}>
              <Icon name="pin" size={16} color={colors.amber} />
              <Text style={[styles.pickTxt, !r.place && styles.pickPlaceholder]}>{r.place || "Pick location"}</Text>
              <Icon name="chevron-right" size={16} color={colors.textDim} />
            </Pressable>
            <Pressable style={styles.pick} onPress={() => { setTempDate(r.date); setPicker({ type: "date", index: i }); }} disabled={formLocked}>
              <Icon name="calendar" size={16} color={colors.amber} />
              <Text style={[styles.pickTxt, !r.date && styles.pickPlaceholder]}>{r.date || "Pick date"}</Text>
              <Icon name="chevron-right" size={16} color={colors.textDim} />
            </Pressable>
            <TextInput
              style={styles.input}
              value={r.ticketUrl}
              onChangeText={(value) => setRow(i, { ticketUrl: value })}
              placeholder="Official ticket URL (optional)"
              placeholderTextColor={colors.textFaint}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!formLocked}
            />
          </View>
        ))}

        <Pressable style={[styles.addRow, (formLocked || rows.length >= 50) && styles.disabled]} onPress={addRow} disabled={formLocked || rows.length >= 50}>
          <Icon name="plus" size={16} color={colors.amber} />
          <Text style={styles.addRowTxt}>Add another date</Text>
        </Pressable>

        {/* scheduled release */}
        <Text style={[styles.label, { marginTop: 22 }]}>RELEASE</Text>
        <View style={styles.toggleRow}>
          <Pressable style={[styles.toggle, !scheduled && styles.toggleOn]} onPress={() => { resetResult(); setScheduled(false); }} disabled={formLocked}>
            <Text style={[styles.toggleTxt, !scheduled && styles.toggleTxtOn]}>Publish now</Text>
          </Pressable>
          <Pressable style={[styles.toggle, scheduled && styles.toggleOn]} onPress={() => { resetResult(); setScheduled(true); }} disabled={formLocked}>
            <Icon name="clock" size={14} color={scheduled ? colors.amber : colors.textDim} />
            <Text style={[styles.toggleTxt, scheduled && styles.toggleTxtOn]}>Schedule</Text>
          </Pressable>
        </View>
        {scheduled && (
          <Pressable style={styles.pick} onPress={() => { setTempDate(releaseDate); setPicker({ type: "release" }); }} disabled={formLocked}>
            <Icon name="clock" size={16} color={colors.amber} />
            <Text style={[styles.pickTxt, !releaseDate && styles.pickPlaceholder]}>{releaseDate || "Pick release date"}</Text>
            <Icon name="chevron-right" size={16} color={colors.textDim} />
          </Pressable>
        )}
        <Text style={styles.note}>
          {scheduled
            ? "Choose a future release date. Dates stay private to this artist account and admins until then, then go public automatically."
            : "Dates go public immediately."} Add an official HTTPS ticket link when you have one; Pit never invents a ticket URL.
        </Text>

        {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
        {status === "success" && <Text style={styles.success} accessibilityLiveRegion="polite">All dates were published.</Text>}
        <Pressable
          style={[styles.primary, !canSave && styles.disabled]}
          onPress={save}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel={status === "saving" ? "Publishing tour dates" : "Publish tour dates"}
          accessibilityState={{ disabled: !canSave, busy: status === "saving" }}
        >
          {status === "saving" ? <ActivityIndicator color="#1A1206" /> : (
            <Text style={styles.primaryTxt}>{status === "success" ? "POSTED" : status === "error" ? `RETRY ${ready.length} DATE${ready.length === 1 ? "" : "S"}` : `POST ${ready.length} DATE${ready.length === 1 ? "" : "S"}`}</Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Header({ onClose, title, leadDisabled = false }) {
  const cap = (title || "").charAt(0) + (title || "").slice(1).toLowerCase();
  return <SheetHeader title={cap} onBack={onClose} leadDisabled={leadDisabled} />;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 10 },
  backBtn: { flexDirection: "row", alignItems: "center", width: 64 },
  back: { color: colors.amber, fontSize: 15 },
  topTitle: { color: colors.textFaint, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  content: { padding: 16, paddingBottom: 60 },
  label: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginBottom: 8 },
  input: { backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 8 },
  locked: { opacity: 0.6 },
  rowCard: { backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginBottom: 10 },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  rowNum: { color: colors.amber, fontFamily: mono, fontSize: 13, fontWeight: "800" },
  pick: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 8 },
  pickTxt: { flex: 1, color: colors.text, fontSize: 14 },
  pickPlaceholder: { color: colors.textFaint },
  addRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, borderStyle: "dashed" },
  addRowTxt: { color: colors.amber, fontSize: 14, fontWeight: "600" },
  toggleRow: { flexDirection: "row", gap: 10 },
  toggle: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  toggleOn: { borderColor: colors.amber, backgroundColor: colors.bgElev },
  toggleTxt: { color: colors.textDim, fontSize: 14 },
  toggleTxtOn: { color: colors.amber, fontWeight: "700" },
  note: { color: colors.textFaint, fontSize: 12, lineHeight: 18, marginTop: 12, fontStyle: "italic" },
  primary: { backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 15, alignItems: "center", marginTop: 22 },
  primaryTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 1 },
  disabled: { opacity: 0.4 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19, marginTop: 14 },
  success: { color: colors.good, fontSize: 13, lineHeight: 19, marginTop: 14 },
  denied: { color: colors.textDim, fontSize: 14, padding: 16 },
});
