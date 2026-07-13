import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Image } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { colors, radius } from "../theme";
import { useStore } from "../store";
import { artistMeta } from "../seed/ingested";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import Button from "../components/Button";
import SheetHeader from "../components/SheetHeader";
import { isDurableMediaUrl, reportMediaPickerError, uploadMediaAsset } from "../lib/mediaUpload";

// The band's own account edits its public artist page: banner, profile photo,
// bio, and whether the Updates feed is enabled. Mirrors EditProfileScreen but
// writes to the artist-profile overrides instead of the user record.
export default function EditArtistProfileScreen({ artistName, onClose }) {
  const { artistSummary, artistProfile, updateArtistProfile, isArtistOwner } = useStore();
  const a = artistSummary(artistName);
  const meta = artistMeta(a.name);
  const prof = artistProfile(a.name);

  const [bio, setBio] = useState(prof.bio ?? meta?.bio ?? "");
  const initialAvatar = prof.avatarUri ?? meta?.photo;
  const initialBanner = prof.banner ?? meta?.photo;
  const [avatarUri, setAvatarUri] = useState(isDurableMediaUrl(initialAvatar) ? initialAvatar : null);
  const [banner, setBanner] = useState(isDurableMediaUrl(initialBanner) ? initialBanner : null);
  const [feedEnabled, setFeedEnabled] = useState(!!prof.feedEnabled);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!isArtistOwner(a.name)) {
    return (
      <View style={styles.wrap}>
        <SheetHeader title="Edit artist" onClose={onClose} />
        <Text style={styles.denied}>Only the verified {a.name} account can edit this page.</Text>
      </View>
    );
  }

  const pickPhoto = async () => {
    if (uploadingAvatar || saving) return;
    let res;
    try {
      res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.6 });
    } catch (error) {
      reportMediaPickerError(error, "Opening the artist profile photo library");
      return;
    }
    if (!res || res.canceled || !res.assets?.[0]) return;
    setUploadingAvatar(true);
    try {
      setAvatarUri(await uploadMediaAsset(res.assets[0], "avatar"));
    } catch {
      // Keep the previous durable photo; the helper records themed feedback.
    } finally {
      setUploadingAvatar(false);
    }
  };
  const pickBanner = async () => {
    if (uploadingBanner || saving) return;
    let res;
    try {
      res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [3, 1], quality: 0.6 });
    } catch (error) {
      reportMediaPickerError(error, "Opening the artist banner photo library");
      return;
    }
    if (!res || res.canceled || !res.assets?.[0]) return;
    setUploadingBanner(true);
    try {
      setBanner(await uploadMediaAsset(res.assets[0], "banner"));
    } catch {
      // Keep this editor open so the owner can retry without losing the bio.
    } finally {
      setUploadingBanner(false);
    }
  };

  const mediaBusy = uploadingAvatar || uploadingBanner;
  const save = async () => {
    if (mediaBusy || saving) return;
    setSaving(true);
    try {
      const result = await updateArtistProfile(a.name, { bio: bio.trim(), avatarUri, banner, feedEnabled });
      if (result?.ok !== false) onClose?.();
    } catch {
      // API diagnostics already explain the failure; preserve the form values.
    } finally {
      setSaving(false);
    }
  };

  const preview = { avatarUri, initials: a.name.slice(0, 2).toUpperCase(), avatarColor: colors.amber };

  return (
    <View style={styles.wrap}>
      <SheetHeader title="Edit artist page" onClose={onClose} action={{ label: saving ? "Saving..." : mediaBusy ? "Uploading..." : "Save", onPress: save, disabled: mediaBusy || saving }} />

      <ScrollView style={saving ? styles.savingLock : null} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable style={styles.bannerEdit} onPress={pickBanner} disabled={uploadingBanner || saving}>
          {banner ? <Image source={{ uri: banner }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
          <View style={styles.bannerOverlay}>
            <Icon name="camera" size={18} color={colors.text} />
            <Text style={styles.bannerEditTxt}>{uploadingBanner ? "Uploading..." : banner ? "Change banner" : "Add a banner"}</Text>
          </View>
        </Pressable>

        <View style={styles.headRow}>
          <View style={styles.avatarWrap}>
            <Avatar user={preview} size={84} />
            <Pressable style={styles.cameraBtn} onPress={pickPhoto} disabled={uploadingAvatar || saving}>
              <Icon name="camera" size={15} color="#1A1206" />
            </Pressable>
          </View>
        </View>
        <Pressable onPress={pickPhoto} disabled={uploadingAvatar || saving}><Text style={styles.changePhoto}>{uploadingAvatar ? "Uploading photo..." : "Change profile photo"}</Text></Pressable>

        <Text style={styles.label}>BIO</Text>
        <TextInput style={[styles.input, styles.multiline]} value={bio} onChangeText={setBio} placeholder="Tell fans who you are" placeholderTextColor={colors.textFaint} multiline />

        <Text style={styles.label}>UPDATES FEED</Text>
        <Pressable style={styles.toggleRow} onPress={() => setFeedEnabled((v) => !v)}>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleTitle}>Enable updates feed</Text>
            <Text style={styles.toggleSub}>Post announcements on your page. Fans see them; only you can post.</Text>
          </View>
          <View style={[styles.switch, feedEnabled && styles.switchOn]}>
            <View style={[styles.knob, feedEnabled && styles.knobOn]} />
          </View>
        </Pressable>

        <Button title={saving ? "Saving artist page..." : mediaBusy ? "Uploading photo..." : "Save artist page"} icon="check" onPress={save} disabled={mediaBusy || saving} style={{ marginTop: 28 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  savingLock: { pointerEvents: "none", opacity: 0.82 },
  wrap: { flex: 1, backgroundColor: colors.bg },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 10 },
  cancel: { color: colors.textDim, fontSize: 15 },
  topTitle: { color: colors.textFaint, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  save: { color: colors.amber, fontSize: 15, fontWeight: "700" },
  denied: { color: colors.textDim, fontSize: 14, textAlign: "center", marginTop: 40, paddingHorizontal: 24, lineHeight: 21 },
  content: { padding: 16, paddingBottom: 48 },
  bannerEdit: { height: 120, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  bannerOverlay: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(11,14,22,0.4)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill },
  bannerEditTxt: { color: colors.text, fontSize: 13, fontWeight: "600" },
  headRow: { marginTop: -42, paddingLeft: 4, flexDirection: "row" },
  avatarWrap: { borderWidth: 3, borderColor: colors.bg, borderRadius: 48, backgroundColor: colors.bg },
  cameraBtn: { position: "absolute", right: -2, bottom: -2, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.bg },
  changePhoto: { color: colors.amber, fontSize: 13, marginTop: 10, marginLeft: 4 },
  label: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginBottom: 8, marginTop: 22 },
  input: { backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  multiline: { minHeight: 90, textAlignVertical: "top" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 14 },
  toggleTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  toggleSub: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: 4 },
  switch: { width: 48, height: 28, borderRadius: 14, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line, padding: 2, justifyContent: "center" },
  switchOn: { backgroundColor: colors.amberStrong, borderColor: colors.amberStrong },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.textDim },
  knobOn: { backgroundColor: "#1A1206", alignSelf: "flex-end" },
});
