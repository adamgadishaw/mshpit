import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { colors, displayFont, focusRing, font, mono, radius, shadow, space } from "../theme";
import { buildAttendanceTicketPreview } from "../domain/attendanceTicket.mjs";
import useReducedMotion from "../hooks/useReducedMotion";

const WIDE_BREAKPOINT = 620;

const isPreview = (value) =>
  value?.kind === "attendance-ticket"
  && value?.version === 1
  && typeof value?.eventTitle === "string";

const keepsakeDateParts = (value) => {
  const parts = typeof value === "string"
    ? value.split("·").map((part) => part.trim()).filter(Boolean)
    : [];
  if (parts.length !== 3) return { day: "", date: value || "", year: "" };
  return { day: parts[0], date: parts[1], year: parts[2] };
};

function Detail({ label, value, prominent = false }) {
  if (!value) return null;
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, prominent && styles.detailValueProminent]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function DateBlock({ value, compact }) {
  if (!value) return null;
  const date = keepsakeDateParts(value);
  return (
    <View style={[styles.dateBlock, compact && styles.dateBlockCompact]}>
      <Text style={styles.dateDay}>{date.day || "DATE"}</Text>
      <Text style={[styles.dateMain, compact && styles.dateMainCompact]} numberOfLines={1}>
        {date.date}
      </Text>
      {date.year ? <Text style={styles.dateYear}>{date.year}</Text> : null}
    </View>
  );
}

