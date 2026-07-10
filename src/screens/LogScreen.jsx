import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform, Image } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { colors, mono, radius } from "../theme";
import { newId, RATING_DIMS, computeReview } from "../data";
import Icon from "../components/Icon";
import Stars from "../components/Stars";
import TapStars from "../components/TapStars";
import Button from "../components/Button";
import SheetHeader from "../components/SheetHeader";
import DatePicker from "../components/DatePicker";

const GROUP_COLOR = { "THE BAND": colors.amber, "THE ROOM": colors.cool, "THE NIGHT": colors.magenta };
const GROUPS = ["THE BAND", "THE ROOM", "THE NIGHT"];

function Stepper({ label, value, onChange, color }) {
  const step = (d) => onChange(Math.max(0, Math.min(5, Math.round((value + d) * 2) / 2)));
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepLabel}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable style={styles.stepBtn} onPress={() => step(-0.5)} hitSlop={8}>
          <Icon name="minus" size={18} color={colors.text} />
        </Pressable>
        <Text style={[styles.stepVal, { color: value > 0 ? color : colors.textFaint }]}>{value > 0 ? value.toFixed(1) : "-"}</Text>
        <Pressable style={styles.stepBtn} onPress={() => step(0.5)} hitSlop={8}>
          <Icon name="plus" size={18} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

