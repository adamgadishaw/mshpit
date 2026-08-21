import { useEffect } from "react";
import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";

export default function MediaEditorVideoPreview({ asset, edit, showOriginal = false, resolvedCover = null }) {
  const resolvedAutoCover = !showOriginal && edit?.coverMode !== "manual" && resolvedCover?.uri
    ? resolvedCover
    : null;
  const player = useVideoPlayer(resolvedAutoCover ? null : asset.uri, (instance) => {
    instance.loop = false;
    instance.muted = true;
    instance.pause();
  });
  const coverMs = showOriginal ? Math.max(0, asset.posterTimeMs || 0) : Math.max(0, edit?.coverMs || 0);

  useEffect(() => {
    player.pause();
    player.currentTime = coverMs / 1_000;
  }, [coverMs, player]);

  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Video cover preview at ${((resolvedAutoCover?.actualTimeMs ?? coverMs) / 1_000).toFixed(1)} seconds`}
    >
      {resolvedAutoCover ? (
        <Image source={{ uri: resolvedAutoCover.uri }} style={styles.video} contentFit="contain" cachePolicy="memory" accessibilityElementsHidden />
      ) : (
        <VideoView
          player={player}
          style={styles.video}
          nativeControls={false}
          contentFit="contain"
          fullscreenOptions={{ enable: false }}
          allowsPictureInPicture={false}
          playsInline
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, width: "100%", minHeight: 0, backgroundColor: "#030409", overflow: "hidden" },
  video: { flex: 1, width: "100%", minHeight: 0 },
});
