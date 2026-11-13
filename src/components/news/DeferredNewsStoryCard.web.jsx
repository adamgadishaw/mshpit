import { Suspense } from "react";
import { Text, View } from "react-native";
import { colors } from "../../theme";
import { lazyWithRetry } from "../../lib/lazyWithRetry";

const NewsStoryCard = lazyWithRetry(() => import("./NewsStoryCard"), "NewsStoryCard");

// A news post loads within its own tile; ordinary feed cards stay interactive.
export default function DeferredNewsStoryCard(props) {
  return <Suspense fallback={<View style={{ padding: 16, minHeight: 120 }}>
    <Text style={{ color: colors.text }}>{props.story?.headline}</Text>
    <Text accessibilityLiveRegion="polite" style={{ color: colors.textDim }}>Loading story…</Text>
  </View>}><NewsStoryCard {...props} /></Suspense>;
}