export default function LogScreen({ onPost, onCancel, user, prefill }) {
  const [artist, setArtist] = useState(prefill?.artist || "");
  const [venue, setVenue] = useState(prefill?.venue || "");
  const [city, setCity] = useState(prefill?.city || "");
  const [dims, setDims] = useState({ performance: 0, setlist: 0, sound: 0, venue: 0, crowd: 0, experience: 0 });
  const [review, setReview] = useState("");
  const [photos, setPhotos] = useState([]);
  const [photosPublic, setPhotosPublic] = useState(true);
  // Show date, defaults to today so logging stays one-tap, but you can set the
  // real date of a past show. Years run from this year back to 2000, descending.
  const today = new Date();
  const todayStr = `${today.getFullYear()} · ${String(today.getMonth() + 1).padStart(2, "0")} · ${String(today.getDate()).padStart(2, "0")}`;
  const PAST_YEARS = Array.from({ length: today.getFullYear() - 1999 }, (_, i) => today.getFullYear() - i);
  const [date, setDate] = useState(todayStr);
  const [showDate, setShowDate] = useState(false);

  const addPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.6, allowsMultipleSelection: true, selectionLimit: 6 });
    if (!res.canceled) setPhotos((p) => [...p, ...res.assets.map((a) => a.uri)].slice(0, 8));
  };

  const setDim = (k, v) => setDims((d) => ({ ...d, [k]: v }));
  const computed = computeReview(dims);
  const canPost = artist.trim() && computed.overall > 0;

  const submit = () => {
    onPost({
      id: newId(),
      user: user
        ? { name: user.name, handle: user.handle, initials: user.initials }
        : { name: "You", handle: "you", initials: "YOU" },
      timeAgo: "now",
      artist: artist.trim(),
      venue: venue.trim() || "Unknown venue",
      city: city.trim() || "-",
      date,
      media: photos.length,
      photos,
      photosPublic,
      overall: computed.overall,
      band: computed.band || computed.overall,
      room: computed.room || computed.overall,
      dims,
      review: review.trim(),
      setlist: [],
      likes: 0,
      comments: 0,
      inTourWindow: false,
    });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <SheetHeader title="Log a show" onClose={onCancel} action={{ label: "Post", onPress: submit, disabled: !canPost }} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.fieldLabel}>WHO DID YOU SEE?</Text>
        <TextInput style={styles.input} placeholder="Artist" placeholderTextColor={colors.textFaint} value={artist} onChangeText={setArtist} />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <TextInput style={[styles.input, { flex: 1.4 }]} placeholder="Venue" placeholderTextColor={colors.textFaint} value={venue} onChangeText={setVenue} />
          <TextInput style={[styles.input, { flex: 1 }]} placeholder="City" placeholderTextColor={colors.textFaint} value={city} onChangeText={setCity} />
        </View>

        <Text style={[styles.fieldLabel, { marginTop: 18 }]}>WHEN?</Text>
        <Pressable style={styles.dateBtn} onPress={() => setShowDate((s) => !s)}>
          <Icon name="calendar" size={16} color={colors.amber} />
          <Text style={styles.dateTxt}>{date === todayStr ? "Today" : date}</Text>
          <Icon name={showDate ? "chevron-down" : "chevron-right"} size={16} color={colors.textDim} />
        </Pressable>
        {showDate && (
          <View style={styles.datePickerWrap}>
            <DatePicker years={PAST_YEARS} defaultYear={today.getFullYear()} onChange={setDate} />
          </View>
        )}

        {/* live weighted overall */}
        <View style={styles.overallCard}>
          <Text style={styles.overallNum}>{computed.overall ? computed.overall.toFixed(1) : "-"}</Text>
          <View>
            <Stars value={computed.overall} size={18} />
            <Text style={styles.overallSub}>weighted overall · rate the factors below</Text>
          </View>
        </View>

        {/* six factors - tap the stars, no plus/minus */}
        {GROUPS.map((g) => (
          <View key={g} style={styles.group}>
            <Text style={[styles.groupLabel, { color: GROUP_COLOR[g] }]}>{g}</Text>
            {RATING_DIMS.filter((d) => d.group === g).map((d) => (
              <View key={d.key} style={styles.factorRow}>
                <Text style={styles.factorLabel}>{d.label}</Text>
                <TapStars value={dims[d.key]} onChange={(v) => setDim(d.key, v)} size={26} gap={4} color={GROUP_COLOR[g]} />
              </View>
            ))}
          </View>
        ))}

        <Text style={[styles.fieldLabel, { marginTop: 22 }]}>YOUR REVIEW <Text style={styles.optional}>· the main event</Text></Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          placeholder="What made the night? Be honest - this is what people read."
          placeholderTextColor={colors.textFaint}
          value={review}
          onChangeText={setReview}
          multiline
        />

        <Text style={[styles.fieldLabel, { marginTop: 22 }]}>PHOTOS <Text style={styles.optional}>· optional</Text></Text>
        <View style={styles.photoRow}>
          {photos.map((uri, i) => (
            <View key={i} style={styles.thumb}>
              <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              <Pressable style={styles.removeThumb} onPress={() => setPhotos((p) => p.filter((_, idx) => idx !== i))}>
                <Icon name="x" size={12} color="#fff" />
              </Pressable>
            </View>
          ))}
          {photos.length < 8 && (
            <Pressable style={styles.addThumb} onPress={addPhoto}>
              <Icon name="camera" size={20} color={colors.amber} />
              <Text style={styles.addThumbTxt}>Add</Text>
            </Pressable>
          )}
        </View>

        {photos.length > 0 && (
          <Pressable style={styles.consent} onPress={() => setPhotosPublic((v) => !v)}>
            <View style={[styles.check, photosPublic && styles.checkOn]}>{photosPublic && <Icon name="check" size={13} color="#1A1206" />}</View>
            <Text style={styles.consentTxt}>Let my photos show on the {artist || "artist"}'s page (top ones, by likes). You can change this later.</Text>
          </Pressable>
        )}

        <Button title="Post to feed" icon="check" onPress={submit} disabled={!canPost} style={{ marginTop: 28 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12 },
  cancel: { color: colors.textDim, fontSize: 15 },
  topTitle: { color: colors.textFaint, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  post: { color: colors.amber, fontSize: 15, fontWeight: "700" },
  content: { padding: 16, paddingBottom: 60 },
  fieldLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginBottom: 8 },
  optional: { color: colors.textFaint, fontWeight: "400", letterSpacing: 0 },
  input: { backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 10 },
  dateBtn: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 12 },
  dateTxt: { flex: 1, color: colors.text, fontSize: 15, fontFamily: mono },
  datePickerWrap: { marginTop: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12 },
  multiline: { minHeight: 110, textAlignVertical: "top", fontSize: 16 },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  thumb: { width: 76, height: 76, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: colors.line },
  removeThumb: { position: "absolute", top: 3, right: 3, width: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  addThumb: { width: 76, height: 76, borderRadius: 10, borderWidth: 1, borderColor: colors.line, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: colors.surface },
  addThumbTxt: { color: colors.amber, fontSize: 12 },
  consent: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 12 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkOn: { backgroundColor: colors.amber, borderColor: colors.amber },
  consentTxt: { flex: 1, color: colors.textDim, fontSize: 13, lineHeight: 19 },
  overallCard: { flexDirection: "row", alignItems: "center", gap: 16, backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 16, marginTop: 22 },
  overallNum: { color: colors.gold, fontFamily: mono, fontSize: 40, fontWeight: "800", minWidth: 56 },
  overallSub: { color: colors.textFaint, fontSize: 12, marginTop: 6 },
  group: { marginTop: 18 },
  groupLabel: { fontSize: 10, letterSpacing: 1.5, fontWeight: "800", marginBottom: 10 },
  factorRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  factorLabel: { color: colors.text, fontSize: 14, flex: 1 },
  stepperRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  stepLabel: { color: colors.text, fontSize: 14 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 16 },
  stepBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  stepVal: { fontFamily: mono, fontSize: 17, fontWeight: "700", minWidth: 34, textAlign: "center" },
  bigPost: { marginTop: 28, backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 16, alignItems: "center" },
  bigPostTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 1 },
});
