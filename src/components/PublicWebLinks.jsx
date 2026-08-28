import { Fragment } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, mono } from "../theme";
import { publicDirectoryItems, shouldUseSpaLinkNavigation } from "../domain/publicNavigationLinks.mjs";

const webHref = (href) => Platform.OS === "web" && href ? href : undefined;

const activate = (event, onNavigate) => {
  if (Platform.OS !== "web") {
    onNavigate?.();
    return;
  }
  if (!onNavigate || !shouldUseSpaLinkNavigation(event)) return;
  event?.preventDefault?.();
  event?.nativeEvent?.preventDefault?.();
  event?.stopPropagation?.();
  event?.nativeEvent?.stopPropagation?.();
  onNavigate();
};

/**
 * A rich card that stays an actual anchor on web while remaining a normal
 * Pressable on iOS and Android. Unmodified clicks use the app's navigation so
 * playback and local state survive; new-tab and modified clicks stay native to
 * the browser because the href is always present.
 */
export function PublicPressableLink({ href, onNavigate, accessibilityLabel, style, children, disabled = false, ...props }) {
  const platformDisabled = Platform.OS === "web" && href ? false : disabled;
  return (
    <Pressable
      {...props}
      href={webHref(href)}
      onPress={(event) => activate(event, onNavigate)}
      disabled={platformDisabled}
      style={style}
      accessibilityRole={href ? "link" : "button"}
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </Pressable>
  );
}

export function PublicTextLink({ href, onNavigate, current = false, style, children, ...props }) {
  if (current || !href) {
    return <Text {...props} accessibilityState={current ? { selected: true } : undefined} style={[styles.current, style]}>{children}</Text>;
  }
  return (
    <Text
      {...props}
      href={webHref(href)}
      onPress={(event) => activate(event, onNavigate)}
      accessibilityRole="link"
      style={[styles.link, style]}
    >
      {children}
    </Text>
  );
}

export function PublicWebTrail({ links = [], onNavigate }) {
  if (Platform.OS !== "web" || !links.length) return null;
  return (
    <View style={styles.trail} accessibilityLabel="Public page navigation">
      <Text style={styles.eyebrow}>EXPLORE</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.items}
        keyboardShouldPersistTaps="handled"
      >
        {links.map((link, index) => (
          <Fragment key={link.key || `${link.href}:${link.label}`}>
            {index > 0 ? <Text style={styles.separator}>/</Text> : null}
            <PublicTextLink
              href={link.href}
              current={link.current}
              onNavigate={link.target ? () => onNavigate?.(link.target) : undefined}
              style={link.current ? styles.currentItem : styles.linkItem}
            >
              {link.label}
            </PublicTextLink>
          </Fragment>
        ))}
      </ScrollView>
    </View>
  );
}

const directoryCopy = (directory, region = "Worldwide") => directory === "artists"
  ? {
    eyebrow: "ARTIST DIRECTORY",
    title: "Find the artists fans are talking about",
    body: "Open public artist profiles for live ratings, fan reviews, tour dates, photos, and career archives.",
  }
  : {
    eyebrow: "GLOBAL EVENT DIRECTORY",
    title: region && region !== "Worldwide" ? `Upcoming concerts in ${region}` : "Upcoming concerts around the world",
    body: `Browse released event pages${region && region !== "Worldwide" ? ` in ${region}` : ""} with artists, venues, dates, locations, fan activity, and official ticket links.`,
  };

