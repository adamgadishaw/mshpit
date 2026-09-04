import { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { spotifyArtistPhotoModel } from "../domain/spotifyArtistPhoto.mjs";
import { colors, focusRing, mono, shadow } from "../theme";
import SpotifyFullLogo from "./SpotifyFullLogo";

export default function SpotifyArtistPhoto({ artist, artistName }) {
  const [failed, setFailed] = useState(false);
  const photo = spotifyArtistPhotoModel(artist);
  const source = useMemo(() => photo?.uri ? { uri: photo.uri, cacheKey: photo.uri } : null, [photo?.uri]);

  useEffect(() => {
    setFailed(false);
  }, [photo?.uri]);

  if (!photo || failed) return null;

  const openArtist = () => {
    void Linking.openURL(photo.sourceUrl).catch(() => undefined);
  };

  return (
    <View style={styles.shell}>
      <Image
        source={source}
        style={styles.image}
        contentFit="contain"
        cachePolicy="memory-disk"
        priority="normal"
        loading="lazy"
        autoplay={false}
        allowDownscaling
        enforceEarlyResizing
        recyclingKey={`spotify-artist:${photo.uri}`}
        transition={80}
        onError={() => setFailed(true)}
        accessibilityRole="image"
        accessibilityLabel={`${artistName} image from Spotify`}
      />
      <Pressable
        onPress={openArtist}
        style={({ pressed, focused }) => [styles.credit, pressed && styles.pressed, focused && focusRing]}
        accessibilityRole="link"
        accessibilityLabel={`Image from Spotify. Open ${artistName} on Spotify`}
      >
        <Text style={styles.creditText}>SOURCE</Text>
        <SpotifyFullLogo width={70} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    overflow: "hidden",
    // Spotify artwork may have only subtle rounding. Keep this at the
    // provider's small/medium maximum and never apply the app's 26px card crop.
    borderRadius: 4,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#07090D",
    ...shadow.card,
  },
  image: {
    width: "100%",
    height: 280,
    backgroundColor: "#07090D",
  },
  credit: {
    minHeight: 34,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: "#07090D",
  },
  creditText: {
    color: colors.textFaint,
    fontFamily: mono,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  pressed: { opacity: 0.72 },
});
