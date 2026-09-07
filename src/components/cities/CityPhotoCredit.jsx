import { StyleSheet, Text, View } from "react-native";
import { colors, space } from "../../theme";
import { PublicPressableLink } from "../PublicWebLinks";
import { openCitySource } from "./cityLinks";
import { cityText } from "./cityPresentation.mjs";

export default function CityPhotoCredit({ credit, sourceUrl, licenseUrl, copy }) {
  if (!credit && !licenseUrl) return null;
  return <View style={styles.row}>
    {credit ? <PublicPressableLink href={sourceUrl || undefined} onNavigate={() => openCitySource(sourceUrl)} style={styles.link}><Text style={styles.text}>{cityText(copy, "photoCredit", { credit })}</Text></PublicPressableLink> : null}
    {licenseUrl ? <PublicPressableLink href={licenseUrl} onNavigate={() => openCitySource(licenseUrl)} style={styles.link}><Text style={styles.text}>{cityText(copy, "photoLicense")}</Text></PublicPressableLink> : null}
  </View>;
}
const styles = StyleSheet.create({ row: { flexDirection: "row", flexWrap: "wrap", columnGap: space(3) }, link: { minHeight: space(11), justifyContent: "center" }, text: { color: colors.textFaint, fontSize: 10, lineHeight: 15 } });