export function PublicDirectoryPanel({ directory, region = "Worldwide", artists = [], events = [], onOpenArtist, onOpenEvent }) {
  if (Platform.OS !== "web" || (directory !== "artists" && directory !== "events")) return null;
  const copy = directoryCopy(directory, region);
  const rows = publicDirectoryItems(directory, directory === "artists" ? artists : events);
  return (
    <View style={styles.directoryPanel} accessibilityLabel={copy.eyebrow.toLowerCase()}>
      <View style={styles.directoryHeading}>
        <Text style={styles.directoryEyebrow}>{copy.eyebrow}</Text>
        <Text style={styles.directoryTitle}>{copy.title}</Text>
        <Text style={styles.directoryBody}>{copy.body}</Text>
      </View>
      {rows.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.directoryRows}>
          {rows.map((row, index) => {
            return (
              <PublicPressableLink
                key={row.key}
                href={row.href}
                onNavigate={() => directory === "artists" ? onOpenArtist?.(row.value) : onOpenEvent?.(row.value)}
                style={({ pressed, hovered, focused }) => [
                  styles.directoryCard,
                  index === 0 && styles.directoryCardLead,
                  hovered && styles.directoryCardHover,
                  pressed && styles.directoryCardPressed,
                  focused && styles.directoryCardFocused,
                ]}
                accessibilityLabel={`Open ${row.title}${row.detail ? `, ${row.detail}` : ""}`}
              >
                <Text style={styles.directoryCardTitle} numberOfLines={1}>{row.title}</Text>
                <Text style={styles.directoryCardDetail} numberOfLines={2}>{row.detail}</Text>
                <Text style={styles.directoryCardAction}>{row.action} →</Text>
              </PublicPressableLink>
            );
          })}
        </ScrollView>
      ) : (
        <Text style={styles.directoryEmpty}>The live directory is refreshing. Use the discovery sections below while it catches up.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  trail: {
    minHeight: 36,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    backgroundColor: colors.bgElev,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
  eyebrow: { color: colors.textFaint, fontFamily: mono, fontSize: 8, fontWeight: "900", letterSpacing: 1.4 },
  items: { minHeight: 35, alignItems: "center", gap: 8, paddingRight: 16 },
  separator: { color: colors.line, fontFamily: mono, fontSize: 10 },
  link: { textDecorationLine: "none" },
  current: { color: colors.textDim },
  linkItem: {
    minHeight: 34,
    paddingVertical: 9,
    color: colors.amber,
    fontFamily: mono,
    fontSize: 10,
    lineHeight: 16,
    fontWeight: "800",
    ...Platform.select({ web: { cursor: "pointer" } }),
  },
  currentItem: {
    minHeight: 34,
    paddingVertical: 9,
    color: colors.textDim,
    fontFamily: mono,
    fontSize: 10,
    lineHeight: 16,
    fontWeight: "800",
  },
  directoryPanel: {
    flexShrink: 0,
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 13,
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
  directoryHeading: { gap: 2 },
  directoryEyebrow: { color: colors.amber, fontFamily: mono, fontSize: 8, fontWeight: "900", letterSpacing: 1.4 },
  directoryTitle: { color: colors.text, fontSize: 16, lineHeight: 21, fontWeight: "900" },
  directoryBody: { color: colors.textDim, fontSize: 11, lineHeight: 16, maxWidth: 760 },
  directoryRows: { gap: 9, paddingRight: 14 },
  directoryCard: {
    width: 210,
    minHeight: 92,
    justifyContent: "center",
    gap: 3,
    padding: 11,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    borderRadius: 12,
    backgroundColor: colors.surface,
    ...Platform.select({ web: { cursor: "pointer", transitionDuration: "120ms", transitionProperty: "background-color, border-color, transform" } }),
  },
  directoryCardLead: { borderColor: colors.amber },
  directoryCardHover: { backgroundColor: colors.surfaceAlt, borderColor: colors.line },
  directoryCardPressed: { transform: [{ scale: 0.985 }], opacity: 0.9 },
  directoryCardFocused: { outlineStyle: "solid", outlineWidth: 2, outlineColor: colors.amber, outlineOffset: 2 },
  directoryCardTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  directoryCardDetail: { color: colors.textDim, fontSize: 10, lineHeight: 14 },
  directoryCardAction: { color: colors.amber, fontFamily: mono, fontSize: 9, lineHeight: 14, fontWeight: "900", marginTop: 3 },
  directoryEmpty: { color: colors.textDim, fontSize: 11, lineHeight: 16, paddingVertical: 7 },
});
