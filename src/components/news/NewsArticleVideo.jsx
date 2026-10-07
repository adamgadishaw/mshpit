import { lazy, Suspense } from "react";
import { Text, View } from "react-native";
import { colors } from "../../theme";
const Player = lazy(() => import("../media-player/MshpitVideoPlayer"));
export default function NewsArticleVideo({ uri, posterUri, postId }) {
  if (!/^https:\/\//u.test(uri || "") || !/^https:\/\//u.test(posterUri || "")) return null;
  return <View style={{ width: "100%", maxWidth: 680, aspectRatio: 16 / 9 }} accessibilityLabel="Article video">
    <Suspense fallback={<Text style={{ color: colors.textDim }}>Loading article video…</Text>}>
      <Player uri={uri} posterUri={posterUri} postId={postId} altText="Article video" />
    </Suspense>
  </View>;
}
