import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { colors, displayFont, mono, radius, shadow, space } from "../theme";
import Stars from "../components/Stars";
import RatingSplit from "../components/RatingSplit";
import RatingBreakdown from "../components/RatingBreakdown";
import NearbyAfterparty from "../components/NearbyAfterparty";
import Icon from "../components/Icon";
import VenuePhotoWidget from "../components/VenuePhotoWidget";
import ScreenHeader from "../components/ScreenHeader";
import Avatar from "../components/Avatar";
import SmartImage from "../components/SmartImage";
import { useStore } from "../store";
import { showDateMs, fmtCountdown } from "../lib/showTime";
import { formatDate } from "../domain/dates.mjs";
import { api } from "../lib/api";
import { normalizeLoungeMeta, normalizeShowAttendees, showSocialIdentity, showSocialView } from "../domain/showSocial.mjs";
import { attendanceTotalForView, normalizeAttendanceSnapshot } from "../domain/showAttendance.mjs";
import { hasPostDiscussion, showDiscussionCount } from "../domain/showDiscussion.mjs";
import { archiveCoverMedia, archiveReviewMedia } from "../domain/artistEventArchive.mjs";
import { useArtistEventReviews } from "../features/artistEvents/useArtistEventArchive";
import { openTicketLink } from "../lib/ticketLinks";

