import { Suspense } from "react";
import { ActivityIndicator } from "react-native";
import { lazyWithRetry } from "../lib/lazyWithRetry";
import { colors } from "../theme";

// Several lazy pages share updates. Keep the full feature out of the initial
// common bundle, and retain the app's recoverable chunk-loading behavior.
const CreatorPostsSection = lazyWithRetry(() => import("../features/creatorPosts/CreatorPostsSection"), "CreatorPostsSection");

export default function CreatorPostsPanel(props) {
  return <Suspense fallback={<ActivityIndicator accessibilityLabel="Loading page updates" color={colors.amber} />}>
    <CreatorPostsSection {...props} />
  </Suspense>;
}
