import { Suspense } from "react";
import { Pressable, Text } from "react-native";
import { colors, radius } from "../theme";
import { lazyWithRetry } from "../lib/lazyWithRetry";

const ConcertTicketCard = lazyWithRetry(() => import("./ConcertTicketCard"), "ConcertTicketCard");

// A feed can open before it contains an attendance ticket. Keep the complete
// card in one deferred web entry, shared by feed posts and the ticket composer.
export default function DeferredConcertTicketCard(props) {
  return <Suspense fallback={<Pressable
    testID="attendance-ticket-loading" style={[{ minHeight: 220, padding: 20, justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.surface }, props.style]}
    onPress={props.onPress} disabled={!props.onPress} accessibilityRole={props.onPress ? "button" : undefined}
    accessibilityLabel={props.ticket?.eventTitle || "Concert ticket"} accessibilityHint={props.accessibilityHint}>
    <Text style={{ color: colors.text }}>{props.ticket?.eventTitle || "Concert ticket"}</Text>
    <Text accessibilityLiveRegion="polite" style={{ color: colors.textDim }}>Loading ticket…</Text>
  </Pressable>}><ConcertTicketCard {...props} /></Suspense>;
}
