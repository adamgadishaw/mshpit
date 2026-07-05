import { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Linking, Image, TextInput } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore, isStaff } from "../store";
import { artistMeta } from "../seed/ingested";
import { SONGS, listenUrl } from "../seed/songs";
import Stars from "../components/Stars";
import TapStars from "../components/TapStars";
import RatingSplit from "../components/RatingSplit";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import ScreenHeader from "../components/ScreenHeader";
import SmartImage from "../components/SmartImage";
import { proxied, isHttp } from "../lib/img";
import Svg, { Defs, LinearGradient, Stop, Rect } from "react-native-svg";

const cap = (s) => (s ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : s);

// Album cover from the Cover Art Archive, served via the wsrv.nl image CDN —
// the archive rate-limits direct traffic, while the CDN fetches once and
// edge-caches. Ladder: proxied -> direct -> clean fallback tile.
function AlbumArt({ uri }) {
  const [stage, setStage] = useState(0); // 0 proxy, 1 direct, 2 give up
  if (!uri || stage > 1) {
    return (
      <View style={styles.albumArt}>
        <Icon name="music" size={22} color={colors.amber} />
      </View>
    );
  }
  const src = stage === 0 && isHttp(uri) ? proxied(uri, 300) : uri;
  return <Image source={{ uri: src }} style={styles.albumArtImg} resizeMode="cover" onError={() => setStage((s) => s + 1)} />;
}