function SeatStub({ seatLocation }) {
  if (!seatLocation) {
    return (
      <View style={styles.stubFallback}>
        <Text style={styles.stubLabel}>SEATING</Text>
        <Text style={styles.stubValue}>NOT SHARED</Text>
      </View>
    );
  }
  const fields = [
    ["SECTION", seatLocation.section],
    ["ROW", seatLocation.row],
    ["SEAT", seatLocation.seat],
  ].filter(([, value]) => value);
  return (
    <View style={styles.seatGrid}>
      {fields.map(([label, value]) => (
        <View key={label} style={styles.seatField}>
          <Text style={styles.stubLabel}>{label}</Text>
          <Text style={styles.stubValue} numberOfLines={1}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * A display-only social keepsake. The component renders the preview builder's
 * public fields and never behaves like a venue-issued credential.
 */
export default function ConcertTicketCard({
  ticket,
  compact = false,
  onPress,
  style,
  accessibilityHint,
  testID,
}) {
  const { width, fontScale } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const wide = width >= WIDE_BREAKPOINT && fontScale < 1.35 && !compact;
  const preview = useMemo(
    () => (isPreview(ticket) ? ticket : buildAttendanceTicketPreview(ticket)),
    [ticket],
  );
  const [failedImageUri, setFailedImageUri] = useState(null);

  useEffect(() => {
    setFailedImageUri(null);
  }, [preview?.imageUri]);

  if (!preview) return null;

  const imageUri = preview.imageUri && preview.imageUri !== failedImageUri
    ? preview.imageUri
    : null;
  const timing = Array.isArray(preview.timing) ? preview.timing.slice(0, 2) : [];
  const location = [preview.venue, preview.city].filter(Boolean).join(" · ");
  const contextLabel = preview.isTourTitle ? "TOUR" : "EVENT";
  const cardAccessibilityLabel = "Mshpit social keepsake, not valid for entry. " + preview.accessibilityLabel;

  const cardContent = (
    <>
      <View style={[styles.printRail, compact && styles.printRailCompact]}>
        <View style={styles.brandLockup}>
          <View style={styles.brandMark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text style={styles.brandMarkText}>M</Text>
          </View>
          <Text style={styles.brandText}>MSHPIT / GOING</Text>
        </View>
        <Text style={styles.disclaimer}>SOCIAL RSVP · NOT VALID FOR ENTRY</Text>
      </View>

      <View style={styles.colorRegister} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.registerAmber} />
        <View style={styles.registerMagenta} />
        <View style={styles.registerCool} />
      </View>

      <View style={[styles.hero, wide && styles.heroWide]}>
        {imageUri ? (
          <View style={[
            styles.artwork,
            wide ? styles.artworkWide : styles.artworkStacked,
            compact && styles.artworkCompact,
          ]}>
            <ExpoImage
              source={{ uri: imageUri }}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
              cachePolicy="memory-disk"
              enforceEarlyResizing
              recyclingKey={imageUri}
              transition={reduceMotion ? 0 : 160}
              onError={() => setFailedImageUri(imageUri)}
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
            <View style={styles.artworkScrim} pointerEvents="none" accessibilityElementsHidden />
          </View>
        ) : null}

        <View style={[
          styles.copy,
          wide && styles.copyWide,
          compact && styles.copyCompact,
          !imageUri && styles.copyWithoutArtwork,
        ]}>
          <Text style={styles.authorSentence}>{preview.authorSentence}</Text>

          <View style={styles.titleStack}>
            {preview.contextTitle ? (
              <View style={styles.contextBlock}>
                <Text style={styles.contextLabel}>{contextLabel}</Text>
                <Text style={styles.contextTitle} numberOfLines={2}>{preview.contextTitle}</Text>
              </View>
            ) : null}

            <Text style={[
              styles.eventTitle,
              wide && styles.eventTitleWide,
              compact && styles.eventTitleCompact,
            ]} numberOfLines={3}>
              {preview.eventTitle}
            </Text>

            {preview.artistName ? (
              <Text style={styles.artistLine} numberOfLines={2}>ARTIST / {preview.artistName}</Text>
            ) : null}
          </View>

          <View style={styles.schedule}>
            <DateBlock value={preview.dateLabel} compact={compact} />
            <View style={styles.details}>
              <Detail label="VENUE / CITY" value={location} prominent />
              {timing.map((item) => (
                <Detail key={item.kind} label={item.label} value={item.value} />
              ))}
              <Detail label="TOUR POSITION" value={preview.tourStopLabel} />
            </View>
          </View>
        </View>
      </View>

      <View style={styles.perforation} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.notchLeft} />
        <View style={styles.dash} />
        <Text style={styles.perforationText}>MSHPIT SOCIAL RSVP</Text>
        <View style={styles.dash} />
        <View style={styles.notchRight} />
      </View>

      <View style={[styles.stub, compact && styles.stubCompact]}>
        <View style={styles.statusStamp}>
          <Text style={styles.statusStampLead}>GOING</Text>
          <Text style={styles.statusStampSub}>SOCIAL RSVP</Text>
        </View>
        <SeatStub seatLocation={preview.seatLocation} />
        {onPress ? (
          <View style={styles.openAction} pointerEvents="none">
            <Text style={styles.openActionText}>VIEW SHOW</Text>
            <Text style={styles.openActionArrow}>→</Text>
          </View>
        ) : (
          <Text style={styles.displayOnly}>RSVP CARD</Text>
        )}
      </View>
    </>
  );

  if (onPress) {
    return (
      <Pressable
        testID={testID}
        onPress={onPress}
        style={({ pressed, focused }) => [
          styles.card,
          compact && styles.cardCompact,
          style,
          pressed && styles.cardPressed,
          pressed && !reduceMotion && styles.cardPressedMotion,
          focused && focusRing,
        ]}
        accessibilityRole="button"
        accessibilityLabel={cardAccessibilityLabel}
        accessibilityHint={accessibilityHint || "Opens the show page"}
      >
        {cardContent}
      </Pressable>
    );
  }

  return (
    <View
      testID={testID}
      style={[styles.card, compact && styles.cardCompact, style]}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={cardAccessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      {cardContent}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    maxWidth: 900,
    overflow: "hidden",
    borderRadius: radius.sm,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  cardCompact: {
    borderRadius: radius.sm,
  },
  cardPressed: {
    opacity: 0.96,
  },
  cardPressedMotion: {
    transform: [{ scale: 0.995 }],
  },
  printRail: {
    minHeight: 46,
    paddingHorizontal: space(4),
    paddingVertical: space(2),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: space(2),
    backgroundColor: colors.bgElev,
  },
  printRailCompact: {
    paddingHorizontal: space(3),
  },
  brandLockup: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
  },
  brandMark: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.amber,
    backgroundColor: colors.amberStrong,
    transform: [{ rotate: "-2deg" }],
  },
  brandMarkText: {
    color: colors.bg,
    fontFamily: displayFont,
    fontSize: 13,
    fontWeight: "900",
  },
  brandText: {
    flexShrink: 1,
    color: colors.text,
    fontFamily: mono,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "900",
    letterSpacing: 1.25,
  },
  disclaimer: {
    color: colors.textFaint,
    fontFamily: mono,
    fontSize: 8,
    lineHeight: 12,
    fontWeight: "900",
    letterSpacing: 1.15,
  },
  colorRegister: {
    height: 4,
    flexDirection: "row",
  },
  registerAmber: {
    flex: 2,
    backgroundColor: colors.amberStrong,
  },
  registerMagenta: {
    flex: 1,
    backgroundColor: colors.magenta,
  },
  registerCool: {
    flex: 1,
    backgroundColor: colors.cool,
  },
  hero: {
    backgroundColor: colors.surface,
  },
  heroWide: {
    minHeight: 292,
    flexDirection: "row",
  },
  artwork: {
    overflow: "hidden",
    backgroundColor: colors.surfaceAlt,
  },
  artworkStacked: {
    width: "100%",
    height: 174,
  },
  artworkCompact: {
    height: 116,
  },
  artworkWide: {
    width: 224,
    alignSelf: "stretch",
    minHeight: 292,
  },
  artworkScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    opacity: 0.13,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: space(5),
    paddingVertical: space(5),
    gap: space(4),
  },
  copyWide: {
    paddingHorizontal: space(6),
    paddingVertical: space(6),
  },
  copyCompact: {
    paddingHorizontal: space(4),
    paddingVertical: space(4),
    gap: space(3),
  },
  copyWithoutArtwork: {
    paddingTop: space(6),
  },
  authorSentence: {
    maxWidth: 620,
    color: colors.textDim,
    fontFamily: font,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
  },
  titleStack: {
    gap: space(2),
  },
  contextBlock: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    gap: 2,
  },
  contextLabel: {
    color: colors.amber,
    fontFamily: mono,
    fontSize: 8,
    lineHeight: 12,
    fontWeight: "900",
    letterSpacing: 1.35,
  },
  contextTitle: {
    color: colors.textDim,
    fontFamily: displayFont,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
  },
  eventTitle: {
    color: colors.text,
    fontFamily: displayFont,
    fontSize: 30,
    lineHeight: 32,
    fontWeight: "900",
    letterSpacing: -0.8,
  },
  eventTitleWide: {
    fontSize: 36,
    lineHeight: 38,
    letterSpacing: -1,
  },
  eventTitleCompact: {
    fontSize: 24,
    lineHeight: 27,
    letterSpacing: -0.45,
  },
  artistLine: {
    color: colors.amber,
    fontFamily: mono,
    fontSize: 9,
    lineHeight: 14,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  schedule: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "stretch",
    gap: space(4),
  },
  dateBlock: {
    minWidth: 124,
    paddingHorizontal: space(3),
    paddingVertical: space(3),
    alignItems: "flex-start",
    justifyContent: "center",
    borderLeftWidth: 3,
    borderLeftColor: colors.amberStrong,
    backgroundColor: colors.surfaceAlt,
  },
  dateBlockCompact: {
    minWidth: 108,
    paddingHorizontal: space(2),
    paddingVertical: space(2),
  },
  dateDay: {
    color: colors.amber,
    fontFamily: mono,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  dateMain: {
    color: colors.text,
    fontFamily: displayFont,
    fontSize: 21,
    lineHeight: 26,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  dateMainCompact: {
    fontSize: 18,
    lineHeight: 23,
  },
  dateYear: {
    color: colors.textDim,
    fontFamily: mono,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.2,
    fontVariant: ["tabular-nums"],
  },
  details: {
    flex: 1,
    minWidth: 150,
    flexDirection: "row",
    flexWrap: "wrap",
    alignContent: "flex-start",
    gap: space(4),
  },
  detail: {
    minWidth: 108,
    maxWidth: 260,
    flexGrow: 1,
    flexBasis: 108,
    gap: 3,
  },
  detailLabel: {
    color: colors.textFaint,
    fontFamily: mono,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.15,
  },
  detailValue: {
    color: colors.text,
    fontFamily: font,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  detailValueProminent: {
    color: colors.amber,
  },
  perforation: {
    minHeight: 22,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
  },
  dash: {
    flex: 1,
    marginHorizontal: space(2),
    borderTopWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.line,
  },
  perforationText: {
    color: colors.textFaint,
    fontFamily: mono,
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 1.15,
  },
  notchLeft: {
    width: 20,
    height: 20,
    marginLeft: -10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  notchRight: {
    width: 20,
    height: 20,
    marginRight: -10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  stub: {
    minHeight: 82,
    paddingHorizontal: space(5),
    paddingTop: space(3),
    paddingBottom: space(4),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: space(4),
    backgroundColor: colors.surfaceAlt,
  },
  stubCompact: {
    minHeight: 74,
    paddingHorizontal: space(4),
    gap: space(3),
  },
  statusStamp: {
    minWidth: 78,
    paddingHorizontal: space(2),
    paddingVertical: space(2),
    alignItems: "center",
    borderWidth: 2,
    borderColor: colors.amber,
    borderRadius: radius.sm,
    transform: [{ rotate: "-1.5deg" }],
  },
  statusStampLead: {
    color: colors.amber,
    fontFamily: mono,
    fontSize: 14,
    lineHeight: 17,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  statusStampSub: {
    color: colors.textDim,
    fontFamily: mono,
    fontSize: 7,
    lineHeight: 10,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  seatGrid: {
    flex: 1,
    minWidth: 150,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space(4),
  },
  seatField: {
    minWidth: 48,
    maxWidth: 110,
    gap: 2,
  },
  stubFallback: {
    flex: 1,
    minWidth: 96,
    gap: 2,
  },
  stubLabel: {
    color: colors.textFaint,
    fontFamily: mono,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  stubValue: {
    color: colors.text,
    fontFamily: mono,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  openAction: {
    minHeight: 44,
    paddingHorizontal: space(1),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space(2),
    borderBottomWidth: 1,
    borderBottomColor: colors.amber,
  },
  openActionText: {
    color: colors.amber,
    fontFamily: mono,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.15,
  },
  openActionArrow: {
    color: colors.amber,
    fontFamily: font,
    fontSize: 18,
    fontWeight: "800",
  },
  displayOnly: {
    color: colors.textFaint,
    fontFamily: mono,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
});
