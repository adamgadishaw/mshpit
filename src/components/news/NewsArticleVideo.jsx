import { lazy, Suspense } from "react";
import { Text, View } from "react-native";
import { colors } from "../../theme";
// Use the existing gallery chunk. A second async entry for its internal player
// makes Metro promote the shared playback dependencies into startup JavaScript.
const Player = lazy(() => import("../PhotoViewer").then((module) => ({ default: module.MshpitVideoPlayer })));
export default function NewsArticleVideo({ uri, posterUri, postId }) {
  if (!/^https:\/\//u.test(uri || "") || !/^https:\/\//u.test(posterUri || "")) return null;
  return <View style={{ width: "100%", maxWidth: 680, aspectRatio: 16 / 9 }} accessibilityLabel="Article video">
    <Suspense fallback={<Text style={{ color: colors.textDim }}>Loading article video…</Text>}>
      <Player uri={uri} posterUri={posterUri} postId={postId} altText="Article video" />
    </Suspense>
  </View>;
}
