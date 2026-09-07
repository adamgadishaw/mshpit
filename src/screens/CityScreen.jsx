import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import ScreenHeader from "../components/ScreenHeader";
import CityImage from "../components/cities/CityImage";
import Button from "../components/Button";
import Icon from "../components/Icon";
import { colors, displayFont, focusRing, mono, radius, shadow, space } from "../theme";
import { readCityCopy, readCityGuide } from "../features/cities/cityApi.mjs";
import useCityResource from "../features/cities/useCityResource";
import { cityGalleryItems, cityShowNavigation, cityText, orderedCityPhotos } from "../components/cities/cityPresentation.mjs";
import CityPhotoCredit from "../components/cities/CityPhotoCredit";
import CityShowTicket from "../components/cities/CityShowTicket";
import { CityTicketDivider, CityTicketTrim } from "../components/cities/CityTicketChrome";
import { openCitySource } from "../components/cities/cityLinks";
import { PublicPressableLink } from "../components/PublicWebLinks";
import CityDirectoryScreen from "./CityDirectoryScreen";
import VinylRefreshBoundary from "../components/VinylRefreshBoundary";
import useScopedRefresh from "../hooks/useScopedRefresh";
import { refreshScope } from "../domain/scopedRefresh.mjs";

function Heading({ children, count, accent = colors.amber }) {
  return <View style={styles.headingRow}><View style={[styles.headingMark, { backgroundColor: accent }]} /><Text accessibilityRole="header" style={styles.sectionTitle}>{children}</Text>{count != null ? <Text style={styles.headingCount}>{count}</Text> : null}</View>;
}
function CopySection({ title, text, copy }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  return <View style={styles.copySection}>
    <Text accessibilityRole="header" style={styles.copyTitle}>{title}</Text>
    <Text selectable style={styles.body} numberOfLines={expanded ? undefined : 6}>{text}</Text>
    {text.length > 360 ? <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={({ focused }) => [styles.textButton, focused && focusRing]}><Text style={styles.link}>{cityText(copy, expanded ? "showLess" : "showMore")}</Text><Icon name="chevron-right" size={16} color={colors.amber} /></Pressable> : null}
  </View>;
}
function Destination({ title, subtitle, image, icon, path, label, onPress }) {
  return <PublicPressableLink href={path || undefined} disabled={!path} accessibilityLabel={`${title} · ${label}`} onNavigate={onPress} style={({ pressed, focused }) => [styles.destination, pressed && styles.pressed, focused && focusRing]}>
    {image ? <CityImage uri={image} style={styles.thumb} contain={false} previewWidth={160} accessibilityLabel={title} /> : <View style={styles.thumbFallback}><Icon name={icon} color={colors.amber} size={22} /></View>}
    <View style={styles.grow}><Text style={styles.itemTitle} numberOfLines={2}>{title}</Text>{subtitle ? <Text style={styles.secondary} numberOfLines={2}>{subtitle}</Text> : null}</View>
    {path ? <Icon name="chevron-right" size={18} color={colors.textFaint} /> : null}
  </PublicPressableLink>;
}
function CountStub({ count, label, last = false }) {
  return <View style={[styles.countStub, !last && styles.countDivider]}><Text style={styles.countValue}>{Number(count || 0).toLocaleString()}</Text><Text style={styles.countLabel}>{label}</Text></View>;
}
// Pure content permits isolated responsive and theme verification.
export function CityGuideContent({ guide, width, onOpenVenue, onOpenArtist, onOpenShow, onOpenPhotos }) {
  const wide = width >= 900;
  const [venueLimit, setVenueLimit] = useState(6);
  const [eventLimit, setEventLimit] = useState(6);
  const [artistLimit, setArtistLimit] = useState(6);
  const copy = guide.copy || {};
  const t = (key, values) => cityText(copy, key, { city: guide.city.city, ...values });
  const photos = orderedCityPhotos(guide.photos, guide.editorial?.stockImage);
  const leadPhoto = photos[0];
  const today = guide.today || [];
  const todayIds = new Set(today.map((show) => show.id));
  const upcoming = (guide.upcoming || []).filter((show) => !todayIds.has(show.id));
  const hasStory = !!(guide.editorial?.history || guide.editorial?.influence);
  const openPhoto = (index) => onOpenPhotos?.(cityGalleryItems(photos), index);
  useEffect(() => { setVenueLimit(6); setEventLimit(6); setArtistLimit(6); }, [guide.city.countryCode, guide.city.citySlug]);
  return <>
    <View style={styles.marquee}>
      <CityTicketTrim />
      <View style={[styles.marqueeMain, wide && styles.marqueeWide]}>
        {leadPhoto ? <View style={[styles.heroArtwork, wide && styles.heroArtworkWide]}>
          <CityImage uri={leadPhoto.url} style={StyleSheet.absoluteFill} contain={false} previewWidth={900} priority="high" accessibilityLabel={leadPhoto.alt || guide.city.city} onPress={onOpenPhotos ? () => openPhoto(0) : undefined} />
        </View> : null}
        <View style={[styles.heroBody, wide && styles.heroBodyWide]}>
          <View style={styles.topline}><Icon name="ticket" size={22} color={colors.amber} /><Text style={styles.kicker}>{t("guideLabel")}</Text></View>
          <Text style={styles.location}>{[guide.city.region, guide.city.country].filter(Boolean).join(", ")}</Text>
          <Text selectable style={[styles.title, wide && styles.titleWide]} accessibilityRole="header">{guide.editorial?.title || t("cityTitle") || guide.city.city}</Text>
          {guide.editorial?.intro ? <Text selectable style={styles.intro}>{guide.editorial.intro}</Text> : null}
          {leadPhoto ? <View style={styles.photoMeta}><Icon name="photo" size={14} color={colors.textFaint} /><Text style={styles.photoLabel}>{t(leadPhoto.kind === "fan" ? "fanPhotoLabel" : "cityPhotoLabel")}</Text>{onOpenPhotos ? <Pressable onPress={() => openPhoto(0)} accessibilityRole="button" style={({ focused }) => [styles.photoCountButton, focused && focusRing]}><Text style={styles.link}>{t("photoCount", { count: photos.length })}</Text><Icon name="chevron-right" size={15} color={colors.amber} /></Pressable> : null}</View> : null}
        </View>
      </View>
      <CityTicketDivider />
      <View style={styles.counts}>
        <CountStub count={today.length} label={t("todayCountLabel")} />
        <CountStub count={guide.city.upcomingCount ?? guide.upcoming?.length} label={t("upcomingCountLabel")} />
        <CountStub count={guide.city.venueCount ?? guide.venues?.length} label={t("venueCountLabel")} last />
      </View>
    </View>
    {leadPhoto ? <View style={styles.leadCredit}><CityPhotoCredit {...leadPhoto} copy={copy} /></View> : null}
    {photos.length > 1 ? <View style={styles.section}>
      <Heading>{t("photosTitle")}</Heading>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
        {photos.slice(1).map((photo, index) => <View key={photo.url} style={styles.photoCard}>
          <CityImage uri={photo.url} style={styles.photo} contain={false} previewWidth={420} accessibilityLabel={photo.alt || guide.city.city} onPress={onOpenPhotos ? () => openPhoto(index + 1) : undefined} />
          <CityPhotoCredit {...photo} copy={copy} />
        </View>)}
      </ScrollView>
    </View> : null}
    <View style={[styles.columns, wide && styles.columnsWide]}>
      <View style={[styles.column, wide && styles.showsColumn]}>
        <View style={styles.section}>
          <Heading count={today.length}>{t("todayTitle")}</Heading>
          {today.length ? today.map((show) => <CityShowTicket key={show.id} show={show} copy={copy} showImage={wide} onOpen={() => onOpenShow?.(cityShowNavigation(show, guide.city))} />) : <View style={styles.empty}><Icon name="calendar" color={colors.textFaint} size={24} /><Text style={styles.body}>{t("noShowsToday")}</Text></View>}
        </View>
        <View style={styles.section}>
          <Heading>{t("upcomingTitle")}</Heading>
          {upcoming.length ? upcoming.slice(0, eventLimit).map((show) => <CityShowTicket key={show.id} show={show} copy={copy} showImage={wide} onOpen={() => onOpenShow?.(cityShowNavigation(show, guide.city))} />) : <View style={styles.empty}><Icon name="calendar" color={colors.textFaint} size={24} /><Text style={styles.body}>{t("noUpcomingShows")}</Text></View>}
          {upcoming.length > eventLimit ? <Button title={t("showMore")} variant="secondary" onPress={() => setEventLimit((count) => count + 6)} /> : null}
        </View>
      </View>
      {hasStory ? <View style={styles.column}>
        <View style={styles.programme}>
          <View style={styles.programmeMasthead}><Icon name="music" size={22} color={colors.magenta} /><Text style={styles.programmeLabel}>{t("programmeLabel")}</Text></View>
          <View style={styles.programmeBody}>
            <CopySection title={t("historyTitle")} text={guide.editorial?.history} copy={copy} />
            {guide.editorial?.history && guide.editorial?.influence ? <View style={styles.storyRule} /> : null}
            <CopySection title={t("influenceTitle")} text={guide.editorial?.influence} copy={copy} />
          </View>
          {guide.editorial?.sources?.length ? <View style={styles.sources}>
            <Text style={styles.sourceLabel}>{t("sourcesTitle")}</Text>
            {guide.editorial.sources.map((source) => <PublicPressableLink key={source.url} href={source.url} onNavigate={() => openCitySource(source.url)} style={({ focused }) => [styles.sourceLink, focused && focusRing]}><Text style={styles.sourceText}>{source.title}</Text><Icon name="chevron-right" color={colors.textFaint} size={15} /></PublicPressableLink>)}
          </View> : null}
        </View>
      </View> : null}
    </View>
    <View style={[styles.columns, wide && styles.columnsWide]}>
      <View style={styles.column}><View style={styles.panel}>
        <Heading accent={colors.magenta}>{t("artistsTitle")}</Heading>
        {guide.artists?.length ? guide.artists.slice(0, artistLimit).map((artist) => <Destination key={artist.key || artist.name} title={artist.name} subtitle={artist.description} image={artist.image} icon="music" path={artist.path} label={t("openArtist")} onPress={() => onOpenArtist?.(artist)} />) : <Text style={styles.body}>{t("noArtists")}</Text>}
        {guide.artists?.length > artistLimit ? <Button title={t("showMore")} variant="secondary" onPress={() => setArtistLimit((count) => count + 6)} /> : null}
      </View></View>
      <View style={styles.column}><View style={styles.panel}>
        <Heading accent={colors.cool}>{t("venuesTitle")}</Heading>
        {guide.venues?.length ? guide.venues.slice(0, venueLimit).map((venue) => <Destination key={venue.key || venue.name} title={venue.name} subtitle={t("upcomingCount", { count: venue.upcomingCount || 0 })} image={venue.photo?.url} icon="pin" path={venue.path} label={t("openVenue")} onPress={() => onOpenVenue?.(venue)} />) : <Text style={styles.body}>{t("noVenues")}</Text>}
        {guide.venues?.length > venueLimit ? <Button variant="secondary" title={t("showMore")} onPress={() => setVenueLimit((count) => count + 6)} /> : null}
      </View></View>
    </View>
    {guide.performingArtists?.length ? <View style={styles.section}>
      <Heading accent={colors.cool}>{t("performingArtistsTitle")}</Heading>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.performers}>
        {guide.performingArtists.map((artist) => <View key={artist.key} style={styles.performerCard}><Destination title={artist.name} image={artist.image} icon="music" path={artist.path} label={t("openArtist")} onPress={() => onOpenArtist?.(artist)} /></View>)}
      </ScrollView>
    </View> : null}
  </>;
}
function CityGuideScreen({ city, accountId, onClose, ...navigation }) {
  const { width } = useWindowDimensions();
  const countryCode = city?.countryCode || "";
  const citySlug = city?.citySlug || "";
  const load = useCallback((signal) => readCityGuide({ countryCode, citySlug }, { signal, accountId }), [countryCode, citySlug, accountId]);
  const loadCopy = useCallback((signal) => readCityCopy({ signal }), []);
  const resource = useCityResource(`city:${accountId || "guest"}:${countryCode}:${citySlug}`, load, { enabled: !!countryCode && !!citySlug });
  const copyResource = useCityResource("city-screen-copy", loadCopy);
  const { refresh: refreshCity, refreshing } = useScopedRefresh({
    scope: refreshScope(accountId, "city", `${countryCode}:${citySlug}`),
    task: async ({ signal }) => Promise.all([resource.refresh({ signal }), copyResource.refresh({ signal })]),
  });
  const guide = resource.data;
  const copy = guide?.copy || copyResource.data?.copy || {};
  const t = (key, values) => cityText(copy, key, { city: guide?.city?.city || city?.city || "", ...values });
  return <View style={styles.root}>
    <ScreenHeader title={guide?.city?.city || city?.city || city?.name || ""} kicker={t("guideLabel")} onBack={onClose} />
    <VinylRefreshBoundary refreshing={refreshing} onRefresh={refreshCity} accessibilityLabel={t("refreshCityLabel")}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.scroll}>
        {resource.status === "loading" && !guide ? <ActivityIndicator color={colors.amber} style={styles.loader} accessibilityLabel={t("loading")} /> : null}
        {resource.error ? <View style={styles.panel}><Text selectable style={styles.error} accessibilityRole="alert">{t("loadError") || resource.error.message}</Text><Button title={t("retry") || "Try again"} onPress={resource.reload} variant="secondary" /></View> : null}
        {guide ? <CityGuideContent key={`${accountId || "guest"}:${countryCode}:${citySlug}`} guide={guide} width={width} {...navigation} /> : null}
      </ScrollView>
    </VinylRefreshBoundary>
  </View>;
}
export default function CityScreen(props) {
  return props.city?.directory ? <CityDirectoryScreen accountId={props.accountId} onClose={props.onClose} onOpenCity={props.onOpenCity} /> : <CityGuideScreen {...props} />;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, minWidth: 0 },
  scroll: { width: "100%", maxWidth: 1160, alignSelf: "center", padding: space(4), paddingBottom: space(13), gap: space(6) }, loader: { padding: space(10) },
  marquee: { overflow: "hidden", borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  marqueeMain: { minWidth: 0 }, marqueeWide: { flexDirection: "row" }, heroArtwork: { width: "100%", aspectRatio: 1.9 }, heroArtworkWide: { width: "52%", aspectRatio: undefined, minHeight: 320 },
  heroBody: { padding: space(5), gap: space(3), minWidth: 0 }, heroBodyWide: { flex: 1, padding: space(7), justifyContent: "center" }, topline: { flexDirection: "row", alignItems: "center", gap: space(2) },
  kicker: { color: colors.amber, fontFamily: mono, fontSize: 10, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" }, location: { color: colors.textDim, fontSize: 12 },
  title: { color: colors.text, fontFamily: displayFont, fontWeight: "800", fontSize: 36, lineHeight: 41, letterSpacing: -0.8 }, titleWide: { fontSize: 44, lineHeight: 48 }, intro: { color: colors.textDim, fontSize: 15, lineHeight: 23 },
  photoMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space(2) }, photoLabel: { color: colors.textFaint, fontSize: 10 }, photoCountButton: { minHeight: space(11), flexDirection: "row", gap: space(1), alignItems: "center", marginLeft: "auto" },
  counts: { flexDirection: "row", backgroundColor: colors.surfaceAlt, paddingVertical: space(4) }, countStub: { flex: 1, minWidth: 0, alignItems: "center", paddingHorizontal: space(2), gap: space(1) }, countDivider: { borderRightWidth: 1, borderColor: colors.line },
  countValue: { color: colors.amber, fontSize: 27, fontWeight: "800", fontFamily: displayFont, fontVariant: ["tabular-nums"] }, countLabel: { color: colors.textDim, fontSize: 10, textAlign: "center", lineHeight: 15 }, leadCredit: { marginTop: -space(5), marginBottom: -space(4), paddingHorizontal: space(2) },
  headingRow: { flexDirection: "row", alignItems: "center", gap: space(3), minWidth: 0 }, headingMark: { width: space(1), height: space(6), borderRadius: space(1) }, sectionTitle: { color: colors.text, fontFamily: displayFont, fontWeight: "800", fontSize: 23, lineHeight: 29, flex: 1 },
  headingCount: { color: colors.amber, fontFamily: mono, fontSize: 12, padding: space(2), backgroundColor: colors.surfaceAlt, borderRadius: radius.sm }, section: { gap: space(3), minWidth: 0 },
  columns: { gap: space(6) }, columnsWide: { flexDirection: "row", alignItems: "flex-start" }, column: { flex: 1, minWidth: 0, gap: space(6) }, showsColumn: { flex: 1.2 },
  panel: { padding: space(5), gap: space(3), borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, minWidth: 0 },
  body: { color: colors.textDim, fontSize: 14, lineHeight: 23, flexShrink: 1 }, empty: { flexDirection: "row", alignItems: "center", gap: space(3), padding: space(5), borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.surface },
  programme: { borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: "hidden" }, programmeMasthead: { padding: space(5), flexDirection: "row", alignItems: "center", gap: space(3), backgroundColor: colors.surfaceAlt, borderBottomWidth: 1, borderColor: colors.line },
  programmeLabel: { color: colors.magenta, fontFamily: mono, fontSize: 10, letterSpacing: 1.5, fontWeight: "800", textTransform: "uppercase" }, programmeBody: { padding: space(6), gap: space(5) }, copySection: { gap: space(3) }, copyTitle: { color: colors.text, fontFamily: displayFont, fontWeight: "800", fontSize: 25, lineHeight: 31 }, storyRule: { height: 1, backgroundColor: colors.line },
  textButton: { alignSelf: "flex-start", minHeight: space(11), flexDirection: "row", alignItems: "center", gap: space(2) }, link: { color: colors.amber, fontSize: 12, fontWeight: "800" },
  sources: { borderTopWidth: 1, borderColor: colors.line, paddingHorizontal: space(6), paddingVertical: space(3), gap: space(1) }, sourceLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 10, letterSpacing: 1 }, sourceLink: { minHeight: space(11), flexDirection: "row", alignItems: "center", gap: space(3) }, sourceText: { color: colors.textDim, fontSize: 11, lineHeight: 17, flex: 1 },
  photos: { gap: space(3) }, photoCard: { width: 208 }, photo: { width: "100%", aspectRatio: 1.55, borderRadius: radius.md }, performers: { gap: space(3) }, performerCard: { width: 248, paddingHorizontal: space(4), borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  destination: { flexDirection: "row", alignItems: "center", gap: space(3), paddingVertical: space(3), minHeight: space(18), minWidth: 0 }, grow: { flex: 1, minWidth: 0, gap: space(1) }, thumb: { width: space(12), height: space(12), borderRadius: radius.sm }, thumbFallback: { width: space(12), height: space(12), borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  itemTitle: { color: colors.text, fontSize: 16, fontWeight: "800" }, secondary: { color: colors.textDim, fontSize: 12, lineHeight: 18 }, error: { color: colors.danger, lineHeight: 22 }, pressed: { opacity: 0.78 },
});
