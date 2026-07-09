import { useMemo, useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Linking } from "react-native";
import { colors, mono, radius, roleColor } from "../theme";
import { ratedShows } from "../data";
import { ingestedArtists } from "../seed/ingested";
import { useStore } from "../store";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import Badge from "../components/Badge";

// ---- result rows (shared by every section of the unified dropdown) ----
function PersonRow({ u, following, canFollow, onFollow, onOpen }) {
  const rc = roleColor(u.role);
  return (
    <Pressable style={styles.row} onPress={onOpen}>
      <Avatar user={u} size={36} />
      <View style={{ flex: 1 }}>
        <View style={styles.nameLine}>
          <Text style={styles.rowName} numberOfLines={1}>{u.name}</Text>
          {u.verified && <Badge type="verified" size={15} />}
        </View>
        <Text style={[styles.rowSub, rc && { color: rc, fontWeight: "800" }]} numberOfLines={1}>@{u.handle}{u.home?.city ? ` · ${u.home.city}` : ""}</Text>
      </View>
      {canFollow && (
        <Pressable style={[styles.followBtn, following && styles.followingBtn]} onPress={onFollow} hitSlop={6}>
          <Text style={[styles.followTxt, following && styles.followingTxt]}>{following ? "Following" : "Follow"}</Text>
        </Pressable>
      )}
    </Pressable>
  );
}
function ArtistRow({ name, genre, onPress }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={[styles.dot, { borderColor: colors.amber }]}><Icon name="music" size={14} color={colors.amber} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName} numberOfLines={1}>{name}</Text>
        {!!genre && <Text style={styles.rowSub} numberOfLines={1}>{genre}</Text>}
      </View>
      <Icon name="chevron-right" size={16} color={colors.textDim} />
    </Pressable>
  );
}
function VenueRow({ v, onPress }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={[styles.dot, { borderColor: colors.cool }]}><Icon name="pin" size={14} color={colors.cool} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName} numberOfLines={1}>{v.name}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>{v.place || "—"}</Text>
      </View>
      {v.upcoming > 0 && <View style={styles.pill}><Text style={styles.pillTxt}>{v.upcoming}</Text></View>}
    </Pressable>
  );
}
function EventRow({ t, onOpenArtist, onOpenVenue }) {
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { borderColor: colors.line }]}><Icon name="calendar" size={14} color={colors.amber} /></View>
      <Pressable style={{ flex: 1 }} onPress={() => onOpenArtist?.(t.artist)}>
        <Text style={styles.rowName} numberOfLines={1}>{t.artist}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          <Text style={styles.link} onPress={() => onOpenVenue?.(t.venue)}>{t.venue}</Text> · {t.date}
        </Text>
      </Pressable>
      {t.soldOut
        ? <Text style={styles.soldOut}>SOLD</Text>
        : <Pressable onPress={() => Linking.openURL(t.ticketUrl)} hitSlop={6}><Icon name="external" size={15} color={colors.amber} /></Pressable>}
    </View>
  );
}

// A collapsible-free section: header + rows. Renders nothing when empty.
function Section({ icon, tint, title, count, rows }) {
  if (!rows || rows.length === 0) return null;
  return (
    <View style={styles.section}>
      <View style={styles.secHead}>
        <Icon name={icon} size={13} color={tint} />
        <Text style={styles.secTitle}>{title}</Text>
        <Text style={styles.secCount}>{count}</Text>
      </View>
      {rows}
    </View>
  );
}

