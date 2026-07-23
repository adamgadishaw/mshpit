import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Image } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { colors, radius, themeKey, THEMES } from "../theme";
import ThemeSwatch, { themeGridStyle } from "../components/ThemeSwatch";
import { useStore } from "../store";
import { GENRES, cityCoords } from "../data";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import LocationPicker from "../components/LocationPicker";
import SongPicker from "./SongPicker";
import Button from "../components/Button";
import SheetHeader from "../components/SheetHeader";
import { isDurableMediaUrl, reportMediaPickerError, uploadMediaAsset } from "../lib/mediaUpload";

function SongField({ song, color, onPress, onClear }) {
  return (
    <Pressable style={styles.songField} onPress={onPress}>
      <Icon name="music" size={16} color={color} />
      <Text style={[styles.songFieldTxt, !song && styles.songFieldEmpty]} numberOfLines={1}>
        {song ? `${song.title} · ${song.artist}` : "Pick a song"}
      </Text>
      {song ? (
        <Pressable onPress={onClear} hitSlop={8}><Icon name="x" size={15} color={colors.textFaint} /></Pressable>
      ) : (
        <Icon name="chevron-right" size={16} color={colors.textDim} />
      )}
    </Pressable>
  );
}

export default function EditProfileScreen({ onClose, onPickArtists }) {
  const { session, users, updateProfile, chooseTheme } = useStore();
  const isDark = (THEMES.find((t) => t.key === themeKey) || {}).dark;
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
  const [nowPlaying, setNowPlaying] = useState(session?.nowPlaying || null);
  const [treble, setTreble] = useState(session?.treble || null);
  const [bass, setBass] = useState(session?.bass || null);
  const [pickingCity, setPickingCity] = useState(false);
  const [pickingSong, setPickingSong] = useState(null); // 'now' | 'treble' | 'bass'
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [saving, setSaving] = useState(false);

  if (pickingCity) {
    return (
      <LocationPicker
        onClose={() => setPickingCity(false)}
        onSelect={(place) => {
          const c = cityCoords[place.city] || {};
          setHome({ city: place.city, lat: c.lat ?? null, lng: c.lng ?? null });
          setPickingCity(false);
        }}
      />
    );
  }

  if (pickingSong) {
    const setters = { now: setNowPlaying, treble: setTreble, bass: setBass };
    const kick = pickingSong === "now" ? "NOW PLAYING" : pickingSong === "treble" ? "TREBLE · TOP PICK" : "BASS · UNDERDOG";
    return (
      <SongPicker kicker={kick} onClose={() => setPickingSong(null)} onSelect={(s) => { setters[pickingSong]({ title: s.title, artist: s.artist }); setPickingSong(null); }} />
    );
  }

  const pickPhoto = async () => {
    if (uploadingAvatar || saving) return;
    let res;
    try {
      res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.6 });
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
      res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [3, 1], quality: 0.6 });
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
        nowPlaying, treble, bass,
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
      <SheetHeader title="Edit profile" onClose={onClose} action={{ label: saving ? "Saving..." : mediaBusy ? "Uploading..." : "Save", onPress: save, disabled: mediaBusy || saving }} />

      <ScrollView style={saving ? styles.savingLock : null} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable style={styles.bannerEdit} onPress={pickBanner} disabled={uploadingBanner || saving}>
          {banner ? <Image source={{ uri: banner }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
          <View style={styles.bannerOverlay}>
            <Icon name="camera" size={18} color={colors.text} />
            <Text style={styles.bannerEditTxt}>{uploadingBanner ? "Uploading..." : banner ? "Change banner" : "Add a banner"}</Text>
          </View>
        </Pressable>

        <View style={styles.avatarWrap}>
          <Avatar user={preview} size={96} />
          <Pressable style={styles.cameraBtn} onPress={pickPhoto} disabled={uploadingAvatar || saving}>
            <Icon name="camera" size={16} color="#1A1206" />
          </Pressable>
        </View>
        <Pressable onPress={pickPhoto} disabled={uploadingAvatar || saving}>
          <Text style={styles.changePhoto}>{uploadingAvatar ? "Uploading photo..." : "Change photo"}</Text>
        </Pressable>

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
          {handleTooShort ? "At least 3 characters." : "Letters, numbers, and underscores. This is your @ across Pit."}
        </Text>

        <Text style={styles.label}>HOME CITY</Text>
        <Pressable style={styles.cityPick} onPress={() => setPickingCity(true)}>
          <Icon name="pin" size={16} color={colors.amber} />
          <Text style={[styles.cityTxt, !home && styles.cityPlaceholder]}>{home?.city || "Pick your city"}</Text>
          <Icon name="chevron-right" size={16} color={colors.textDim} />
        </Pressable>

        <Text style={styles.label}>BIO</Text>
        <TextInput style={[styles.input, styles.multiline]} value={bio} onChangeText={setBio} placeholder="A line about you" placeholderTextColor={colors.textFaint} multiline maxLength={240} />

        <Text style={styles.label}>NOW PLAYING</Text>
        <SongField song={nowPlaying} color={colors.good} onPress={() => setPickingSong("now")} onClear={() => setNowPlaying(null)} />

        <Text style={styles.label}>TREBLE & BASS</Text>
        <Text style={styles.hint}>Your top pick and your underdog. Pick from the list, no typing.</Text>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.miniLabel, { color: colors.amber }]}>TREBLE</Text>
            <SongField song={treble} color={colors.amber} onPress={() => setPickingSong("treble")} onClear={() => setTreble(null)} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.miniLabel, { color: colors.magenta }]}>BASS</Text>
            <SongField song={bass} color={colors.magenta} onPress={() => setPickingSong("bass")} onClear={() => setBass(null)} />
          </View>
        </View>

        <Text style={styles.label}>APPEARANCE · {THEMES.length} THEMES</Text>
        <View style={styles.themeGrid}>
          {THEMES.map((t) => (
            <ThemeSwatch key={t.key} theme={t} active={t.key === themeKey} onPress={() => chooseTheme(t.key)} showMode />
          ))}
        </View>

        <Text style={styles.label}>YOUR ARTISTS</Text>
        <Pressable style={styles.artistsBtn} onPress={onPickArtists}>
          <Icon name="music" size={16} color={colors.amber} />
          <Text style={styles.artistsBtnTxt}>
            {session?.favoriteArtists?.length ? `${session.favoriteArtists.length} picked · tune your feed` : "Pick artists to personalize your feed"}
          </Text>
          <Icon name="chevron-right" size={16} color={colors.textDim} />
        </Pressable>

        <Text style={styles.label}>PREFERRED GENRES</Text>
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
  bannerEdit: { height: 96, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  bannerOverlay: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(11,14,22,0.4)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill },
  bannerEditTxt: { color: colors.text, fontSize: 13, fontWeight: "600" },
  hint: { color: colors.textDim, fontSize: 12, marginBottom: 10, marginTop: -2 },
  miniLabel: { fontSize: 9, letterSpacing: 1.5, fontWeight: "800", marginBottom: 6 },
  avatarWrap: { alignSelf: "center", marginTop: 12 },
  cameraBtn: { position: "absolute", right: -2, bottom: -2, width: 32, height: 32, borderRadius: 16, backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.bg },
  changePhoto: { color: colors.amber, fontSize: 13, textAlign: "center", marginTop: 10 },
  label: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginBottom: 8, marginTop: 20 },
  input: { backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
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
  themeGrid: themeGridStyle,
  themeRow: { flexDirection: "row", gap: 10 },
  themeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  themeOn: { borderColor: colors.amber, backgroundColor: colors.bgElev },
  themeTxt: { color: colors.textDim, fontSize: 14, fontWeight: "600" },
  themeTxtOn: { color: colors.amber, fontWeight: "800" },
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
