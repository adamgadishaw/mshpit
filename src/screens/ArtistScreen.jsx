import { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Linking, Image, TextInput } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore, isStaff } from "../store";
import { artistMeta } from "../seed/ingested";
import { SONGS } from "../seed/songs";
import Stars from "../components/Stars";
import TapStars from "../components/TapStars";
import RatingSplit from "../components/RatingSplit";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import ScreenHeader from "../components/ScreenHeader";
import SmartImage from "../components/SmartImage";
import Badge, { BadgeRow, BadgeChip } from "../components/Badge";
import { proxied, isHttp } from "../lib/img";
import Svg, { Defs, LinearGradient, Stop, Rect } from "react-native-svg";

const cap = (s) => (s ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : s);

// Album cover from the Cover Art Archive, served via the wsrv.nl image CDN -
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
export default function ArtistScreen({ artistName, onClose, onOpenShow, onOpenFanClub, onOpenPhotos, onEditArtist, onPlay, onAddToPlaylist }) {
  const { session, artistSummary, albumRating, songRating, rateAlbum, rateSong, loadRating,
    isArtistOwner, artistPostsFor, loadArtistPage, addArtistPost, removeArtistPost,
    artistGallery, removePhoto, artistBadges, artistRank, remoteArtistMeta, resolveArtist,
    artistDiscography, artistSeenCount, reportTrack } = useStore();
  const a = artistSummary(artistName);
  const badges = artistBadges(a.name);
  const rank = artistRank(a.name);
  // Metadata: bundled catalog first, else the DB catalog (resolved from
  // MusicBrainz on demand if we've never seen this artist, no empty pages).
  const meta = artistMeta(a.name) || remoteArtistMeta(a.name);
  useEffect(() => { if (!artistMeta(a.name) && !remoteArtistMeta(a.name)) resolveArtist(a.name); }, [a.name]);
  const gallery = artistGallery(a.name, 5);
  const canModerate = isStaff(session?.role);
  const genre = a.genre !== "-" ? a.genre : cap(meta?.genre) || "-";
  // Real Spotify top tracks when ingested; hand-seeded SONGS as the fallback.
  const spotTracks = (meta?.topTracks || []).map((t, i) => ({ id: "sp_" + i, title: t.title, artist: a.name, album: t.album, url: t.url, preview: t.preview }));
  const songs = spotTracks.length ? spotTracks : SONGS.filter((s) => s.artist.toLowerCase() === a.name.toLowerCase()).slice(0, 8);
  // Queue for the top player, every track on the page (all playable — the player
  // resolves each to a YouTube video by title, or a Deezer preview), so next/prev
  // walk this artist's songs while you keep browsing.
  const songQueue = songs.filter((s) => s.title).map((s) => ({ kind: "track", url: null, preview: s.preview || null, title: s.title, artist: a.name, art: a.photo || meta?.photo || null }));

  // Artist-owned profile: the band's account can edit its header + post updates.
  const isOwner = isArtistOwner(a.name);
  const bio = a.ownerBio || meta?.bio;
  const bannerUri = a.banner || meta?.photo || null;
  const avatarUser = { avatarUri: a.photo || meta?.photo || null, initials: a.name.slice(0, 2).toUpperCase(), avatarColor: colors.amber };
  const posts = artistPostsFor(a.name);
  const [draft, setDraft] = useState("");

  // Full discography (albums + tracklists) from Deezer, so the page has real depth:
  // open an album, see every song, rate them, play them in the top bar.
  // "You've been in the pit with them N times" - the viewer's own show count
  // for this artist, from their logged posts.
  const [seen, setSeen] = useState(null);
  useEffect(() => {
    let ok = true;
    setSeen(null);
    if (session) artistSeenCount(a.name).then((r) => { if (ok) setSeen(r); });
    return () => { ok = false; };
  }, [a.name, session?.id]);

  // Wrong-version reporting: any listener can flag a song whose video is the
  // wrong version and optionally paste the correct YouTube link.
  const [reportingSong, setReportingSong] = useState(null);
  const [reportUrl, setReportUrl] = useState("");
  const [reportedSongs, setReportedSongs] = useState({});
  const submitSongReport = async (title) => {
    const r = await reportTrack({ title, artist: a.name, url: reportUrl.trim() || undefined });
    if (r.ok) { setReportedSongs((m) => ({ ...m, [title]: true })); setReportingSong(null); setReportUrl(""); }
  };
  // One report box shared by EVERY song row on the page (popular songs and
  // album tracklists alike), keyed by title.
  const renderReportBox = (title) => (
    <View style={styles.songReportBox}>
      {reportedSongs[title] ? (
        <Text style={styles.songReportDone}>Reported. A moderator will pin the right video.</Text>
      ) : (
        <>
          <Text style={styles.songReportLabel}>Wrong version playing? Paste the correct YouTube link if you have it, or just send the report.</Text>
          <TextInput
            style={styles.songReportInput}
            placeholder="https://youtube.com/watch?v=... (optional)"
            placeholderTextColor={colors.textFaint}
            value={reportUrl}
            onChangeText={setReportUrl}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.songReportActions}>
            <Pressable style={styles.songReportBtn} onPress={() => submitSongReport(title)} accessibilityRole="button">
              <Text style={styles.songReportBtnTxt}>Send report</Text>
            </Pressable>
            <Pressable onPress={() => setReportingSong(null)} hitSlop={8}><Text style={styles.songReportCancel}>Cancel</Text></Pressable>
          </View>
        </>
      )}
    </View>
  );
  const toggleReportBox = (title) => { setReportingSong((cur) => (cur === title ? null : title)); setReportUrl(""); };

  const [disco, setDisco] = useState(null);
  const [openAlbum, setOpenAlbum] = useState(null);
  useEffect(() => { setDisco(null); setOpenAlbum(null); artistDiscography(a.name).then(setDisco); }, [a.name]);
  const toggleAlbum = (id, tracks) => {
    setOpenAlbum((cur) => (cur === id ? null : id));
    (tracks || []).forEach((t) => loadRating("song", a.name, t.title));
  };
  const playTrack = (t, cover) => {
    // Every track is playable: the top player resolves it to a YouTube video by
    // title/artist, or a Deezer 30s preview mp3 when there's no match.
    const known = songQueue.find((s) => s.title === t.title);
    const preview = t.preview || known?.preview || null;
    onPlay?.({ kind: "track", title: t.title, artist: a.name, url: null, preview, art: cover || a.photo || meta?.photo || null }, songQueue.length ? songQueue : undefined);
  };
  // Listen = play a random song from this artist's catalog, with the rest queued up
  // (the player then keeps going with genre-matched recommendations).
  const playRandom = () => {
    if (songQueue.length) {
      const shuffled = [...songQueue].sort(() => Math.random() - 0.5);
      onPlay?.(shuffled[0], shuffled);
    } else {
      // No listed songs yet: let the player find the artist on YouTube by name.
      onPlay?.({ kind: "track", title: a.name, artist: a.name, art: a.photo || meta?.photo || null });
    }
  };
  const addSong = (t) => onAddToPlaylist?.({ title: t.title, artist: a.name, url: t.url || null, preview: t.preview || null, art: t.art || a.photo || meta?.photo || null });

  // Play a single top-track (its own song, then genre-matched recs continue).
  const playSingle = (s) => {
    onPlay?.({ kind: "track", url: null, preview: s.preview || null, title: s.title, artist: a.name, art: a.photo || meta?.photo || null }, songQueue);
  };
  // Play an album AS AN ALBUM: in track order (optionally starting mid-album), or
  // shuffled. Recs append after the last track, so shuffle "kicks in" when it ends.
  const albumTrack = (t, al) => ({ kind: "track", title: t.title, artist: a.name, preview: t.preview || null, art: al.cover || a.photo || meta?.photo || null });
  const playAlbum = (al, startTitle = null, shuffle = false) => {
    let tracks = (al.tracks || []).map((t) => albumTrack(t, al)).filter((t) => t.title);
    if (!tracks.length) return;
    if (shuffle) tracks = [...tracks].sort(() => Math.random() - 0.5);
    else if (startTitle) { const i = tracks.findIndex((t) => t.title === startTitle); if (i > 0) tracks = tracks.slice(i); }
    onPlay?.(tracks[0], tracks);
  };
  // Highest community-rated track on an album (needs ≥1 rating) — the "start here" flag.
  const topTrackOf = (al) => {
    let best = null;
    for (const t of al.tracks || []) { const r = songRating(a.name, t.title); if (r.count > 0 && (!best || r.avg > best.avg)) best = { title: t.title, avg: r.avg, count: r.count }; }
    return best;
  };
  // The artist's standout song: highest-rated popular track, else the top track.
  const topSong = (() => {
    let best = null;
    for (const s of songs) { const r = songRating(a.name, s.title); if (r.count > 0 && (!best || r.avg > best.avg)) best = { song: s, avg: r.avg, count: r.count }; }
    if (best) return best;
    const first = songs.find((s) => s.url || s.preview);
    return first ? { song: first, avg: 0, count: 0 } : null;
  })();
  // A resolved-but-empty artist (no photo, no songs). Show a "coming soon" note
  // and log the interest so an admin can seed it (see the admin Catalog tab).
  const thin = !!meta && !meta.photo && !(meta.topTracks && meta.topTracks.length) && !(disco && disco.albums && disco.albums.length);

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
          <Svg style={[StyleSheet.absoluteFill, styles.noPointerEvents]}>
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
          ) : badges.length ? (
            <View style={styles.badgeChips}>
              {badges.includes("verified") && <BadgeChip type="verified" label="VERIFIED" />}
              {badges.includes("top100") && <BadgeChip type="top100" label={rank && rank <= 100 ? `TOP 100 · #${rank}` : "TOP 100"} />}
            </View>
          ) : null}
        </View>

        <View style={styles.headInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.heroName}>{a.name}</Text>
            {badges.length ? <BadgeRow badges={badges} size={20} style={styles.nameBadges} /> : null}
          </View>
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

        {thin && !isOwner && (
          <View style={styles.comingSoon}>
            <Icon name="clock" size={16} color={colors.amber} />
            <View style={{ flex: 1 }}>
              <Text style={styles.comingSoonTitle}>We're adding this artist</Text>
              <Text style={styles.comingSoonSub}>Photos and songs are on the way. Your reviews still count and will show here.</Text>
            </View>
          </View>
        )}

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
            <Text style={styles.bigScore}>{a.avgOverall ? a.avgOverall.toFixed(1) : "-"}</Text>
            <View style={{ flex: 1 }}>
              <Stars value={a.avgOverall} size={18} />
              <Text style={styles.repSub}>
                {a.nights.length} night{a.nights.length === 1 ? "" : "s"} logged · {a.totalRatings} ratings
              </Text>
            </View>
          </View>
          {session && seen?.count > 0 && (
            <View style={styles.seenChip} accessibilityLabel={`You have seen ${a.name} live ${seen.count} ${seen.count === 1 ? "time" : "times"}`}>
              <Icon name="check" size={13} color={colors.good} />
              <Text style={styles.seenChipTxt}>
                You've been in the pit with them {seen.count === 1 ? "once" : seen.count === 2 ? "twice" : `${seen.count} times`}{seen.last ? ` · last ${seen.last}` : ""}
              </Text>
            </View>
          )}
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
          <Pressable style={styles.listenBtn} onPress={playRandom}>
            <Icon name="play" size={15} color={colors.amber} />
            <Text style={styles.listenTxt}>Listen</Text>
          </Pressable>
        </View>

        {/* Top song — a "start here" pick beside the profile, one tap to play. */}
        {topSong && (
          <Pressable style={styles.topSong} onPress={() => playSingle(topSong.song)} accessibilityRole="button" accessibilityLabel={`Play top song ${topSong.song.title}`}>
            <View style={styles.topSongPlay}><Icon name="play" size={16} color="#1A1206" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.topSongKicker}>TOP SONG{topSong.count > 0 ? ` · ${topSong.avg.toFixed(1)}★ (${topSong.count})` : ""}</Text>
              <Text style={styles.topSongTitle} numberOfLines={1}>{topSong.song.title}</Text>
            </View>
            <Icon name="chevron-right" size={16} color={colors.textDim} />
          </Pressable>
        )}

        {/* Updates feed, the band's own posts. Owner enables it in Edit profile;
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

        {/* Upcoming shows first, this is a live-music app, gigs lead. */}
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

        {/* Then what people said, reviews of every night, fan-first. */}
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

        {/* Fan photos/media next. */}
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

        {!!bio && (
          <>
            <Text style={styles.sectionLabel}>ABOUT</Text>
            <Text style={styles.bio}>{bio}</Text>
          </>
        )}

        {disco?.albums?.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>DISCOGRAPHY · {disco.albums.length}</Text>
            <Text style={styles.bio}>Every album. Open one to see the tracklist, rate songs, and play them in the top bar.</Text>
            <Text style={styles.bio}>Tap a song to play the album from there in order; shuffle takes over when it ends. ★ marks the fan-favorite to start with.</Text>
            {disco.albums.map((al) => {
              const ar = albumRating(a.name, al.title);
              const open = openAlbum === al.id;
              const playable = (al.tracks || []).some((t) => t.preview);
              const top = topTrackOf(al);
              return (
                <View key={al.id} style={styles.discAlbum}>
                  <View style={styles.discHead}>
                    <Pressable style={styles.discHeadMain} onPress={() => toggleAlbum(al.id, al.tracks)}>
                      {al.cover ? <Image source={{ uri: al.cover }} style={styles.discCover} /> : <View style={[styles.discCover, styles.discCoverEmpty]}><Icon name="music" size={16} color={colors.textFaint} /></View>}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.discTitle} numberOfLines={1}>{al.title}</Text>
                        <Text style={styles.discSub}>{al.year || ""}{al.tracks?.length ? ` · ${al.tracks.length} songs` : ""}{ar.count > 0 ? ` · ${ar.avg.toFixed(1)}★` : ""}</Text>
                        <TapStars value={ar.mine} onChange={(n) => rateAlbum(a.name, al.title, n)} size={13} gap={2} />
                      </View>
                    </Pressable>
                    {playable && (
                      <>
                        <Pressable style={styles.albAct} onPress={() => playAlbum(al, null, true)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Shuffle ${al.title}`}>
                          <Icon name="shuffle" size={15} color={colors.textDim} />
                        </Pressable>
                        <Pressable style={styles.albPlay} onPress={() => playAlbum(al)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Play album ${al.title} in order`}>
                          <Icon name="play" size={14} color="#1A1206" />
                        </Pressable>
                      </>
                    )}
                    <Pressable style={styles.albAct} onPress={() => toggleAlbum(al.id, al.tracks)} hitSlop={6}><Icon name={open ? "chevron-down" : "chevron-right"} size={16} color={colors.textDim} /></Pressable>
                  </View>
                  {open && (al.tracks || []).map((t, ti) => {
                    const sr = songRating(a.name, t.title);
                    const isTop = top && top.title === t.title;
                    return (
                      <View key={ti}>
                        <View style={styles.discTrack}>
                          <Pressable style={styles.discTrackMain} onPress={() => (t.preview ? playAlbum(al, t.title) : playTrack(t, al.cover))} accessibilityRole="button" accessibilityLabel={`Play ${t.title} from here`}>
                            <Text style={styles.discTrackNo}>{ti + 1}</Text>
                            <View style={{ flex: 1 }}>
                              <View style={styles.discTrackTitleRow}>
                                {isTop && <Icon name="star" size={11} color={colors.gold} filled />}
                                <Text style={styles.discTrackTitle} numberOfLines={1}>{t.title}</Text>
                              </View>
                              {sr.count > 0 && <View style={styles.songMeta}><Stars value={sr.avg} size={10} /><Text style={styles.songAvg}>{sr.avg.toFixed(1)} · {sr.count}</Text></View>}
                            </View>
                          </Pressable>
                          <TapStars value={sr.mine} onChange={(n) => rateSong(a.name, t.title, n)} size={15} gap={2} />
                          {session && (
                            <Pressable style={styles.songAdd} onPress={() => toggleReportBox(t.title)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Report the wrong video playing for ${t.title}`}>
                              <Icon name="flag" size={12} color={reportedSongs[t.title] ? colors.good : colors.textFaint} />
                            </Pressable>
                          )}
                          {onAddToPlaylist && (
                            <Pressable style={styles.songAdd} onPress={() => addSong({ title: t.title, preview: t.preview, art: al.cover })} hitSlop={8}>
                              <Icon name="plus" size={13} color={colors.textDim} />
                            </Pressable>
                          )}
                          <Pressable style={styles.songPlay} onPress={() => playTrack(t, al.cover)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Play ${t.title} as a single`}>
                            <Icon name="play" size={13} color={colors.amber} />
                          </Pressable>
                        </View>
                        {reportingSong === t.title && renderReportBox(t.title)}
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </>
        ) : meta?.albums?.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>RELEASES · {meta.albums.length}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.albumRow}>
              {meta.albums.map((al, i) => {
                const ar = albumRating(a.name, al.title);
                const kind = al.type === "Album" && /^live\s+(at|in|from|on)\b/i.test(al.title) ? "Live album" : al.type;
                return (
                  <View key={i} style={styles.album}>
                    <AlbumArt uri={al.art} />
                    <Text style={styles.albumTitle} numberOfLines={2}>{al.title}</Text>
                    <Text style={styles.albumYear}>{al.year} · {kind}{ar.count > 0 ? `  ${ar.avg.toFixed(1)}★` : ""}</Text>
                    <TapStars value={ar.mine} onChange={(n) => rateAlbum(a.name, al.title, n)} size={13} gap={2} />
                  </View>
                );
              })}
            </ScrollView>
          </>
        ) : null}

        {songs.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>POPULAR SONGS</Text>
            <Text style={styles.bio}>
              {spotTracks.length ? "Their biggest tracks. Tap to play, rate the hits, stars show what fans think." : "Rate the hits. Stars show what fans think (real stream data comes later)."}
            </Text>
            {songs.map((s) => {
              const sr = songRating(a.name, s.title);
              const reported = !!reportedSongs[s.title];
              return (
                <View key={s.id}>
                  <View style={styles.songRow}>
                    <Pressable style={styles.songMain} onPress={() => playSingle(s)} accessibilityRole="button" accessibilityLabel={`Play ${s.title}`}>
                      <Text style={styles.songTitle} numberOfLines={1}>{s.title}</Text>
                      {sr.count > 0 ? (
                        <View style={styles.songMeta}><Stars value={sr.avg} size={11} /><Text style={styles.songAvg}>{sr.avg.toFixed(1)} · {sr.count}</Text></View>
                      ) : (
                        <Text style={styles.songMetaEmpty} numberOfLines={1}>{s.album ? s.album : "Tap to play · rate below"}</Text>
                      )}
                    </Pressable>
                    <TapStars value={sr.mine} onChange={(n) => rateSong(a.name, s.title, n)} size={16} gap={3} />
                    {session && (
                      <Pressable style={styles.songAdd} onPress={() => toggleReportBox(s.title)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Report the wrong video playing for ${s.title}`}>
                        <Icon name="flag" size={12} color={reported ? colors.good : colors.textFaint} />
                      </Pressable>
                    )}
                    {onAddToPlaylist && (
                      <Pressable style={styles.songAdd} onPress={() => addSong(s)} hitSlop={8}>
                        <Icon name="plus" size={13} color={colors.textDim} />
                      </Pressable>
                    )}
                    <Pressable style={styles.songPlay} onPress={() => playSingle(s)} hitSlop={8}>
                      <Icon name="play" size={13} color={colors.amber} />
                    </Pressable>
                  </View>
                  {reportingSong === s.title && renderReportBox(s.title)}
                </View>
              );
            })}
          </>
        )}

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  noPointerEvents: { pointerEvents: "none" },
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
  badgeChips: { alignItems: "flex-end", gap: 6, marginBottom: 4 },
  headInfo: { marginTop: 12 },
  nameRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
  nameBadges: { marginTop: 4 },
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
  discAlbum: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, marginBottom: 8, overflow: "hidden" },
  discHead: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10 },
  discHeadMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  albAct: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  albPlay: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.amberStrong, paddingLeft: 2 },
  discCover: { width: 54, height: 54, borderRadius: 8, backgroundColor: colors.surfaceAlt },
  discCoverEmpty: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line },
  discTitle: { color: colors.text, fontSize: 14.5, fontWeight: "800" },
  discSub: { color: colors.textDim, fontFamily: mono, fontSize: 11, marginTop: 2, marginBottom: 4 },
  discTrack: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  discTrackMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  discTrackNo: { color: colors.textFaint, fontFamily: mono, fontSize: 12, width: 20, textAlign: "center" },
  discTrackTitleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  discTrackTitle: { color: colors.text, fontSize: 13.5, fontWeight: "600" },
  comingSoon: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 16, marginTop: 12, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, backgroundColor: "rgba(242,166,90,0.08)" },
  comingSoonTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  comingSoonSub: { color: colors.textDim, fontSize: 11.5, marginTop: 2, lineHeight: 16 },
  songRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginBottom: 8 },
  seenChip: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6, marginTop: 12, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.good, backgroundColor: "rgba(111,207,151,0.08)" },
  seenChipTxt: { color: colors.good, fontSize: 12, fontWeight: "700" },
  songReportBox: { backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginTop: -4, marginBottom: 8 },
  songReportLabel: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  songReportInput: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, color: colors.text, fontSize: 13, paddingHorizontal: 10, paddingVertical: 8 },
  songReportActions: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 10 },
  songReportBtn: { backgroundColor: colors.amberStrong, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  songReportBtnTxt: { color: "#1A1206", fontSize: 12.5, fontWeight: "800" },
  songReportCancel: { color: colors.textDim, fontSize: 12.5 },
  songReportDone: { color: colors.good, fontSize: 12.5, fontWeight: "700" },
  songMain: { flex: 1 },
  songTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  topSong: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 14, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, backgroundColor: "rgba(242,166,90,0.07)" },
  topSongPlay: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.amberStrong, paddingLeft: 2 },
  topSongKicker: { color: colors.amber, fontFamily: mono, fontSize: 10, letterSpacing: 1.2, fontWeight: "800" },
  topSongTitle: { color: colors.text, fontSize: 15, fontWeight: "800", marginTop: 2 },
  songMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  songAvg: { color: colors.gold, fontFamily: mono, fontSize: 12, fontWeight: "700" },
  songMetaEmpty: { color: colors.textFaint, fontSize: 12, marginTop: 4 },
  songPlay: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", paddingLeft: 2 },
  songAdd: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
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
