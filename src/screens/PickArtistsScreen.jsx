import { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Image } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore } from "../store";
import { ingestedArtists } from "../seed/ingested";
import Icon from "../components/Icon";
import SheetHeader from "../components/SheetHeader";
import CardGrid from "../components/CardGrid";
import { proxied, isHttp } from "../lib/img";

// Signup taste picker — choose the artists you love so the feed and
// recommendations start personal instead of generic. Also reachable from Edit
// profile to tune your picks later.
function ArtistTile({ a, picked, onToggle }) {
  const [failed, setFailed] = useState(false);
  return (
    <Pressable style={[styles.tile, picked && styles.tileOn]} onPress={onToggle}>
      {a.photo && !failed ? (
        <Image source={{ uri: isHttp(a.photo) ? a.photo : a.photo }} style={styles.tileImg} resizeMode="cover" onError={() => setFailed(true)} />
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

export default function PickArtistsScreen({ onDone, onSkip }) {
  const { session, updateProfile } = useStore();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(() => new Set(session?.favoriteArtists || []));
  const query = q.trim().toLowerCase();

  // Popular first (Spotify popularity), then alphabetical — so the grid opens
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

  const save = () => {
    const favoriteArtists = [...picked];
    // fold the picks' genres into the profile so genre affinity works instantly
    const genres = new Set(session?.genres || []);
    favoriteArtists.forEach((n) => { const g = ingestedArtists[n.toLowerCase()]?.genre; if (g) genres.add(g); });
    updateProfile({ favoriteArtists, genres: [...genres] });
    onDone?.();
  };

  return (
    <View style={styles.wrap}>
      <SheetHeader
        title="Pick your artists"
        onClose={onSkip}
        action={{ label: picked.size >= MIN_PICKS ? `Done · ${picked.size}` : `Pick ${MIN_PICKS - picked.size} more`, onPress: save, disabled: picked.size < MIN_PICKS }}
      />
      <Text style={styles.sub}>
        Choose at least {MIN_PICKS} artists you love — your feed, recommendations, and events
        get built around them.
      </Text>

      <View style={styles.field}>
        <Icon name="search" size={17} color={colors.textDim} />
        <TextInput
          style={styles.input}
          placeholder={`Search ${all.length.toLocaleString()} artists`}
          placeholderTextColor={colors.textFaint}
          value={q}
          onChangeText={setQ}
          autoCapitalize="none"
          maxLength={80}
        />
        {!!q && <Pressable onPress={() => setQ("")} hitSlop={8}><Icon name="x" size={15} color={colors.textFaint} /></Pressable>}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {shown.length === 0 && <Text style={styles.empty}>No artists match "{q}".</Text>}
        <CardGrid minColWidth={220} gap={10}>
          {shown.map((a) => (
            <ArtistTile key={a.name} a={a} picked={picked.has(a.name)} onToggle={() => toggle(a.name)} />
          ))}
        </CardGrid>
        {!query && all.length > 60 && (
          <Text style={styles.moreHint}>Showing the {Math.min(60, all.length)} most popular — search to find anyone.</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  sub: { color: colors.textDim, fontSize: 13.5, lineHeight: 20, paddingHorizontal: 16, paddingTop: 12 },
  field: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, marginHorizontal: 16, marginTop: 12 },
  input: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 11 },
  content: { padding: 16, paddingBottom: 48 },
  empty: { color: colors.textDim, fontSize: 13, fontStyle: "italic" },
  moreHint: { color: colors.textFaint, fontFamily: mono, fontSize: 11, textAlign: "center", marginTop: 16 },

  tile: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.lineSoft, padding: 8 },
  tileOn: { borderColor: colors.amber, backgroundColor: colors.bgElev },
  tileImg: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.surfaceAlt },
  tileFallback: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line },
  tileInitials: { color: colors.amber, fontFamily: mono, fontSize: 14, fontWeight: "800" },
  tileName: { color: colors.text, fontSize: 14, fontWeight: "700" },
  tileGenre: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: colors.amber, borderColor: colors.amber },
});
