import { Text, View } from "react-native";
import { PublicPressableLink } from "../components/PublicWebLinks";
import { reviewEventPath } from "../domain/reviewDetail.mjs";
import { readPublicPost, resolvePublicEntity } from "../features/publicNavigation/publicNavigationService";
import { lazyWithRetry } from "../lib/lazyWithRetry";
const EventPageNavigation = lazyWithRetry(() => import("./EventPageNavigation"), "EventPageNavigation");
import { colors } from "../theme";

const read = async (post, { signal }) => {
  let path = reviewEventPath(post);
  if (!path && post?.id) path = reviewEventPath(await readPublicPost(post.id, { signal }));
  if (!path || signal.aborted) return null;
  const entity = await resolvePublicEntity(path, { signal });
  return entity?.kind === "concert" || entity?.kind === "event" ? { ...entity, performanceEvent: true } : null;
};

export default function ReviewEventLink({ review, onOpenShow, children, containerStyle, ...props }) {
  if (!review?.id && !reviewEventPath(review)) return null;
  return <EventPageNavigation read={read} onOpen={onOpenShow}>{({ open, state }) => <View style={containerStyle}>
    <PublicPressableLink {...props} href={reviewEventPath(review)} onNavigate={() => open(review)}
      accessibilityState={{ busy: state?.status === "loading" }}>
      {children}
    </PublicPressableLink>
    {state?.status === "loading" ? <Text accessibilityLiveRegion="polite" style={{ color: colors.textDim }}>Opening event…</Text> : null}
    {["error", "unavailable"].includes(state?.status) ? <Text accessibilityLiveRegion="polite" style={{ color: colors.textDim }}>The event could not open. Try the event link again.</Text> : null}
  </View>}</EventPageNavigation>;
}