// The "performance page" - ONE artist, ONE venue, ONE date. This is the night
// itself, not the room (that's the venue page): a ticket-style hero owns the
// top, and the page runs in one of two modes. An UPCOMING night gets a live
// countdown, tickets, Going and the lounge; a night that happened gets the
// community score and the setlist. It must render for ANY event shape - a
// logged review, a bare tour date from the calendar, a lounge link - so every
// field is guarded; a tour date has no score and that's a mode, not a crash.
export default function ShowScreen({ log, onClose, onPreview, onReview, onOpenProfile, onOpenArtist, onOpenArchive, onOpenVenue, onOpenLounge, onOpenPost, onOpenPhotos, onRequireAuth }) {
  const {
    venueCoord, venuePhotos, venuePhotoState, loadVenuePhotos,
    session, concertKey, isGoing, isGoingBusy, toggleGoing, attendeesFor, loungeFor,
  } = useStore();
  // Normalize the shapes this page can be handed: calendar/tour rows carry
  // `place` instead of `venue`, and often no city, score, or setlist.
  const venue = log.venue || log.place || "Venue TBA";
  const city = log.city || (log.place && log.venue ? log.place : "") || "";
  const artist = log.artist || "Unknown artist";
  const overall = typeof log.overall === "number" ? log.overall : null;
  const setlist = Array.isArray(log.setlist) ? log.setlist : [];
  const norm = { ...log, artist, venue, city };
  const discussionCount = showDiscussionCount(log.comments);
  const discussionAvailable = hasPostDiscussion(norm);
  const coord = venueCoord(venue);
  const photos = venuePhotos(venue);
  const photoState = venuePhotoState(venue);
  const key = concertKey(norm);
  const going = isGoing(key);
  const goingBusy = isGoingBusy(key);
  const localAttendees = attendeesFor(key);
  const localLoungeCount = loungeFor(key).length;
  const accountId = session?.id || null;
  const archiveShowKey = log.archiveShowKey || null;
  const archiveCover = archiveCoverMedia(log.cover);
  const {
    resource: archiveReviewResource,
    reload: reloadArchiveReviews,
    loadMore: loadMoreArchiveReviews,
  } = useArtistEventReviews({
    accountId,
    name: artist,
    artistKey: log.artistKey || null,
    showKey: archiveShowKey,
    limit: 20,
    enabled: !!archiveShowKey,
  });
  const archiveReviewData = archiveReviewResource.data || {};
  const archiveReviews = Array.isArray(archiveReviewData.reviews) ? archiveReviewData.reviews : [];
  const [archiveLoadMoreFailed, setArchiveLoadMoreFailed] = useState(false);
  const [socialRead, setSocialRead] = useState(null);
  const social = showSocialView({
    read: socialRead,
    concertKey: key,
    accountId,
    localAttendees,
    localMessageCount: localLoungeCount,
    viewer: session,
    viewerGoing: going,
  });
  const readMatches = socialRead?.identity === showSocialIdentity(key, accountId) && socialRead?.status === "ready";
  const attendeeTotal = attendanceTotalForView({
    total: readMatches ? socialRead.attendeeTotal : undefined,
    serverViewerGoing: readMatches ? socialRead.serverViewerGoing : going,
    viewerGoing: going,
    visibleCount: social.attendees.length,
  });
  const renderedAttendeeCount = Math.min(30, social.attendees.length);
  const hiddenAttendeeCount = Math.max(0, attendeeTotal - renderedAttendeeCount);
  useEffect(() => {
    void loadVenuePhotos(venue).catch(() => {});
  }, [venue]);

  useEffect(() => {
    setArchiveLoadMoreFailed(false);
  }, [archiveShowKey]);

  const loadMoreArchiveReviewsWithFeedback = async () => {
    setArchiveLoadMoreFailed(false);
    const result = await loadMoreArchiveReviews();
    if (result?.status === "error" && Array.isArray(result.data?.reviews) && result.data.reviews.length > 0) {
      setArchiveLoadMoreFailed(true);
    }
  };

  // The store contains only attendance this device already knows about. Read
  // the server's authoritative attendee list and aggregate lounge metadata as
  // soon as the show opens. Identity-keyed state plus abort teardown prevents a
  // late response from a previous show or account from flashing on this one.
  useEffect(() => {
    if (!key) return undefined;
    const controller = new AbortController();
    const identity = showSocialIdentity(key, accountId);
    setSocialRead({ identity, status: "loading", attendees: null, attendeeTotal: null, serverViewerGoing: false, loungeMeta: null });
    Promise.allSettled([
      api(`/api/going/${encodeURIComponent(key)}/attendees`, {
        signal: controller.signal,
        silent: true,
        context: "Loading show attendees",
      }),
      api(`/api/lounges/${encodeURIComponent(key)}/meta`, {
        signal: controller.signal,
        silent: true,
        context: "Loading concert-lounge details",
      }),
    ]).then(([attendeeResult, loungeResult]) => {
      if (controller.signal.aborted) return;
      const attendance = attendeeResult.status === "fulfilled"
        ? normalizeAttendanceSnapshot(attendeeResult.value)
        : null;
      setSocialRead({
        identity,
        status: "ready",
        attendees: attendance ? normalizeShowAttendees(attendance.attendees) : null,
        attendeeTotal: attendance?.total ?? null,
        serverViewerGoing: attendance?.viewerGoing ?? false,
        loungeMeta: loungeResult.status === "fulfilled" ? normalizeLoungeMeta(loungeResult.value) : null,
      });
    });
    return () => controller.abort();
  }, [key, accountId]);

  // Upcoming vs happened decides the whole page. A show with no parseable date
  // but a score is treated as happened; no date and no score reads as upcoming.
  const targetMs = showDateMs(log.date);
  const upcoming = targetMs != null ? targetMs - Date.now() > -86400000 : overall == null;
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!upcoming || targetMs == null) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [upcoming, targetMs]);
  const msLeft = targetMs != null ? targetMs - nowTick : null;

  // Setlists are spoiler-gated while a show sits inside the artist's active tour
  // window: nobody wants the surprise ruined before their own night. Hidden by
  // default, one tap reveals.
  const [revealed, setRevealed] = useState(!log.inTourWindow);
  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker={upcoming ? "UPCOMING PERFORMANCE" : "PERFORMANCE"} title={artist} onBack={onClose} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Ticket-style hero: this is what makes a NIGHT read differently from
            a venue. Artist headline, then a perforated stub strip carrying the
            room + the date, like the ticket you'd have kept. */}
        <View style={styles.ticket}>
          <Text style={styles.ticketKicker}>{upcoming ? "ONE NIGHT · NOT YET PLAYED" : "ONE NIGHT ONLY"}</Text>
          <Pressable
            onPress={() => archiveShowKey ? onOpenArchive?.(artist, log.artistKey || null) : onOpenArtist?.(artist)}
            accessibilityRole="button"
            accessibilityLabel={archiveShowKey ? `Open every recorded ${artist} night` : `Open ${artist}'s profile`}
          >
            <Text style={styles.artist}>{artist}</Text>
            <Text style={styles.artistLink}>View all {artist} nights ›</Text>
          </Pressable>
          <View style={styles.perfWrap}>
            <View style={[styles.notch, { left: -27 }]} />
            <View style={styles.dashed} />
            <View style={[styles.notch, { right: -27 }]} />
          </View>
          <View style={styles.stubRow}>
            <Pressable
              style={{ flex: 1 }}
              onPress={() => onOpenVenue?.(venue)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${venue}'s venue page`}
            >
              <Text style={styles.stubLabel}>THE ROOM</Text>
              <Text style={styles.venueLink} numberOfLines={1}>{venue}</Text>
              {!!city && <Text style={styles.stubCity} numberOfLines={1}>{city}</Text>}
            </Pressable>
            <View style={styles.stubDivider} />
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.stubLabel}>THE DATE</Text>
              <Text style={styles.date}>{formatDate(log.date, log.date || "TBA")}</Text>
              {log.soldOut ? <Text style={styles.soldOut}>SOLD OUT</Text> : null}
            </View>
          </View>
          {upcoming && msLeft != null && (
            <View style={styles.countdownStrip}>
              <Icon name="clock" size={14} color={colors.amber} />
              <Text style={styles.countdownTxt}>{msLeft <= 0 ? "TONIGHT" : fmtCountdown(msLeft)}</Text>
              {msLeft > 0 && <Text style={styles.countdownSub}>until doors</Text>}
            </View>
          )}
        </View>

        {archiveCover ? (
          <View style={styles.archiveHero}>
            <SmartImage
              uri={archiveCover.uri}
              posterUri={archiveCover.posterUri}
              mediaKind={archiveCover.kind}
              style={styles.archiveHeroImage}
              contain={false}
              accessibilityLabel={`Open fan photo from ${artist} at ${venue}`}
              onPress={() => onOpenPhotos?.([archiveCover], 0, archiveCover.postId)}
            />
            <View style={styles.archiveHeroCredit} pointerEvents="none">
              <Text style={styles.archiveHeroCreditText} numberOfLines={1}>FAN COVER · {archiveCover.by}</Text>
            </View>
          </View>
        ) : null}

        <View style={{ marginTop: 16 }}>
          <VenuePhotoWidget
            photos={photos}
            venueName={venue}
            city={city}
            coord={coord}
            loading={photoState.status === "idle" || photoState.status === "loading"}
            error={photoState.status === "error"}
            onRetry={() => { void loadVenuePhotos(venue, { force: true }).catch(() => {}); }}
            onPress={() => onOpenVenue?.(venue)}
          />
        </View>

        {/* A night that happened gets its community score. An upcoming night
            gets tickets instead: never a fabricated 0.0. */}
        {!upcoming && overall != null && (
          <View style={styles.scoreCard}>
            <View style={{ alignItems: "center", marginBottom: 14 }}>
              <Text style={styles.bigScore}>{overall.toFixed(1)}</Text>
              <Stars value={overall} size={20} />
              <Text style={styles.scoreSub}>community score · {log.ratingCount ?? ((log.likes || 0) + (log.comments || 0))} {log.ratingCount === 1 ? "rating" : "ratings"}</Text>
            </View>
            {log.dims && Object.values(log.dims).some((v) => v > 0)
              ? <RatingBreakdown dims={log.dims} />
              : !archiveShowKey && (log.band || log.room)
                ? <RatingSplit band={log.band || 0} room={log.room || 0} />
                : null}
            <Text style={styles.note}>
              {archiveShowKey
                ? "Each account counts once in this performance score. Pit balances the average with review confidence so one perfect rating cannot overpower a crowd."
                : `Weighted across six factors - the band, the room, and the night. Room scores aggregate to ${venue}, not the artist.`}
            </Text>
          </View>
        )}
        {!upcoming && overall == null && (
          <View style={styles.scoreCard}>
            <Text style={styles.noScoreTitle}>No score yet</Text>
            <Text style={styles.note}>Nobody has logged this night. Were you there? Yours would be the first review.</Text>
          </View>
        )}
        {upcoming && log.ticketUrl ? (
          <Pressable style={styles.ticketsBtn} onPress={() => { void openTicketLink(log.ticketUrl); }} accessibilityRole="link" accessibilityLabel={`Get tickets for ${artist} at ${venue}`}>
            <Icon name="star" size={15} color="#1A1206" />
            <Text style={styles.ticketsTxt}>Get tickets</Text>
          </Pressable>
        ) : null}

        {/* going + the concert lounge */}
        <View style={styles.socialRow}>
          <Pressable
            style={[styles.goingBtn, going && styles.goingOn, goingBusy && styles.goingBusy]}
            onPress={() => (session ? toggleGoing(norm) : onRequireAuth?.())}
            accessibilityRole="button"
            accessibilityLabel={going ? "Remove this show from Going" : "Add this show to Going"}
            accessibilityState={{ selected: going, busy: goingBusy }}
          >
            {goingBusy ? <ActivityIndicator size="small" color={going ? "#1A1206" : colors.amber} /> : (
              <Icon name={going ? "check" : "calendar"} size={16} color={going ? "#1A1206" : colors.amber} />
            )}
            <Text style={[styles.goingTxt, going && { color: "#1A1206" }]}>{goingBusy ? "Saving…" : going ? "Going" : "I'm going"}</Text>
          </Pressable>
          <Pressable style={styles.loungeBtn} onPress={() => onOpenLounge?.(norm)} accessibilityRole="button" accessibilityLabel={`Open concert lounge, ${social.messageCount} messages`}>
            <Icon name="comment" size={16} color={colors.amber} />
            <Text style={styles.loungeTxt}>Lounge</Text>
            <View style={styles.loungeCount}><Text style={styles.loungeCountTxt}>{social.messageCount}</Text></View>
          </Pressable>
        </View>
        {attendeeTotal > 0 && (
          <View style={styles.attendeesCard}>
            <Text style={styles.attendeesTitle}>{attendeeTotal} going</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attendeesList}>
              {social.attendees.slice(0, 30).map((attendee) => (
                <Pressable
                  key={attendee.id}
                  style={styles.attendeeChip}
                  onPress={() => onOpenProfile?.(attendee.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${attendee.name}'s profile`}
                >
                  <Avatar user={attendee} size={30} />
                  <Text style={styles.attendeeName} numberOfLines={1}>{attendee.name}</Text>
                </Pressable>
              ))}
              {hiddenAttendeeCount > 0 && <Text style={styles.attendeeMore}>+{hiddenAttendeeCount} more</Text>}
            </ScrollView>
          </View>
        )}

        {/* review-in-post: log/review this exact show. Only a night that has
            actually happened can be reviewed. */}
        {!upcoming && (
          <Pressable style={styles.reviewCta} onPress={() => onReview?.(norm)} accessibilityRole="button" accessibilityLabel={`Log or review ${artist} at ${venue}`}>
            <Icon name="star" size={16} color="#1A1206" />
            <Text style={styles.reviewCtaTxt}>Log / review this show</Text>
          </Pressable>
        )}

        {!!log.review && (
          <>
            <Text style={styles.sectionLabel}>TOP REVIEW</Text>
            <View style={styles.reviewCard}>
              <Text style={styles.review}>{log.review}</Text>
              <Pressable onPress={log.userId ? () => onOpenProfile?.(log.userId) : undefined}>
                <Text style={styles.byline}>- {log.user?.name || "a fan"}</Text>
              </Pressable>
            </View>
          </>
        )}

        {archiveShowKey ? (
          <>
            <View style={styles.archiveReviewsHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionLabel}>FAN REVIEWS · {archiveReviewData.total || archiveReviews.length}</Text>
                <Text style={styles.archiveReviewsIntro}>Every eligible fan log tied to this performance. Open one for its comments.</Text>
              </View>
              <Icon name="archive" size={18} color={colors.amber} />
            </View>
            {archiveReviewResource.status === "loading" && archiveReviews.length === 0 ? (
              <View style={styles.archiveReviewState}><ActivityIndicator color={colors.amber} /><Text style={styles.archiveReviewStateText}>Pulling the crowd together…</Text></View>
            ) : null}
            {archiveReviewResource.status === "error" && archiveReviews.length === 0 ? (
              <Pressable style={styles.archiveReviewRetry} onPress={reloadArchiveReviews} accessibilityRole="button">
                <Text style={styles.archiveReviewRetryText}>Reviews missed a beat. Try again</Text>
              </Pressable>
            ) : null}
            {archiveReviews.map((review) => {
              const media = archiveReviewMedia(review);
              const author = review.user?.name || "A Pit fan";
              return (
                <View key={review.id} style={styles.archiveReviewCard}>
                  <View style={styles.archiveReviewTop}>
                    <Pressable style={styles.archiveReviewAuthor} onPress={() => review.userId && onOpenProfile?.(review.userId)} accessibilityRole="button" accessibilityLabel={`Open ${author}'s profile`}>
                      <Avatar user={review.user || { name: author, initials: "PF" }} size={34} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.archiveReviewName} numberOfLines={1}>{author}</Text>
                        <Text style={styles.archiveReviewMeta}>{review.user?.handle ? `@${review.user.handle} · ` : ""}{formatDate(review.date, review.date)}</Text>
                      </View>
                    </Pressable>
                    <View style={styles.archiveReviewScore}><Icon name="star" size={11} color={colors.gold} /><Text style={styles.archiveReviewScoreText}>{Number(review.overall || 0).toFixed(1)}</Text></View>
                  </View>
                  {!!review.review && <Text style={styles.archiveReviewText}>{review.review}</Text>}
                  {media[0] ? (
                    <SmartImage
                      uri={media[0].uri}
                      posterUri={media[0].posterUri}
                      mediaKind={media[0].kind}
                      style={styles.archiveReviewMedia}
                      contain={false}
                      accessibilityLabel={`Open media from ${author}'s review`}
                      onPress={() => onOpenPhotos?.(media, 0, review.id)}
                    />
                  ) : null}
                  <Pressable style={styles.archiveReviewOpen} onPress={() => onOpenPost?.(review)} accessibilityRole="button" accessibilityLabel={`Open ${author}'s review and comments`}>
                    <Text style={styles.archiveReviewOpenText}>Open review</Text>
                    <View style={styles.archiveReviewSignals}><Icon name="heart" size={11} color={colors.magenta} /><Text style={styles.archiveReviewSignalText}>{review.likes || 0}</Text><Icon name="comment" size={11} color={colors.textDim} /><Text style={styles.archiveReviewSignalText}>{review.comments || 0}</Text></View>
                    <Icon name="chevron-right" size={14} color={colors.amber} />
                  </Pressable>
                </View>
              );
            })}
            {archiveLoadMoreFailed ? (
              <View style={styles.archiveReviewMoreError} accessibilityLiveRegion="assertive">
                <Text style={styles.archiveReviewMoreErrorText} selectable>More fan reviews could not be loaded. The reviews already on screen are still available.</Text>
                <Pressable style={styles.archiveReviewMoreRetry} onPress={() => { void loadMoreArchiveReviewsWithFeedback(); }} accessibilityRole="button" accessibilityLabel="Retry loading more fan reviews">
                  <Icon name="plus" size={14} color={colors.amber} />
                  <Text style={styles.archiveReviewMoreRetryText}>Try again</Text>
                </Pressable>
              </View>
            ) : archiveReviewData.nextCursor ? (
              <Pressable style={styles.archiveReviewMore} onPress={() => { void loadMoreArchiveReviewsWithFeedback(); }} disabled={archiveReviewData.loadingMore} accessibilityRole="button" accessibilityState={{ busy: !!archiveReviewData.loadingMore }}>
                {archiveReviewData.loadingMore ? <ActivityIndicator size="small" color={colors.amber} /> : <Icon name="plus" size={14} color={colors.amber} />}
                <Text style={styles.archiveReviewMoreText}>{archiveReviewData.loadingMore ? "Loading…" : "Load more fan reviews"}</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}

        {/* jump to the artist or the venue from the concert */}
        <View style={styles.seeRow}>
          <Pressable style={styles.seeBtn} onPress={() => onOpenArtist?.(artist)} accessibilityRole="button" accessibilityLabel={`Open ${artist}'s profile`}>
            <Icon name="music" size={16} color={colors.amber} />
            <Text style={styles.seeTxt}>See this artist</Text>
            <Icon name="chevron-right" size={16} color={colors.textDim} />
          </Pressable>
          <Pressable style={styles.seeBtn} onPress={() => onOpenVenue?.(venue)} accessibilityRole="button" accessibilityLabel={`Open ${venue}'s venue page`}>
            <Icon name="pin" size={16} color={colors.amber} />
            <Text style={styles.seeTxt}>See this venue</Text>
            <Icon name="chevron-right" size={16} color={colors.textDim} />
          </Pressable>
        </View>

        {/* PostScreen owns the full composer/thread. This concert page only
            explains that destination so Lounge and post comments stay distinct. */}
        {discussionAvailable ? <View style={styles.discussionCard}>
          <View style={styles.discussionCopy}>
            <Text style={styles.discussionLabel}>POST DISCUSSION</Text>
            <Text style={styles.discussionTitle}>Comments on this fan post</Text>
            <Text style={styles.discussionText}>Open the original post for the full thread, replies, and moderation tools.</Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.discussionCta, pressed && styles.discussionCtaPressed]}
            onPress={() => onOpenPost?.(norm)}
            accessibilityRole="button"
            accessibilityLabel={discussionCount ? `Open post discussion, ${discussionCount.label} comments` : "Open post discussion"}
          >
            <Icon name="comment" size={16} color="#1A1206" />
            <Text style={styles.discussionCtaText}>Open comments</Text>
            {discussionCount && (
              <View style={styles.discussionCount}>
                <Text style={styles.discussionCountText}>{discussionCount.label}</Text>
              </View>
            )}
          </Pressable>
        </View> : null}

        {/* Nearby discovery is deliberately Maps-only: Pit makes no claims
            about a business being open, close, accessible, or age-appropriate. */}
        <View style={styles.afterCard}>
          <NearbyAfterparty log={norm} coord={coord} />
        </View>

        {setlist.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>SETLIST · {setlist.length} SONGS</Text>
            {revealed ? (
              <View style={styles.reviewCard}>
                {setlist.map((s, i) => (
                  <View key={i} style={styles.songRow}>
                    <Text style={styles.songNum}>{String(i + 1).padStart(2, "0")}</Text>
                    <Text style={styles.song}>{s}</Text>
                    <Pressable style={styles.previewBtn} hitSlop={8} onPress={() => onPreview?.(s, artist)}>
                      <Icon name="play" size={12} color={colors.amber} />
                    </Pressable>
                  </View>
                ))}
                <Text style={styles.previewHint}>Tap a song for a licensed 30s preview.</Text>
              </View>
            ) : (
              <Pressable style={styles.spoiler} onPress={() => setRevealed(true)}>
                <Icon name="lock" size={18} color={colors.amber} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.spoilerTitle}>Setlist hidden</Text>
                  <Text style={styles.spoilerSub}>This tour is still running, tap to reveal (spoiler).</Text>
                </View>
                <Text style={styles.spoilerCta}>Reveal</Text>
              </Pressable>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  backBtn: { flexDirection: "row", alignItems: "center", width: 56 },
  back: { color: colors.amber, fontSize: 15 },
  topTitle: { color: colors.textFaint, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  content: { padding: 16, paddingBottom: 48 },
  socialRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  goingBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.bgElev, paddingVertical: 14 },
  goingOn: { backgroundColor: colors.amberStrong, borderColor: colors.amberStrong },
  goingBusy: { opacity: 0.78 },
  goingTxt: { color: colors.amber, fontSize: 14, fontWeight: "800" },
  loungeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingVertical: 14 },
  loungeTxt: { color: colors.text, fontSize: 14, fontWeight: "700" },
  loungeCount: { backgroundColor: colors.amber, borderRadius: 999, minWidth: 20, paddingHorizontal: 6, paddingVertical: 1, alignItems: "center" },
  loungeCountTxt: { color: "#1A1206", fontSize: 11, fontWeight: "800", fontFamily: mono },
  attendeesCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, marginTop: 10, padding: 11 },
  attendeesTitle: { color: colors.textDim, fontFamily: mono, fontSize: 11, fontWeight: "800", letterSpacing: 0.5, marginBottom: 8 },
  attendeesList: { alignItems: "center", gap: 8, paddingRight: 4 },
  attendeeChip: { flexDirection: "row", alignItems: "center", gap: 7, maxWidth: 160, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev, paddingLeft: 3, paddingRight: 10, paddingVertical: 3 },
  attendeeName: { color: colors.text, fontSize: 12, fontWeight: "700", maxWidth: 105 },
  attendeeMore: { color: colors.textDim, fontFamily: mono, fontSize: 11, paddingHorizontal: 5 },
  reviewCta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 14, marginTop: 16 },
  reviewCtaTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 0.5 },
  spoiler: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, borderStyle: "dashed", paddingHorizontal: 16, paddingVertical: 16, marginTop: 8 },
  spoilerTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  spoilerSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  spoilerCta: { color: colors.amber, fontSize: 13, fontWeight: "800", letterSpacing: 0.5 },
  // Ticket hero: the performance page's own identity. Amber left edge like a
  // torn stub, perforation between the headline and the room/date strip.
  ticket: { backgroundColor: colors.surface, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, borderLeftWidth: 4, borderLeftColor: colors.amber, paddingHorizontal: 18, paddingVertical: 16, ...shadow.card },
  ticketKicker: { color: colors.amber, fontFamily: mono, fontSize: 10, letterSpacing: 2, fontWeight: "800", marginBottom: 6 },
  perfWrap: { flexDirection: "row", alignItems: "center", height: 16, marginVertical: 12 },
  dashed: { flex: 1, borderTopWidth: 1, borderStyle: "dashed", borderColor: colors.line },
  notch: { position: "absolute", width: 16, height: 16, borderRadius: 8, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.lineSoft },
  stubRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  stubLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 9, letterSpacing: 1.5, fontWeight: "800", marginBottom: 3 },
  stubCity: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  stubDivider: { width: 1, height: 34, backgroundColor: colors.line },
  soldOut: { color: colors.danger, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 1, marginTop: 3 },
  countdownStrip: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14, backgroundColor: colors.bgElev, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lineSoft, paddingHorizontal: 12, paddingVertical: 9 },
  countdownTxt: { color: colors.amber, fontFamily: mono, fontSize: 16, fontWeight: "900", letterSpacing: 0.5, fontVariant: ["tabular-nums"] },
  countdownSub: { color: colors.textFaint, fontSize: 11, letterSpacing: 1, textTransform: "uppercase" },
  ticketsBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 14, marginTop: 16 },
  ticketsTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 0.5 },
  noScoreTitle: { color: colors.text, fontFamily: displayFont, fontSize: 16, fontWeight: "800" },

  artist: { color: colors.text, fontFamily: displayFont, fontSize: 30, fontWeight: "900", letterSpacing: -0.5 },
  artistLink: { color: colors.amber, fontSize: 12, marginTop: 4, fontWeight: "600" },
  seeRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  seeBtn: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, paddingHorizontal: 12, paddingVertical: 13 },
  seeTxt: { flex: 1, color: colors.text, fontSize: 13, fontWeight: "700" },
  discussionCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, padding: 16, marginTop: 24, gap: 14 },
  discussionCopy: { gap: 4 },
  discussionLabel: { color: colors.amber, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 1.4 },
  discussionTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  discussionText: { color: colors.textDim, fontSize: 12.5, lineHeight: 18 },
  discussionCta: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.amberStrong, borderRadius: radius.md, borderCurve: "continuous", paddingHorizontal: 14, paddingVertical: 11 },
  discussionCtaPressed: { opacity: 0.8 },
  discussionCtaText: { color: "#1A1206", fontSize: 14, fontWeight: "900" },
  discussionCount: { minWidth: 24, borderRadius: radius.pill, backgroundColor: "rgba(26,18,6,0.14)", paddingHorizontal: 7, paddingVertical: 2, alignItems: "center" },
  discussionCountText: { color: "#1A1206", fontFamily: mono, fontSize: 11, fontWeight: "900", fontVariant: ["tabular-nums"] },
  afterCard: { backgroundColor: colors.bgElev, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, padding: 16, marginTop: 12 },
  venueLink: { color: colors.text, fontWeight: "700" },
  venue: { color: colors.textDim, fontSize: 15, marginTop: 4 },
  date: { color: colors.amber, fontFamily: mono, fontSize: 13, marginTop: 6, letterSpacing: 1 },

  scoreCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    padding: 18,
    marginTop: 20,
  },
  bigScore: { color: colors.gold, fontFamily: mono, fontSize: 44, fontWeight: "800", lineHeight: 48 },
  scoreSub: { color: colors.textFaint, fontSize: 12, marginTop: 8 },
  note: { color: colors.textFaint, fontSize: 12, marginTop: 14, lineHeight: 17, fontStyle: "italic" },

  sectionLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginTop: space(6), marginBottom: space(2) },
  reviewCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    padding: 16,
  },
  review: { color: colors.text, fontSize: 15, lineHeight: 22 },
  byline: { color: colors.textDim, fontSize: 13, marginTop: 12 },
  archiveHero: { height: 230, marginTop: 16, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft, ...shadow.card },
  archiveHeroImage: { width: "100%", height: "100%" },
  archiveHeroCredit: { position: "absolute", left: 10, bottom: 10, maxWidth: "80%", paddingHorizontal: 9, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: "rgba(8,8,10,0.82)" },
  archiveHeroCreditText: { color: "#fff", fontFamily: mono, fontSize: 9, fontWeight: "800", letterSpacing: 0.8 },
  archiveReviewsHead: { flexDirection: "row", alignItems: "flex-end", gap: 12 },
  archiveReviewsIntro: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: -4 },
  archiveReviewState: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, minHeight: 90, borderRadius: radius.md, backgroundColor: colors.surface },
  archiveReviewStateText: { color: colors.textDim, fontSize: 12.5 },
  archiveReviewRetry: { minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.surface },
  archiveReviewRetryText: { color: colors.danger, fontSize: 12.5, fontWeight: "800" },
  archiveReviewCard: { marginBottom: 10, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface, ...shadow.card },
  archiveReviewTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  archiveReviewAuthor: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 9 },
  archiveReviewName: { color: colors.text, fontSize: 13.5, fontWeight: "800" },
  archiveReviewMeta: { color: colors.textFaint, fontFamily: mono, fontSize: 10, marginTop: 2 },
  archiveReviewScore: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.bgElev },
  archiveReviewScoreText: { color: colors.gold, fontFamily: mono, fontSize: 12, fontWeight: "900" },
  archiveReviewText: { color: colors.text, fontSize: 14, lineHeight: 21, marginTop: 10 },
  archiveReviewMedia: { width: "100%", height: 190, borderRadius: radius.sm, marginTop: 12, backgroundColor: colors.surfaceAlt },
  archiveReviewOpen: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, marginTop: 9, borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: 9 },
  archiveReviewOpenText: { flex: 1, color: colors.amber, fontSize: 12, fontWeight: "800" },
  archiveReviewSignals: { flexDirection: "row", alignItems: "center", gap: 4 },
  archiveReviewSignalText: { color: colors.textDim, fontFamily: mono, fontSize: 10, marginRight: 3 },
  archiveReviewMore: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.bgElev },
  archiveReviewMoreText: { color: colors.amber, fontSize: 12.5, fontWeight: "800" },
  archiveReviewMoreError: { alignItems: "center", gap: 10, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.surface },
  archiveReviewMoreErrorText: { color: colors.danger, fontSize: 12, lineHeight: 18, textAlign: "center" },
  archiveReviewMoreRetry: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 16, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber },
  archiveReviewMoreRetryText: { color: colors.amber, fontSize: 12, fontWeight: "900" },
  songRow: { flexDirection: "row", alignItems: "center", paddingVertical: 5 },
  song: { color: colors.text, fontSize: 14, flex: 1 },
  songNum: { color: colors.textFaint, fontFamily: mono, fontSize: 12, width: 28 },
  previewBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 2,
  },
  previewHint: { color: colors.textFaint, fontSize: 11, marginTop: 10, fontStyle: "italic" },
});
