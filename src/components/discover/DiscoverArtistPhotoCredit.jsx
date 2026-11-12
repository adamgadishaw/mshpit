import { Linking, Pressable, StyleSheet, Text } from 'react-native';
import { Image } from 'expo-image';
import { discoverArtistArtwork } from '../../domain/discoverArtistArtwork.mjs';
import { focusRing } from '../../theme';

// A sibling of the artist navigation control, never a nested link or an overlay
// on the original artwork. Use the supplied provider mark and exact artist URL.
export default function DiscoverArtistPhotoCredit({ artist }) {
  const photo = discoverArtistArtwork(artist);
  if (!photo?.original) return null;
  return <Pressable accessibilityRole="link" accessibilityLabel={`Image from Spotify. Open ${artist.name} on Spotify`}
    onPress={() => { void Linking.openURL(photo.sourceUrl).catch(() => undefined); }}
    style={({ pressed, focused }) => [styles.credit, pressed && { opacity: 0.72 }, focused && focusRing]}>
    <Text style={styles.label}>SOURCE</Text>
    <Image source={require('../../../assets/spotify-full-logo.svg')} style={styles.logo} contentFit="contain" accessibilityLabel="Spotify" />
  </Pressable>;
}

const styles = StyleSheet.create({
  logo: { width: 70, height: 70 * 225.25 / 823.46 },
  credit: { minHeight: 44, paddingHorizontal: 10, gap: 8, flexDirection: 'row', flexWrap: 'wrap',
    alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#07090D', borderRadius: 4 },
  label: { color: '#A4A4AE', fontSize: 8, fontWeight: '700', letterSpacing: 1.4 },
});
