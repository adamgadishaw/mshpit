import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Image, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { colors, radius } from "../theme";
import { useStore } from "../store";
import { GENRES } from "../data";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import LocationPicker from "../components/LocationPicker";
import PickArtistsScreen from "./PickArtistsScreen";
import Button from "../components/Button";
import SheetHeader from "../components/SheetHeader";
import { isDurableMediaUrl, reportMediaPickerError, uploadMediaAsset } from "../lib/mediaUpload";
import {
  profileImagePickerOptions,
  profileImageSelectionHint,
} from "../domain/profileImagePolicy.mjs";

const AVATAR_IMAGE_HINT = profileImageSelectionHint("avatar");
const BANNER_IMAGE_HINT = profileImageSelectionHint("banner");

export default function EditProfileScreen({ onClose }) {
  const { session, users, updateProfile, locationCenter } = useStore();
  const [name, setName] = useState(session?.name || "");
  const [handle, setHandle] = useState(session?.handle || "");
  const cleanHandleInput = (v) => v.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
  const handleTaken = handle.length >= 3 && (users || []).some((u) => u.handle === handle && u.id !== session?.id);
  const handleTooShort = handle.length > 0 && handle.length < 3;
  const handleChanged = handle !== session?.handle;
  const [bio, setBio] = useState(session?.bio || "");
  const [avatarUri, setAvatarUri] = useState(isDurableMediaUrl(session?.avatarUri) ? session.avatarUri : null);
  const [banner, setBanner] = useState(isDurableMediaUrl(session?.banner) ? session.banner : null);
  const [genres, setGenres] = useState(session?.genres || []);
  const [home, setHome] = useState(session?.home || null);
  const [pickingCity, setPickingCity] = useState(false);
  const [pickingArtists, setPickingArtists] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [saving, setSaving] = useState(false);

  if (pickingCity) {
    return (
      <LocationPicker
        onClose={() => setPickingCity(false)}
        onSelect={(place) => {
          setHome(locationCenter(place));
          setPickingCity(false);
        }}
      />
    );
  }

  if (pickingArtists) {
    return (
      <PickArtistsScreen
        showTheme={false}
        onDone={() => setPickingArtists(false)}
        onSkip={() => setPickingArtists(false)}
      />
    );
  }

  const pickPhoto = async () => {
    if (uploadingAvatar || saving) return;
    let res;
    try {
      res = await ImagePicker.launchImageLibraryAsync(profileImagePickerOptions("avatar", { platform: Platform.OS }));
    } catch (error) {
      reportMediaPickerError(error, "Opening the profile photo library");
      return;
    }
    if (!res || res.canceled || !res.assets?.[0]) return;
    setUploadingAvatar(true);
    try {
      setAvatarUri(await uploadMediaAsset(res.assets[0], "avatar"));
    } catch {
      // The upload helper records the themed diagnostic and leaves the existing
      // durable photo untouched.
    } finally {
      setUploadingAvatar(false);
    }
  };
  const pickBanner = async () => {
    if (uploadingBanner || saving) return;
    let res;
    try {
      res = await ImagePicker.launchImageLibraryAsync(profileImagePickerOptions("banner", { platform: Platform.OS }));
    } catch (error) {
      reportMediaPickerError(error, "Opening the banner photo library");
      return;
    }
    if (!res || res.canceled || !res.assets?.[0]) return;
    setUploadingBanner(true);
    try {
      setBanner(await uploadMediaAsset(res.assets[0], "banner"));
    } catch {
      // Keep the editor open with its previous banner when upload fails.
    } finally {
      setUploadingBanner(false);
    }
  };

  const toggleGenre = (g) => setGenres((gs) => (gs.includes(g) ? gs.filter((x) => x !== g) : [...gs, g]));

  const mediaBusy = uploadingAvatar || uploadingBanner;
  const save = async () => {
    if (mediaBusy || saving) return;
    const initials = (name.trim() || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    setSaving(true);
    try {
      const result = await Promise.resolve(updateProfile({
        name: name.trim() || session.name, bio: bio.trim(), avatarUri, banner, genres, initials, home,
        ...(handleChanged && !handleTaken && !handleTooShort ? { handle } : {}),
      }));
      if (result?.ok !== false) onClose?.();
    } catch {
      // The API layer owns user feedback; preserving this screen preserves edits.
    } finally {
      setSaving(false);
    }
  };

  const preview = { ...session, name, avatarUri, initials: (name.trim() || "?").slice(0, 2).toUpperCase() };

  return (
    <View style={styles.wrap}>
      <SheetHeader title="Edit your profile" onClose={onClose} action={{ label: saving ? "Saving..." : mediaBusy ? "Uploading..." : "Save", onPress: save, disabled: mediaBusy || saving }} />

      <ScrollView style={saving ? styles.savingLock : null} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.profileScope}>This is the profile people see for your personal account. Artist page, promotion, and show tools are in Artist HQ.</Text>
        <Pressable
          style={styles.bannerEdit}
          onPress={pickBanner}
          disabled={uploadingBanner || saving}
          accessibilityRole="button"
          accessibilityLabel={banner ? "Change profile banner" : "Add a profile banner"}
          accessibilityHint={BANNER_IMAGE_HINT}
        >
          {banner ? <Image source={{ uri: banner }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
          <View style={styles.bannerOverlay}>
            <Icon name="camera" size={18} color={colors.text} />
            <View>
              <Text style={styles.bannerEditTxt}>{uploadingBanner ? "Uploading..." : banner ? "Change banner" : "Add a banner"}</Text>
              <Text style={styles.bannerFormat}>{BANNER_IMAGE_HINT}</Text>
            </View>
          </View>
        </Pressable>

        <View style={styles.avatarWrap}>
          <Avatar user={preview} size={96} />
          <Pressable
            style={styles.cameraBtn}
            onPress={pickPhoto}
            disabled={uploadingAvatar || saving}
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
            accessibilityHint={AVATAR_IMAGE_HINT}
          >
            <Icon name="camera" size={16} color="#1A1206" />
          </Pressable>
        </View>
        <Pressable
          onPress={pickPhoto}
          disabled={uploadingAvatar || saving}
          accessibilityRole="button"
          accessibilityLabel="Change profile photo"
          accessibilityHint={AVATAR_IMAGE_HINT}
        >
          <Text style={styles.changePhoto}>{uploadingAvatar ? "Uploading photo..." : "Change photo"}</Text>
        </Pressable>
        <Text style={styles.avatarFormat}>{AVATAR_IMAGE_HINT}</Text>

        <Text style={styles.label}>NAME</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={colors.textFaint} maxLength={40} />

        <Text style={styles.label}>USERNAME</Text>
        <View style={[styles.handleRow, handleTaken && styles.handleRowBad, handleChanged && !handleTaken && !handleTooShort && styles.handleRowGood]}>
          <Text style={styles.at}>@</Text>
          <TextInput
            style={styles.handleInput}
            value={handle}
            onChangeText={(v) => setHandle(cleanHandleInput(v))}
            placeholder="username"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
          />
          {handleChanged && !handleTooShort && (
            <Text style={[styles.handleStatus, handleTaken ? styles.bad : styles.good]}>{handleTaken ? "taken" : "available"}</Text>
          )}
        </View>
        <Text style={styles.handleHint}>
          {handleTooShort ? "At least 3 characters." : "Use letters, numbers, or underscores. This is your @username across Mshpit."}
        </Text>

        <Text style={styles.label}>HOME CITY</Text>
        <Pressable style={styles.cityPick} onPress={() => setPickingCity(true)}>
          <Icon name="pin" size={16} color={colors.amber} />
          <Text style={[styles.cityTxt, !home && styles.cityPlaceholder]}>{home?.city || "Pick your city"}</Text>
          <Icon name="chevron-right" size={16} color={colors.textDim} />
        </Pressable>

        <Text style={styles.label}>BIO</Text>
        <TextInput style={[styles.input, styles.multiline]} value={bio} onChangeText={setBio} placeholder="Tell people about yourself" placeholderTextColor={colors.textFaint} multiline maxLength={240} />

        <Text style={styles.label}>FAVORITE ARTISTS</Text>
        <Pressable style={styles.artistsBtn} onPress={() => setPickingArtists(true)}>
          <Icon name="music" size={16} color={colors.amber} />
          <Text style={styles.artistsBtnTxt}>
            {session?.favoriteArtists?.length ? `${session.favoriteArtists.length} selected · used for your feed` : "Pick favorite artists for your feed"}
          </Text>
          <Icon name="chevron-right" size={16} color={colors.textDim} />
        </Pressable>

        <Text style={styles.label}>FAVORITE GENRES</Text>
        <View style={styles.chips}>
          {GENRES.map((g) => {
            const on = genres.includes(g);
            return (
              <Pressable key={g} style={[styles.chip, on && styles.chipOn]} onPress={() => toggleGenre(g)}>
                <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{g}</Text>
              </Pressable>
            );
          })}
        </View>

        <Button title={saving ? "Saving profile..." : mediaBusy ? "Uploading photo..." : "Save profile"} icon="check" onPress={save} disabled={mediaBusy || saving} style={{ marginTop: 28 }} />
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
  content: { padding: 16, paddingBottom: 48, alignItems: "stretch" },
  profileScope: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  bannerEdit: { height: 96, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  bannerOverlay: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(11,14,22,0.4)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill },
  bannerEditTxt: { color: colors.text, fontSize: 13, fontWeight: "600" },
  hint: { color: colors.textDim, fontSize: 12, marginBottom: 10, marginTop: -2 },
  miniLabel: { fontSize: 9, letterSpacing: 1.5, fontWeight: "800", marginBottom: 6 },
  bannerFormat: { color: colors.textDim, fontSize: 10, lineHeight: 14, marginTop: 2 },
  avatarWrap: { alignSelf: "center", marginTop: 12 },
  cameraBtn: { position: "absolute", right: -2, bottom: -2, width: 32, height: 32, borderRadius: 16, backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.bg },
  changePhoto: { color: colors.amber, fontSize: 13, textAlign: "center", marginTop: 10 },
  label: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginBottom: 8, marginTop: 20 },
  input: { backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  avatarFormat: { color: colors.textFaint, fontSize: 11, lineHeight: 16, marginTop: 4, textAlign: "center" },
  multiline: { minHeight: 70, textAlignVertical: "top" },
  handleRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14 },
  handleRowGood: { borderColor: colors.good },
  handleRowBad: { borderColor: colors.danger },
  at: { color: colors.textDim, fontSize: 16, fontWeight: "700", marginRight: 2 },
  handleInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 12 },
  handleStatus: { fontSize: 12, fontWeight: "700" },
  good: { color: colors.good },
  bad: { color: colors.danger },
  handleHint: { color: colors.textFaint, fontSize: 12, marginTop: 6 },
  cityPick: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 13 },
  cityTxt: { flex: 1, color: colors.text, fontSize: 15 },
  cityPlaceholder: { color: colors.textFaint },
  songField: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 13 },
  songFieldTxt: { flex: 1, color: colors.text, fontSize: 14 },
  songFieldEmpty: { color: colors.textFaint },
  artistsBtn: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 13 },
  artistsBtnTxt: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  chipOn: { borderColor: colors.amber, backgroundColor: colors.bgElev },
  chipTxt: { color: colors.textDim, fontSize: 13 },
  chipTxtOn: { color: colors.amber, fontWeight: "700" },
  primary: { backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 15, alignItems: "center", marginTop: 28 },
  primaryTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 1 },
});
