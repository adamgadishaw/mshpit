import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, Image, Platform, Alert } from "react-native";
import ScrollView from "../components/PageScrollView";
import * as ImagePicker from "expo-image-picker";
import { colors, radius } from "../theme";
import { useStore } from "../store";
import { useAccountTaskScope } from "../hooks/useAccountTaskScope";
import ScreenHeader from "../components/ScreenHeader";
import Icon from "../components/Icon";
import TapStars from "../components/TapStars";
import Button from "../components/Button";
import { isDurableMediaUrl, reportMediaPickerError, uploadMediaAsset } from "../lib/mediaUpload";
import { postMediaPickerOptions } from "../domain/mediaPickerOptions.mjs";
import { MEDIA_POST_MAX_ATTACHMENTS } from "../domain/mediaUploadPolicy.mjs";
import { createVenueReviewIOSController } from "./venueReviewIOSController.mjs";

export default function VenueReviewScreen({ venueName, onClose, closeGuardRef }) {
  const { session, addVenueReview } = useStore();
  const accountTasks = useAccountTaskScope(session?.id);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState([]);
  const [photosPublic, setPhotosPublic] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [posting, setPosting] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const reviewIOSRef = useRef(null);
  if (Platform.OS === "ios" && !reviewIOSRef.current) {
    reviewIOSRef.current = createVenueReviewIOSController({ accountId: session?.id, venueName, alert: (...args) => Alert.alert(...args) });
  }
  const reviewIOS = reviewIOSRef.current;
  reviewIOS?.update({ accountId: session?.id, venueName }, { rating, text, photos, photosPublic });
  useEffect(() => {
    if (!reviewIOS) return undefined;
    reviewIOS.mount();
    const guard = reviewIOS.guard;
    if (closeGuardRef) closeGuardRef.current = guard;
    return () => {
      reviewIOS.dispose();
      if (closeGuardRef?.current === guard) closeGuardRef.current = null;
    };
  }, [reviewIOS, closeGuardRef]);
  const requestClose = reviewIOS ? () => reviewIOS.close(onClose) : onClose;
  const editRating = (value) => { if (!reviewIOS || reviewIOS.edit({ rating: value })) setRating(value); };
  const editText = (value) => { if (!reviewIOS || reviewIOS.edit({ text: value })) setText(value); };

  const addPhoto = async () => {
    if (uploadingPhotos || posting) return;
    const remaining = Math.max(0, MEDIA_POST_MAX_ATTACHMENTS - photos.length);
    if (!remaining) return;
    const task = reviewIOS ? reviewIOS.begin(accountTasks, session?.id) : accountTasks.begin(session?.id);
    if (!task) return;
    if (reviewIOS) { setUploadingPhotos(true); setReviewError(""); }
    let res;
    try {
      res = await ImagePicker.launchImageLibraryAsync(postMediaPickerOptions({
        platform: Platform.OS,
        remaining,
        allowPhotos: true,
        allowVideos: false,
      }));
    } catch (error) {
      if (task.isCurrent()) reportMediaPickerError(error, "Opening the venue photo library");
      if (reviewIOS && task.isCurrent()) setUploadingPhotos(false);
      task.finish();
      return;
    }
    if (!task.isCurrent() || !res || res.canceled || !res.assets?.length) {
      if (reviewIOS && task.isCurrent()) setUploadingPhotos(false);
      task.finish(); return;
    }
    setUploadingPhotos(true);
    const uploaded = [];
    try {
      for (const asset of res.assets.slice(0, remaining)) {
        if (!task.isCurrent()) break;
        try {
          uploaded.push(await uploadMediaAsset(asset, "venue", { expectedAccountId: task.accountId, signal: task.controller.signal }));
        } catch {
          if (reviewIOS && task.isCurrent()) setReviewError("Some photos could not be uploaded. Your review is still here. Add the missing photos again when you are ready.");
          break;
        }
      }
    } finally {
      if (task.isCurrent()) {
        if (uploaded.length) setPhotos((current) => [...current, ...uploaded].filter(isDurableMediaUrl).slice(0, MEDIA_POST_MAX_ATTACHMENTS));
        setUploadingPhotos(false);
      }
      task.finish();
    }
  };

  const canPost = rating > 0;
  const submitBusy = uploadingPhotos || posting;
  const save = async () => {
    if (!canPost || submitBusy) return;
    const task = reviewIOS ? reviewIOS.begin(accountTasks, session?.id) : accountTasks.begin(session?.id);
    if (!task) return;
    setPosting(true);
    if (reviewIOS) setReviewError("");
    try {
      const result = await addVenueReview(venueName, {
        rating,
        text,
        photos: photos.filter(isDurableMediaUrl),
        photosPublic: photos.length > 0 && photosPublic,
      });
      if (task.isCurrent()) {
        if (reviewIOS ? result?.ok === true : result?.ok !== false) {
          if (reviewIOS) {
            setReviewError("Your review was posted. Use Back to return to the venue.");
            reviewIOS.saved(onClose);
          } else onClose?.();
        } else if (reviewIOS) setReviewError("Your review could not be confirmed. Your choices are kept here. Check the venue before trying Post again to avoid a duplicate.");
      }
    } catch {
      // Never automatically resend an ambiguous write.
      if (reviewIOS && task.isCurrent()) setReviewError("Your review could not be confirmed. Your choices are kept here. Check the venue before trying Post again to avoid a duplicate.");
    } finally {
      if (task.isCurrent()) setPosting(false);
      task.finish();
    }
  };

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker="Review this venue" title={venueName} onBack={requestClose}
        right={
          <Pressable style={[styles.postBtn, reviewIOS && styles.iosPostBtn, (!canPost || submitBusy) && styles.postBtnOff]} onPress={canPost && !submitBusy ? save : undefined} accessibilityRole="button" accessibilityLabel="Post review" accessibilityState={{ disabled: !canPost || submitBusy }}>
            <Text style={[styles.postTxt, reviewIOS && styles.iosPostTxt, (!canPost || submitBusy) && styles.postTxtOff]}>{posting ? "Posting..." : uploadingPhotos ? "Uploading..." : "Post"}</Text>
          </Pressable>
        } />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={reviewIOS ? true : undefined} keyboardDismissMode={reviewIOS ? "interactive" : undefined}>
        <Text style={styles.label}>HOW WAS THE ROOM?</Text>
        <Text style={styles.hint}>Sound, views, staff, crowd - the building, not the band.</Text>
        <TapStars value={rating} onChange={reviewIOS ? editRating : setRating} size={40}
          accessibilityLabel={reviewIOS ? "Venue rating" : undefined} disabled={reviewIOS ? submitBusy : undefined} />

        <Text style={styles.label}>YOUR TAKE</Text>
        <TextInput style={[styles.input, styles.multiline]} value={text} accessibilityLabel={reviewIOS ? "Venue review" : undefined} onChangeText={reviewIOS ? editText : setText} editable={!reviewIOS || !submitBusy} placeholder="Best seats? Worst? Lines, sound, vibe…" placeholderTextColor={colors.textFaint} multiline maxLength={2000} />

        <Text style={styles.label}>PHOTOS <Text style={styles.optional}>· help people picture it</Text></Text>
        <View style={styles.photoRow}>
          {photos.map((uri, i) => (
            <View key={i} style={styles.thumb}>
              <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              <Pressable style={[styles.removeThumb, reviewIOS && styles.iosRemoveThumb]} onPress={() => {
                if (reviewIOS && !reviewIOS.edit({})) return;
                const next = photos.filter((_, idx) => idx !== i);
                reviewIOS?.edit({ photos: next, photosPublic: next.length > 0 && photosPublic });
                setPhotos(next);
                if (!next.length) setPhotosPublic(false);
              }} disabled={submitBusy} accessibilityRole="button" accessibilityLabel={`Remove venue photo ${i + 1}`}>
                <Icon name="x" size={12} color="#fff" />
              </Pressable>
            </View>
          ))}
          {photos.length < MEDIA_POST_MAX_ATTACHMENTS && (
            <Pressable style={[styles.addThumb, reviewIOS && styles.iosAddThumb]} onPress={addPhoto} disabled={submitBusy}
              accessibilityRole={reviewIOS ? "button" : undefined} accessibilityLabel={reviewIOS ? "Add venue photos" : undefined}
              accessibilityState={reviewIOS ? { disabled: submitBusy } : undefined}>
              <Icon name="camera" size={20} color={colors.amber} />
              <Text style={[styles.addThumbTxt, reviewIOS && styles.iosAddThumbTxt]}>{uploadingPhotos ? "Uploading" : "Add"}</Text>
            </Pressable>
          )}
        </View>

        {photos.length > 0 && (
          <Pressable
            style={[styles.consentCard, photosPublic && styles.consentCardOn]}
            onPress={() => { if (!reviewIOS || reviewIOS.edit({ photosPublic: !photosPublic })) setPhotosPublic((value) => !value); }}
            disabled={submitBusy}
            accessibilityRole="checkbox"
            accessibilityLabel="Add these photos to the public venue gallery"
            accessibilityHint="Off by default. Public photos may appear on Mshpit venue pages and search engines."
            accessibilityState={{ checked: photosPublic, disabled: submitBusy }}
          >
            <View style={[styles.checkbox, photosPublic && styles.checkboxOn]}>
              {photosPublic && <Icon name="check" size={14} color="#1A1206" />}
            </View>
            <View style={styles.consentCopy}>
              <Text style={styles.consentTitle}>Add these to the public venue gallery</Text>
              <Text style={styles.consentText}>Optional and off by default. If enabled, these photos may appear on public Mshpit venue pages and crawler-readable concert archives. Your written review posts either way.</Text>
            </View>
          </Pressable>
        )}

        {reviewIOS && !!reviewError && <Text accessibilityRole="alert" style={styles.hint}>{reviewError}</Text>}
        <Button title={posting ? "Posting review..." : uploadingPhotos ? "Uploading photos..." : "Post venue review"} icon="check" onPress={save} disabled={!canPost || submitBusy} style={{ marginTop: 28 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  iosPostBtn: { minWidth: 44, minHeight: 44, maxWidth: 120, alignItems: "center", justifyContent: "center" },
  iosPostTxt: { flexShrink: 1, textAlign: "center" },
  iosRemoveThumb: { width: 44, height: 44, borderRadius: 22 },
  iosAddThumb: { height: "auto", minHeight: 76, padding: 8 },
  iosAddThumbTxt: { textAlign: "center", flexShrink: 1 },
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
  consentCard: { marginTop: 16, flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  consentCardOn: { borderColor: colors.amber },
  checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 1, borderColor: colors.textFaint, alignItems: "center", justifyContent: "center" },
  checkboxOn: { borderColor: colors.amberStrong, backgroundColor: colors.amberStrong },
  consentCopy: { flex: 1 },
  consentTitle: { color: colors.text, fontSize: 14, fontWeight: "800", marginBottom: 4 },
  consentText: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  primary: { backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 15, alignItems: "center", marginTop: 28 },
  primaryTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 1 },
});
