import { useCallback } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { colors, displayFont, mono, radius, space } from "../../theme";
import CityImage from "../../components/cities/CityImage";
import Button from "../../components/Button";
import { cityText } from "../../components/cities/cityPresentation.mjs";
import CityPhotoCredit from "../../components/cities/CityPhotoCredit";
import { CityTicketDivider, CityTicketTrim } from "../../components/cities/CityTicketChrome";
import { readCityCopy } from "./cityApi.mjs";
import useCityResource from "./useCityResource";

export default function CityWelcomeCard({ city, onDismiss, onOpenCity }) {
  const load = useCallback((signal) => readCityCopy({ signal }), []);
  const resource = useCityResource("city-welcome-copy", load);
  const copy = resource.data?.copy;
  if (!city) return null;
  if (!copy) return <View style={[styles.card, styles.body]}>
    {resource.error ? <><Text style={styles.description} accessibilityRole="alert">{resource.error.message}</Text><Button title="Try again" onPress={resource.reload} variant="secondary" /></> : <ActivityIndicator color={colors.amber} />}
  </View>;
  const cityName = typeof city === "string" ? city.split(",")[0] : city.city || city.name || "";
  const canOpen = typeof city === "object" && city.countryCode && city.citySlug;
  return <View style={styles.card}>
    <CityTicketTrim />
    {copy.welcomeBannerUrl ? <CityImage uri={copy.welcomeBannerUrl} contain={false} style={styles.banner} accessibilityLabel={copy.welcomeBannerAlt || cityName} priority="high" previewWidth={900} /> : null}
    <View style={styles.body}>
      <Text style={styles.kicker}>{cityText(copy, "welcomeKicker")}</Text>
      <Text style={styles.title} accessibilityRole="header">{cityText(copy, "welcomeTitle", { city: cityName })}</Text>
      <Text style={styles.description}>{cityText(copy, "welcomeBody", { city: cityName })}</Text>
    </View>
    <CityTicketDivider />
    <View style={styles.actions}>
      {canOpen && onOpenCity ? <Button title={cityText(copy, "welcomeExplore")} onPress={() => onOpenCity(city)} /> : null}
      <Button title={cityText(copy, "welcomeDismiss")} variant="secondary" onPress={onDismiss} />
      <CityPhotoCredit credit={copy.welcomeBannerCredit} sourceUrl={copy.welcomeBannerSourceUrl} licenseUrl={copy.welcomeBannerLicenseUrl} copy={copy} />
    </View>
  </View>;
}
const styles = StyleSheet.create({ card: { width: "100%", maxWidth: 560, alignSelf: "center", borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: "hidden" }, banner: { width: "100%", aspectRatio: 2.4 }, body: { padding: space(6), gap: space(3) }, actions: { padding: space(5), gap: space(3), backgroundColor: colors.surfaceAlt }, kicker: { color: colors.amber, fontFamily: mono, fontSize: 10, letterSpacing: 1.3, fontWeight: "800", textTransform: "uppercase" }, title: { fontFamily: displayFont, fontSize: 34, lineHeight: 39, fontWeight: "800", color: colors.text }, description: { color: colors.textDim, fontSize: 15, lineHeight: 23 } });