// Artist page - the rollup of a band's live reputation across every night,
// plus where to catch them next. Answers "is this band worth seeing?"
export default function ArtistScreen({ artistName, onClose, onOpenShow, onOpenFanClub, onOpenPhotos, onEditArtist }) {
  const { session, artistSummary, albumRating, songRating, rateAlbum, rateSong, loadRating,
    isArtistOwner, artistPostsFor, loadArtistPage, addArtistPost, removeArtistPost,
    artistGallery, removePhoto } = useStore();
  const a = artistSummary(artistName);
  const meta = artistMeta(a.name);
  const gallery = artistGallery(a.name, 5);
  const canModerate = isStaff(session?.role);
  const genre = a.genre !== "—" ? a.genre : cap(meta?.genre) || "—";
  // Real Spotify top tracks when ingested; hand-seeded SONGS as the fallback.
  const spotTracks = (meta?.topTracks || []).map((t, i) => ({ id: "sp_" + i, title: t.title, artist: a.name, album: t.album, url: t.url, preview: t.preview }));
  const songs = spotTracks.length ? spotTracks : SONGS.filter((s) => s.artist.toLowerCase() === a.name.toLowerCase()).slice(0, 8);

  // Artist-owned profile: the band's account can edit its header + post updates.
  const isOwner = isArtistOwner(a.name);
  const bio = a.ownerBio || meta?.bio;
  const bannerUri = a.banner || meta?.photo || null;
  const avatarUser = { avatarUri: a.photo || meta?.photo || null, initials: a.name.slice(0, 2).toUpperCase(), avatarColor: colors.amber };
  const posts = artistPostsFor(a.name);
  const [draft, setDraft] = useState("");

  // Slice 7: hydrate the artist's owner overrides + updates feed, and the server
  // aggregates for each album/song rating shown on the page.
  useEffect(() => { loadArtistPage(a.name); }, [a.name]);
  useEffect(() => {
    (meta?.albums || []).forEach((al) => loadRating("album", a.name, al.title));
    songs.forEach((s) => loadRating("song", a.name, s.title));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.name]);
  const post = () => { if (draft.trim()) { addArtistPost(a.name, draft); setDraft(""); } };

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker="ARTIST" title={a.name} onBack={onClose} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Twitter-style header: banner, then the avatar punches through the
            bottom edge inside a bg-colored ring (the "box"), action on the right. */}
        <View style={styles.banner}>
          {bannerUri ? (
            <SmartImage uri={bannerUri} style={StyleSheet.absoluteFill} contain={false} onPress={() => onOpenPhotos?.(meta?.photos?.length ? meta.photos : bannerUri ? [bannerUri] : [], 0)} />
          ) : (
            <View style={styles.bannerFallback} />
          )}
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <Defs>
              <LinearGradient id="heroFade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0.45" stopColor="#05060A" stopOpacity="0" />
                <Stop offset="1" stopColor="#05060A" stopOpacity="0.9" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroFade)" />
          </Svg>
        </View>

        <View style={styles.headRow}>
          <View style={styles.avatarWrap}>
            <Avatar user={avatarUser} size={84} onPress={() => onOpenPhotos?.(meta?.photos?.length ? meta.photos : a.photo ? [a.photo] : [], 0)} />
          </View>
          {isOwner ? (
            <Pressable style={styles.editBtn} onPress={() => onEditArtist?.(a.name)}>
              <Icon name="edit" size={14} color={colors.amber} />
              <Text style={styles.editTxt}>Edit profile</Text>
            </Pressable>
          ) : (
            <View style={styles.verifiedTag}>
              <Icon name="check" size={12} color={colors.amber} />
              <Text style={styles.verifiedTxt}>VERIFIED ARTIST</Text>
            </View>
          )}
        </View>

        <View style={styles.headInfo}>
          <Text style={styles.heroName}>{a.name}</Text>
          <View style={styles.chipRow}>
            <View style={styles.genreChip}>
              <Text style={styles.genreTxt}>{genre}</Text>
            </View>
            {meta?.status === "dissolved" && (
              <View style={styles.statusChip}>
                <Text style={styles.statusTxt}>DISSOLVED{meta.endYear ? ` · ${meta.endYear}` : ""}</Text>
              </View>
            )}
            {meta?.status === "inactive" && (
              <View style={styles.statusChip}>
                <Text style={styles.statusTxt}>INACTIVE</Text>
              </View>
            )}
          </View>
        </View>

        {/* age / hometown / genre line */}
        {(meta?.hometown || meta?.formed) && (
          <View style={styles.metaLine}>
            {!!meta?.hometown && <Text style={styles.metaItem}><Icon name="pin" size={12} color={colors.textDim} /> {meta.hometown}</Text>}
            {!!meta?.formed && <Text style={styles.metaItem}>· since {meta.formed}</Text>}
            <Text style={styles.metaItem}>· {genre}</Text>
          </View>
        )}

        <View style={styles.repCard}>
          <Text style={styles.repLabel}>LIVE REPUTATION</Text>
          <View style={styles.repRow}>
            <Text style={styles.bigScore}>{a.avgOverall ? a.avgOverall.toFixed(1) : "—"}</Text>
            <View style={{ flex: 1 }}>
              <Stars value={a.avgOverall} size={18} />
              <Text style={styles.repSub}>
                {a.nights.length} night{a.nights.length === 1 ? "" : "s"} logged · {a.totalRatings} ratings
              </Text>
            </View>
          </View>
          {a.nights.length > 0 && (
            <View style={{ marginTop: 14 }}>
              <RatingSplit band={a.avgBand} room={a.avgRoom} />
              <Text style={styles.note}>Averaged across every logged night. Room scores reflect the venues, not the band.</Text>
            </View>
          )}
        </View>

        {/* fan club + listen */}
        <View style={styles.artistActions}>
          <Pressable style={styles.fcBtn} onPress={() => onOpenFanClub?.(a.name)}>
            <Icon name="comment" size={16} color="#1A1206" />
            <Text style={styles.fcTxt}>Fan Club</Text>
          </Pressable>
          <Pressable style={styles.listenBtn} onPress={() => Linking.openURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(a.name)}`)}>
            <Icon name="play" size={15} color={colors.amber} />
            <Text style={styles.listenTxt}>Listen</Text>
          </Pressable>
        </View>

        {/* Updates feed — the band's own posts. Owner enables it in Edit profile;
            when on, the owner gets a composer box and fans see the feed. */}
        {(a.feedEnabled || isOwner) && (
          <>
            <View style={styles.feedHead}>
              <Text style={styles.sectionLabel}>UPDATES{posts.length ? ` · ${posts.length}` : ""}</Text>
              {isOwner && !a.feedEnabled && <Text style={styles.feedOff}>hidden · enable in Edit profile</Text>}
            </View>
            {isOwner && (
              <View style={styles.composer}>
                <TextInput
                  style={styles.composerInput}
                  placeholder="Post an update to your fans…"
                  placeholderTextColor={colors.textFaint}
                  value={draft}
                  onChangeText={setDraft}
                  multiline
                />
                <Pressable style={[styles.postBtn, !draft.trim() && styles.postBtnOff]} onPress={post} disabled={!draft.trim()}>
                  <Icon name="chevron-right" size={18} color="#1A1206" />
                </Pressable>
              </View>
            )}
            {posts.length === 0 && !isOwner && <Text style={styles.empty}>No updates yet.</Text>}
            {posts.map((p) => (
              <View key={p.id} style={styles.postCard}>
                <View style={styles.postTop}>
                  <Avatar user={avatarUser} size={28} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.postName}>{a.name}</Text>
                    <Text style={styles.postTs}>{p.ts}</Text>
                  </View>
                  {isOwner && (
                    <Pressable hitSlop={8} onPress={() => removeArtistPost(a.name, p.id)}>
                      <Icon name="x" size={15} color={colors.textFaint} />
                    </Pressable>
                  )}
                </View>
                <Text style={styles.postText}>{p.text}</Text>
              </View>
            ))}
          </>
        )}

        {!!bio && (
          <>
            <Text style={styles.sectionLabel}>ABOUT</Text>
            <Text style={styles.bio}>{bio}</Text>
          </>
        )}

        {meta?.photos?.length > 1 && (
          <>
            <Text style={styles.sectionLabel}>PHOTOS · {meta.photos.length}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.galleryRow}>
              {meta.photos.map((p, i) => (
                <Pressable key={i} onPress={() => onOpenPhotos?.(meta.photos, i)}>
                  <SmartImage uri={p} style={styles.galleryTile} contain={false} />
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {meta?.albums?.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>RELEASES · {meta.albums.length}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.albumRow}>
              {meta.albums.map((al, i) => {
                const ar = albumRating(a.name, al.title);
                // Honest label even before the art enrichment ran: "Live at…"
                // release-groups are live albums, not studio albums (or tours).
                const kind = al.type === "Album" && /^live\s+(at|in|from|on)\b/i.test(al.title) ? "Live album" : al.type;
                return (
                  <View key={i} style={styles.album}>
                    <Pressable onPress={() => Linking.openURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(a.name + " " + al.title)}`)}>
                      <AlbumArt uri={al.art} />
                    </Pressable>
                    <Text style={styles.albumTitle} numberOfLines={2}>{al.title}</Text>
                    <Text style={styles.albumYear}>{al.year} · {kind}{ar.count > 0 ? `  ${ar.avg.toFixed(1)}★` : ""}</Text>
                    <TapStars value={ar.mine} onChange={(n) => rateAlbum(a.name, al.title, n)} size={13} gap={2} />
                  </View>
                );
              })}
            </ScrollView>
          </>
        )}

        {songs.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>POPULAR SONGS</Text>
            <Text style={styles.bio}>
              {spotTracks.length ? "Their biggest tracks, live from Spotify. Rate the hits — stars show what fans think." : "Rate the hits. Stars show what fans think (real stream data comes later)."}
            </Text>
            {songs.map((s) => {
              const sr = songRating(a.name, s.title);
              return (
                <View key={s.id} style={styles.songRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.songTitle} numberOfLines={1}>{s.title}</Text>
                    {sr.count > 0 ? (
                      <View style={styles.songMeta}><Stars value={sr.avg} size={11} /><Text style={styles.songAvg}>{sr.avg.toFixed(1)} · {sr.count}</Text></View>
                    ) : (
                      <Text style={styles.songMetaEmpty} numberOfLines={1}>{s.album ? s.album : "Tap to rate"}</Text>
                    )}
                  </View>
                  <TapStars value={sr.mine} onChange={(n) => rateSong(a.name, s.title, n)} size={16} gap={3} />
                  <Pressable style={styles.songPlay} onPress={() => Linking.openURL(s.url || listenUrl(s))} hitSlop={8}>
                    <Icon name="play" size={13} color={colors.amber} />
                  </Pressable>
                </View>
              );
            })}
          </>
        )}

        {gallery.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>GALLERY · {gallery.length}</Text>
            <Text style={styles.bio}>Fan shots first, then licensed portraits & live photos. Stays full even when a photo is pulled.</Text>
            <View style={styles.fanGrid}>
              {gallery.map((p, i) => (
                <View key={p.uri || i} style={styles.fanTile}>
                  <Image source={{ uri: p.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  {p.source !== "fan" && !!p.by && (
                    <View style={styles.creditTag}><Text style={styles.creditTxt} numberOfLines={1}>{p.by}</Text></View>
                  )}
                  {canModerate && (
                    <Pressable style={styles.modBtn} hitSlop={6} onPress={() => removePhoto(p.uri)}>
                      <Icon name="x" size={12} color="#fff" />
                    </Pressable>
                  )}
                </View>
              ))}
            </View>
          </>
        )}

        {a.upcoming.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>UPCOMING · {a.upcoming.length}</Text>
            {a.upcoming.map((t) => (
              <View key={t.id} style={styles.upRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.upVenue}>{t.venue}</Text>
                  <Text style={styles.upPlace}>{t.place}</Text>
                  <Text style={styles.upDate}>{t.date}{t.scheduled ? "  · scheduled" : ""}</Text>
                </View>
                {t.soldOut ? (
                  <View style={styles.soldOut}><Text style={styles.soldOutTxt}>SOLD OUT</Text></View>
                ) : (
                  <Pressable style={styles.ticketBtn} onPress={() => Linking.openURL(t.ticketUrl)}>
                    <Icon name="ticket" size={14} color="#1A1206" />
                    <Text style={styles.ticketTxt}>Tickets</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </>
        )}

        <Text style={styles.sectionLabel}>EVERY NIGHT · {a.nights.length}</Text>
        {a.nights.length === 0 && <Text style={styles.empty}>No shows logged yet. Be the first.</Text>}
        {a.nights.map((n) => (
          <Pressable key={n.id} style={styles.nightRow} onPress={() => onOpenShow?.(n)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.nightVenue}>{n.venue}</Text>
              <Text style={styles.nightMeta}>
                {n.city}{n.date !== "aggregate" ? ` · ${n.date}` : " · community avg"}
              </Text>
            </View>
            <View style={styles.scorePill}>
              <Icon name="star" size={11} color={colors.gold} />
              <Text style={styles.scoreTxt}>{n.overall.toFixed(1)}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 10 },
  backBtn: { flexDirection: "row", alignItems: "center", width: 56 },
  back: { color: colors.amber, fontSize: 15 },
  topTitle: { color: colors.textFaint, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  content: { padding: 16, paddingBottom: 48 },
  banner: { height: 168, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surfaceAlt },
  bannerFallback: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.surfaceAlt },
  headRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: -42, paddingLeft: 4 },
  avatarWrap: { borderWidth: 3, borderColor: colors.bg, borderRadius: 48, backgroundColor: colors.bg },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderColor: colors.amber, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8, marginBottom: 4 },
  editTxt: { color: colors.amber, fontSize: 13, fontWeight: "700" },
  verifiedTag: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: colors.amber, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 4 },
  verifiedTxt: { color: colors.amber, fontSize: 9, letterSpacing: 1.2, fontWeight: "800" },
  headInfo: { marginTop: 12 },
  heroName: { color: colors.text, fontSize: 30, fontWeight: "900", letterSpacing: -0.6 },
  chipRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" },
  genreChip: { alignSelf: "flex-start", borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4 },
  genreTxt: { color: colors.amber, fontSize: 11, letterSpacing: 1, fontWeight: "700" },
  statusChip: { alignSelf: "flex-start", borderWidth: 1, borderColor: colors.textFaint, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4 },
  statusTxt: { color: colors.textDim, fontSize: 11, letterSpacing: 1, fontWeight: "800" },

  repCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 18, marginTop: 20 },
  repLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginBottom: 12 },
  repRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  bigScore: { color: colors.gold, fontFamily: mono, fontSize: 44, fontWeight: "800", lineHeight: 46 },
  repSub: { color: colors.textFaint, fontSize: 12, marginTop: 6 },
  note: { color: colors.textFaint, fontSize: 12, lineHeight: 17, marginTop: 12, fontStyle: "italic" },

  sectionLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginTop: 24, marginBottom: 10 },
  feedHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  feedOff: { color: colors.textFaint, fontSize: 11, fontStyle: "italic", marginTop: 14 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 10, marginBottom: 10 },
  composerInput: { flex: 1, color: colors.text, fontSize: 15, paddingHorizontal: 6, paddingVertical: 6, maxHeight: 120 },
  postBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center" },
  postBtnOff: { opacity: 0.4 },
  postCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 8 },
  postTop: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  postName: { color: colors.text, fontSize: 14, fontWeight: "800" },
  postTs: { color: colors.textFaint, fontFamily: mono, fontSize: 11, marginTop: 1 },
  postText: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
  artistActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  fcBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 13, borderBottomWidth: 3, borderBottomColor: "#B65E1F" },
  fcTxt: { color: "#1A1206", fontSize: 14, fontWeight: "800" },
  listenBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingVertical: 13 },
  listenTxt: { color: colors.amber, fontSize: 14, fontWeight: "700" },
  bio: { color: colors.textDim, fontSize: 14, lineHeight: 21 },
  metaLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 12 },
  metaItem: { color: colors.textDim, fontSize: 13 },
  galleryRow: { gap: 10, paddingRight: 16 },
  galleryTile: { width: 140, height: 140, borderRadius: 10 },
  fanGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  fanTile: { width: "31.8%", aspectRatio: 1, borderRadius: 8, overflow: "hidden", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.lineSoft },
  creditTag: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "rgba(5,6,10,0.62)", paddingHorizontal: 5, paddingVertical: 3 },
  creditTxt: { color: "rgba(255,255,255,0.82)", fontSize: 8 },
  modBtn: { position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(214,69,69,0.92)", alignItems: "center", justifyContent: "center" },
  albumRow: { gap: 10, paddingRight: 16 },
  album: { width: 120 },
  albumArt: { width: 120, height: 120, borderRadius: 10, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  albumArtImg: { width: 120, height: 120, borderRadius: 10, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line },
  albumTitle: { color: colors.text, fontSize: 13, fontWeight: "700", marginTop: 6 },
  albumYear: { color: colors.textFaint, fontFamily: mono, fontSize: 11, marginTop: 2, marginBottom: 6 },
  songRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginBottom: 8 },
  songTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  songMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  songAvg: { color: colors.gold, fontFamily: mono, fontSize: 12, fontWeight: "700" },
  songMetaEmpty: { color: colors.textFaint, fontSize: 12, marginTop: 4 },
  songPlay: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", paddingLeft: 2 },
  empty: { color: colors.textDim, fontSize: 13, fontStyle: "italic" },

  upRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 8, gap: 12 },
  upVenue: { color: colors.text, fontSize: 15, fontWeight: "700" },
  upPlace: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  upDate: { color: colors.amber, fontFamily: mono, fontSize: 12, marginTop: 6 },
  ticketBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.amberStrong, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 9 },
  ticketTxt: { color: "#1A1206", fontSize: 13, fontWeight: "800" },
  soldOut: { borderWidth: 1, borderColor: colors.danger, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  soldOutTxt: { color: colors.danger, fontSize: 11, fontWeight: "800", letterSpacing: 1 },

  nightRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 8 },
  nightVenue: { color: colors.text, fontSize: 15, fontWeight: "700" },
  nightMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  scorePill: { flexDirection: "row", alignItems: "center", gap: 4 },
  scoreTxt: { color: colors.gold, fontFamily: mono, fontSize: 14, fontWeight: "700" },
});
