import { Alert, Image, Linking, StyleSheet, Text, View } from "react-native";
import { PublicPressableLink } from "./PublicWebLinks";
import { colors, radius, space } from "../theme";

const open = url => Linking.openURL(url).catch(() => Alert.alert("Source unavailable", "Please try again."));
export default function ResearchPhotoAttachments({ photos }) {
  return photos.map(photo => <View key={photo.assetHash} style={styles.photo}>
    <Image source={{ uri: photo.uri }} accessibilityLabel={photo.label} style={styles.image} resizeMode="cover" />
    <Text selectable style={styles.credit}>{photo.title || photo.label} · {photo.creator} · {photo.license}</Text>
    <View style={styles.links}>
      <PublicPressableLink href={photo.sourcePage} onNavigate={() => open(photo.sourcePage)}><Text style={styles.link}>Photo source</Text></PublicPressableLink>
      <PublicPressableLink href={photo.licenseUrl} onNavigate={() => open(photo.licenseUrl)}><Text style={styles.link}>License</Text></PublicPressableLink>
    </View>
    <Text selectable style={styles.credit}>{photo.modificationNotice}</Text>
  </View>);
}
const styles = StyleSheet.create({ photo: { marginTop: space(3), gap: space(1) },
  image: { width: "100%", height: 220, borderRadius: radius.md }, credit: { color: colors.textFaint, fontSize: 12 },
  links: { flexDirection: "row", gap: space(2) }, link: { color: colors.amber, fontSize: 12.5, fontWeight: "800" } });