export default function SearchScreen({ onOpen, onOpenArtist, onOpenVenue, onOpenFanClub, onOpenProfile }) {
  const { tourDates, searchVenues, artistsAlphabetical, venuesByCity, upcomingEvents, fanClubsDirectory, commentsFor, track,
    users, session, isFollowing, follow, unfollow, searchPeople, loadMembers, memberCount } = useStore();
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const query = q.trim().toLowerCase();

  // Pull the member directory on open + whenever the box is cleared, so people are
  // browsable without knowing a handle. Hitting the server on each keystroke (≥1
  // char) keeps cross-device results fresh; a short debounce avoids spamming it.
  useEffect(() => { loadMembers(); }, []);
  useEffect(() => {
    if (!query) { loadMembers(); return; }
    const id = setTimeout(() => { searchPeople(query); track("search", { q: query }); }, 250);
    return () => clearTimeout(id);
  }, [query]);

  const mine = session?.id;
  const people = useMemo(() => {
    const list = users.filter((u) => u.id !== mine);
    if (!query) return list.slice(0, 24); // browse newest members
    return list.filter((u) => u.name.toLowerCase().includes(query) || u.handle.toLowerCase().includes(query)).slice(0, 30);
  }, [query, users, mine]);

  const artists = useMemo(() => {
    if (!query) return artistsAlphabetical(24).map((a) => ({ name: a.name, genre: a.genre }));
    const map = new Map();
    const add = (name, genre) => { const k = name.toLowerCase(); if (!map.has(k)) map.set(k, { name, genre }); };
    ratedShows.forEach((s) => s.artist.toLowerCase().includes(query) && add(s.artist, s.genre));
    tourDates.forEach((t) => t.artist.toLowerCase().includes(query) && add(t.artist, t.genre));
    Object.values(ingestedArtists).forEach((a) => a.name.toLowerCase().includes(query) && add(a.name, a.genre));
    return [...map.values()].slice(0, 24);
  }, [query, tourDates]);

  const venues = useMemo(() => (query ? searchVenues(query, 24) : []), [query, tourDates]);
  const events = useMemo(() => (query ? tourDates.filter((t) => `${t.artist} ${t.venue} ${t.place || t.city || ""}`.toLowerCase().includes(query)).slice(0, 24) : []), [query, tourDates]);
  const clubs = useMemo(() => {
    if (!query) return [];
    return fanClubsDirectory().filter((c) => c.artist.toLowerCase().includes(query)).slice(0, 12);
  }, [query]);

  const showBrowse = !query;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={[styles.field, focused && styles.fieldFocused]}>
          <Icon name="search" size={18} color={focused ? colors.amber : colors.textDim} />
          <TextInput
            style={styles.input}
            placeholder="Search people, artists, venues, cities"
            placeholderTextColor={colors.textFaint}
            value={q}
            onChangeText={setQ}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            autoCapitalize="none"
            maxLength={80}
          />
          {!!q && <Pressable onPress={() => setQ("")} hitSlop={8}><Icon name="x" size={16} color={colors.textFaint} /></Pressable>}
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {showBrowse && (
          <Text style={styles.browseHint}>
            {memberCount > 0 ? `${memberCount.toLocaleString()} member${memberCount === 1 ? "" : "s"} on Pit` : "Browse members"} · start typing to search everything
          </Text>
        )}

        <Section
          icon="you" tint={colors.gold}
          title={showBrowse ? "MEMBERS" : "PEOPLE"} count={showBrowse && memberCount ? memberCount : people.length}
          rows={people.map((u) => (
            <PersonRow
              key={u.id}
              u={u}
              following={isFollowing(u.id)}
              canFollow={!!session && u.id !== session?.id}
              onFollow={() => (isFollowing(u.id) ? unfollow(u.id) : follow(u.id))}
              onOpen={() => onOpenProfile?.(u.id)}
            />
          ))}
        />

        <Section
          icon="music" tint={colors.amber}
          title={showBrowse ? "ARTISTS TO EXPLORE" : "ARTISTS"} count={artists.length}
          rows={artists.map((a) => <ArtistRow key={a.name} name={a.name} genre={a.genre} onPress={() => onOpenArtist?.(a.name)} />)}
        />

        <Section icon="pin" tint={colors.cool} title="VENUES" count={venues.length}
          rows={venues.map((v) => <VenueRow key={v.name} v={v} onPress={() => onOpenVenue?.(v.name)} />)} />

        <Section icon="calendar" tint={colors.amber} title="EVENTS" count={events.length}
          rows={events.map((t) => <EventRow key={t.id} t={t} onOpenArtist={onOpenArtist} onOpenVenue={onOpenVenue} />)} />

        <Section icon="comment" tint={colors.magenta} title="FAN CLUBS" count={clubs.length}
          rows={clubs.map((c) => (
            <Pressable key={"fc_" + c.artist} style={styles.row} onPress={() => onOpenFanClub?.(c.artist)}>
              <View style={[styles.dot, { borderColor: colors.magenta }]}><Icon name="comment" size={14} color={colors.magenta} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName} numberOfLines={1}>{c.artist} fan club</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{c.members > 0 ? `${c.members} members` : "Be the first to join"}</Text>
              </View>
              <Icon name="chevron-right" size={16} color={colors.textDim} />
            </Pressable>
          ))}
        />

        {!showBrowse && people.length === 0 && artists.length === 0 && venues.length === 0 && events.length === 0 && clubs.length === 0 && (
          <Text style={styles.empty}>No matches for “{q}”.</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  header: { padding: 16, paddingBottom: 12 },
  field: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14 },
  fieldFocused: { borderColor: colors.amber },
  input: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 13 },

  list: { paddingHorizontal: 16, paddingBottom: 32, maxWidth: 640, width: "100%", alignSelf: "center" },
  browseHint: { color: colors.textDim, fontSize: 12, marginBottom: 8, fontWeight: "600" },

  section: { marginBottom: 18 },
  secHead: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 4, paddingBottom: 6, marginBottom: 2, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  secTitle: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "800", flex: 1 },
  secCount: { color: colors.amber, fontFamily: mono, fontSize: 12, fontWeight: "800" },

  row: { flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 4, paddingVertical: 9, borderRadius: radius.sm },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.bgElev, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  rowName: { color: colors.text, fontSize: 14.5, fontWeight: "700" },
  rowSub: { color: colors.textDim, fontSize: 11.5, marginTop: 1 },
  link: { color: colors.text, fontWeight: "700" },
  pill: { backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.amber, borderRadius: radius.pill, minWidth: 22, paddingHorizontal: 7, paddingVertical: 1, alignItems: "center" },
  pillTxt: { color: colors.amber, fontSize: 11, fontWeight: "800" },
  soldOut: { color: colors.danger, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  empty: { color: colors.textDim, fontSize: 13, fontStyle: "italic", padding: 12, textAlign: "center" },
  followBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.amberStrong },
  followTxt: { color: "#1A1206", fontSize: 12.5, fontWeight: "800" },
  followingBtn: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.line },
  followingTxt: { color: colors.textDim },
});
