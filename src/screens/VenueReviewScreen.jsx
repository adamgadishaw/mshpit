import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Image } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { colors, radius } from "../theme";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Icon from "../components/Icon";
import TapStars from "../components/TapStars";
import Button from "../components/Button";
import { isDurableMediaUrl, reportMediaPickerError, uploadMediaAsset } from "../lib/mediaUpload";

export default function VenueReviewScreen({ venueName, onClose }) {
  const { addVenueReview } = useStore();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [posting, setPosting] = useState(false);

  const addPhoto = async () => {
    if (uploadingPhotos || posting) return;
    const remaining = Math.max(0, 8 - photos.length);
    if (!remaining) return;
    let res;
    try {
      res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.6, allowsMultipleSelection: true, selectionLimit: Math.min(5, remaining) });
    } catch (error) {
      reportMediaPickerError(error, "Opening the venue photo library");
      return;
    }
    if (!res || res.canceled || !res.assets?.length) return;
    setUploadingPhotos(true);
    const uploaded = [];
    try {
      for (const asset of res.assets.slice(0, remaining)) {
        try {
          uploaded.push(await uploadMediaAsset(asset, "venue"));
        } catch {
          break;
        }
      }
    } finally {
      if (uploaded.length) setPhotos((current) => [...current, ...uploaded].filter(isDurableMediaUrl).slice(0, 8));
      setUploadingPhotos(false);
    }
  };

  const canPost = rating > 0;
  const submitBusy = uploadingPhotos || posting;
  const save = async () => {
    if (!canPost || submitBusy) return;
    setPosting(true);
    try {
      const result = await addVenueReview(venueName, { rating, text, photos: photos.filter(isDurableMediaUrl) });
      if (result?.ok !== false) onClose?.();
    } catch {
      // Keep the review editable; the API layer already logged and displayed it.
    } finally {
      setPosting(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker="REVIEW VENUE" title={venueName} onBack={onClose}
        right={
          <Pressable style={[styles.postBtn, (!canPost || submitBusy) && styles.postBtnOff]} onPress={canPost && !submitBusy ? save : undefined} accessibilityRole="button" accessibilityLabel="Post review" accessibilityState={{ disabled: !canPost || submitBusy }}>
            <Text style={[styles.postTxt, (!canPost || submitBusy) && styles.postTxtOff]}>{posting ? "Posting..." : uploadingPhotos ? "Uploading..." : "Post"}</Text>
          </Pressable>
        } />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>HOW WAS THE ROOM?</Text>
        <Text style={styles.hint}>Sound, views, staff, crowd - the building, not the band.</Text>
        <TapStars value={rating} onChange={setRating} size={40} />

        <Text style={styles.label}>YOUR TAKE</Text>
        <TextInput style={[styles.input, styles.multiline]} value={text} onChangeText={setText} placeholder="Best seats? Worst? Lines, sound, vibe…" placeholderTextColor={colors.textFaint} multiline maxLength={2000} />

        <Text style={styles.label}>PHOTOS <Text style={styles.optional}>· help people picture it</Text></Text>
        <View style={styles.photoRow}>
          {photos.map((uri, i) => (
            <View key={i} style={styles.thumb}>
              <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              <Pressable style={styles.removeThumb} onPress={() => setPhotos((p) => p.filter((_, idx) => idx !== i))} disabled={submitBusy}>
                <Icon name="x" size={12} color="#fff" />
              </Pressable>
            </View>
          ))}
          {photos.length < 8 && (
            <Pressable style={styles.addThumb} onPress={addPhoto} disabled={submitBusy}>
              <Icon name="camera" size={20} color={colors.amber} />
              <Text style={styles.addThumbTxt}>{uploadingPhotos ? "Uploading" : "Add"}</Text>
            </Pressable>
          )}
        </View>

        <Button title={posting ? "Posting review..." : uploadingPhotos ? "Uploading photos..." : "Post venue review"} icon="check" onPress={save} disabled={!canPost || submitBusy} style={{ marginTop: 28 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  postBtn: { backgroundColor: colors.amberStrong, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8 },
  postBtnOff: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  postTxt: { color: "#1A1206", fontSize: 14, fontWeight: "800" },
  postTxtOff: { color: colors.textFaint },
  content: { padding: 16, paddingBottom: 48 },
  label: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginBottom: 8, marginTop: 20 },
  optional: { color: colors.textFaint, fontWeight: "400", letterSpacing: 0 },
  hint: { color: colors.textDim, fontSize: 12, marginBottom: 12, marginTop: -4 },
  stars: { flexDirection: "row", gap: 8 },
  input: { backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  multiline: { minHeight: 100, textAlignVertical: "top" },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  thumb: { width: 76, height: 76, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: colors.line },
  removeThumb: { position: "absolute", top: 3, right: 3, width: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  addThumb: { width: 76, height: 76, borderRadius: 10, borderWidth: 1, borderColor: colors.line, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: colors.surface },
  addThumbTxt: { color: colors.amber, fontSize: 12 },
  primary: { backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 15, alignItems: "center", marginTop: 28 },
  primaryTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 1 },
});
