import { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Image } from "react-native";
import { colors, mono, radius, THEMES, themeKey } from "../theme";
import ThemeSwatch from "../components/ThemeSwatch";
import { useStore } from "../store";
import { ingestedArtists } from "../seed/ingested";
import Icon from "../components/Icon";
import SheetHeader from "../components/SheetHeader";
import CardGrid from "../components/CardGrid";
import { proxied, isHttp } from "../lib/img";

// Signup taste picker, choose the artists you love so the feed and
// recommendations start personal instead of generic. Also reachable from Edit
// profile to tune your picks later.
function ArtistTile({ a, picked, onToggle, disabled = false }) {
  const [failed, setFailed] = useState(false);
  return (
    <Pressable
      style={[styles.tile, picked && styles.tileOn, disabled && styles.disabled]}
      onPress={onToggle}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={`${a.name}${a.genre ? `, ${a.genre}` : ""}`}
      accessibilityState={{ checked: picked, disabled }}
    >
      {a.photo && !failed ? (
        <Image accessible={false} source={{ uri: isHttp(a.photo) ? a.photo : a.photo }} style={styles.tileImg} resizeMode="cover" onError={() => setFailed(true)} />
      ) : (
        <View style={[styles.tileImg, styles.tileFallback]}>
          <Text style={styles.tileInitials}>{a.name.slice(0, 2).toUpperCase()}</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.tileName} numberOfLines={1}>{a.name}</Text>
        {!!a.genre && <Text style={styles.tileGenre} numberOfLines={1}>{a.genre}</Text>}
      </View>
      <View style={[styles.check, picked && styles.checkOn]}>
        {picked && <Icon name="check" size={13} color="#1A1206" strokeWidth={3} />}
      </View>
    </Pressable>
  );
}

const MIN_PICKS = 3;

export default function PickArtistsScreen({ onDone, onSkip, showTheme = true, onRequireVerification }) {
  const { session, updateProfile, chooseTheme } = useStore();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(() => new Set(session?.favoriteArtists || []));
  const [theme, setThemeChoice] = useState(themeKey); // the current/default preset
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const query = q.trim().toLowerCase();
  const needsEmailVerification = session?.emailVerified === false;

  // Popular first (Spotify popularity), then alphabetical, so the grid opens
  // with names people recognize.
  const all = useMemo(() =>
    Object.values(ingestedArtists)
      .filter((a) => a.name)
      .sort((x, y) => (y.popularity || 0) - (x.popularity || 0) || x.name.localeCompare(y.name)),
  []);
  const shown = useMemo(
    () => (query ? all.filter((a) => a.name.toLowerCase().includes(query)) : all.slice(0, 60)),
    [query, all]
  );

  const toggle = (name) =>
    setPicked((p) => { const n = new Set(p); n.has(name) ? n.delete(name) : n.add(name); return n; });

  const save = async () => {
    if (saving) return;
    if (needsEmailVerification) {
      onRequireVerification?.();
      return;
    }
    const favoriteArtists = [...picked];
    // fold the picks' genres into the profile so genre affinity works instantly
    const genres = new Set(session?.genres || []);
    favoriteArtists.forEach((n) => { const g = ingestedArtists[n.toLowerCase()]?.genre; if (g) genres.add(g); });
    setSaving(true);
    setSaveError("");
    try {
      const result = await updateProfile({ favoriteArtists, genres: [...genres] });
      if (result?.ok === false) {
        setSaveError(result?.error || "Your artist picks did not save. Please try again.");
        return;
      }
      // Keep the theme local until the profile mutation succeeds. Applying it
      // earlier reloads this StyleSheet-based app and can discard unsaved picks.
      if (showTheme && theme && theme !== themeKey) await chooseTheme(theme, result?.patch || { favoriteArtists, genres: [...genres] });
      else onDone?.();
    } catch {
      setSaveError("Your artist picks did not save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <SheetHeader
        title="Pick your artists"
        onClose={onSkip}
        action={{ label: saving ? "Saving..." : picked.size >= MIN_PICKS ? needsEmailVerification ? "Confirm to save" : `Done · ${picked.size}` : `Pick ${MIN_PICKS - picked.size} more`, onPress: save, disabled: saving || picked.size < MIN_PICKS }}
      />
      <Text style={styles.sub}>
        Choose at least {MIN_PICKS} artists you love, your feed, recommendations, and events
        get built around them.
      </Text>
      {needsEmailVerification && (
        <View style={styles.verifyNote} accessibilityRole="alert">
          <Icon name="mail" size={16} color={colors.gold} />
          <Text style={styles.verifyNoteText}>Choose now if you like. Confirm your email before saving these picks to your account.</Text>
        </View>
      )}

      <View style={styles.field}>
        <Icon name="search" size={17} color={colors.textDim} />
        <TextInput
          style={styles.input}
          placeholder={`Search ${all.length.toLocaleString()} artists`}
          placeholderTextColor={colors.textFaint}
          value={q}
          onChangeText={setQ}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={80}
          accessibilityRole="search"
          accessibilityLabel="Search artists"
          editable={!saving}
        />
        {!!q && (
          <Pressable
            style={styles.clearSearch}
            onPress={() => setQ("")}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Clear artist search"
            accessibilityState={{ disabled: saving }}
          >
            <Icon name="x" size={15} color={colors.textFaint} />
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {showTheme && (
          <>
            <Text style={styles.themeLabel}>PICK A THEME</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel="Theme">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.themeRow}>
                {THEMES.map((t) => (
                  <ThemeSwatch key={t.key} theme={t} active={t.key === theme} onPress={() => setThemeChoice(t.key)} />
                ))}
              </ScrollView>
            </View>
          </>
        )}

        {shown.length === 0 && <Text style={styles.empty} accessibilityLiveRegion="polite" role="status">No artists match "{q}".</Text>}
        <CardGrid minColWidth={220} gap={10}>
          {shown.map((a) => (
            <ArtistTile key={a.name} a={a} picked={picked.has(a.name)} onToggle={() => toggle(a.name)} disabled={saving} />
          ))}
        </CardGrid>
        {!query && all.length > 60 && (
          <Text style={styles.moreHint}>Showing the {Math.min(60, all.length)} most popular. Search to find anyone.</Text>
        )}
        {!!saveError && <Text style={styles.saveError} accessibilityRole="alert" accessibilityLiveRegion="assertive">{saveError}</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  sub: { color: colors.textDim, fontSize: 13.5, lineHeight: 20, paddingHorizontal: 16, paddingTop: 12 },
  verifyNote: { flexDirection: "row", alignItems: "center", gap: 9, marginHorizontal: 16, marginTop: 12, paddingHorizontal: 13, paddingVertical: 11, borderRadius: radius.md, borderWidth: 1, borderColor: colors.gold, backgroundColor: `${colors.gold}0F` },
  verifyNoteText: { flex: 1, color: colors.text, fontSize: 12, lineHeight: 17 },
  field: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, marginHorizontal: 16, marginTop: 12 },
  input: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 11 },
  clearSearch: { width: 44, height: 44, marginRight: -12, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingBottom: 48 },
  themeLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 11, letterSpacing: 1.5, fontWeight: "800", marginBottom: 10 },
  themeRow: { gap: 10, paddingBottom: 4 },

  empty: { color: colors.textDim, fontSize: 13, fontStyle: "italic", marginTop: 16 },
  moreHint: { color: colors.textFaint, fontFamily: mono, fontSize: 11, textAlign: "center", marginTop: 16 },
  saveError: { color: colors.danger, fontSize: 13, lineHeight: 19, marginTop: 16, textAlign: "center" },
  spotify: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 20, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.good, backgroundColor: "rgba(111,207,151,0.08)" },
  spotifyIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.good, backgroundColor: colors.bgElev },
  spotifyTitle: { color: colors.text, fontSize: 14.5, fontWeight: "800" },
  spotifySub: { color: colors.textDim, fontSize: 11.5, marginTop: 2, lineHeight: 16 },

  tile: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.lineSoft, padding: 8 },
  tileOn: { borderColor: colors.amber, backgroundColor: colors.bgElev },
  tileImg: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.surfaceAlt },
  tileFallback: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line },
  tileInitials: { color: colors.amber, fontFamily: mono, fontSize: 14, fontWeight: "800" },
  tileName: { color: colors.text, fontSize: 14, fontWeight: "700" },
  tileGenre: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: colors.amber, borderColor: colors.amber },
  disabled: { opacity: 0.62 },
});
