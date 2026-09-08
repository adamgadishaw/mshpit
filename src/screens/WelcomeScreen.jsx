import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BrandMark from "../components/BrandMark";
import Button from "../components/Button";
import SheetHeader from "../components/SheetHeader";
import WelcomeGuide from "../features/signupOnboarding/WelcomeGuide";
import { useStore } from "../store";
import { colors, displayFont, mono, radius, space } from "../theme";

// The menu's product guide uses the same real entry points as account setup.
// It never joins clubs, follows artists or publishes on the member's behalf.
export default function WelcomeScreen({ onClose, onOpenFanClubs, onOpenNearby, onOpenArtists, onReview }) {
  const { session } = useStore();
  const insets = useSafeAreaInsets();
  const choose = (destination) => {
    if (destination === "shows") onOpenNearby?.();
    else if (destination === "artists") onOpenArtists?.();
    else if (destination === "review") onReview?.();
  };
  return <View style={styles.wrap} accessibilityViewIsModal>
    <SheetHeader title="Welcome to Mshpit" onBack={onClose} />
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 24) }]}>
      <View style={styles.brand}><BrandMark size={32} color={colors.amber} /><Text style={styles.kicker}>LIVE MUSIC, REMEMBERED</Text></View>
      <Text style={styles.title} accessibilityRole="header">How MSHpit works</Text>
      <Text style={styles.subtitle}>Hey {String(session?.name || "there").split(" ")[0]}. Mshpit is a social network for live music. Find your next show, remember your last one, and meet the people in between.</Text>
      <View style={styles.ticket}>
        <Text style={styles.ticketHeading}>Your next move</Text>
        <Text style={styles.ticketText}>You do not need to fill out everything before exploring. Start with whatever brought you here.</Text>
      </View>
      <WelcomeGuide onChoose={choose} />
      <View style={styles.community}><Text style={styles.heading}>Find your people</Text><Text style={styles.body}>Follow fans whose reviews you trust. When you attend and log it, tag your concert buddies. Share the night on the show’s page, or join the conversation in a fan club.</Text><Button title="Explore fan clubs" variant="secondary" icon="you" onPress={onOpenFanClubs} /></View>
      <Button title="Back to Mshpit" onPress={onClose} />
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { width: "100%", maxWidth: 648, alignSelf: "center", padding: space(4), paddingTop: space(6), gap: space(4) },
  brand: { flexDirection: "row", alignItems: "center", gap: space(3) }, kicker: { color: colors.amber, fontFamily: mono, fontSize: 10, letterSpacing: 1.5, fontWeight: "800" },
  title: { color: colors.text, fontFamily: displayFont, fontSize: 32, fontWeight: "900", letterSpacing: -0.7 },
  subtitle: { color: colors.textDim, fontSize: 15, lineHeight: 23 },
  ticket: { padding: space(4), borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, borderLeftWidth: 4, borderLeftColor: colors.amber, backgroundColor: colors.surfaceAlt, gap: space(2) },
  ticketHeading: { color: colors.text, fontFamily: displayFont, fontWeight: "900", fontSize: 20 }, ticketText: { color: colors.textDim, fontSize: 13, lineHeight: 20 },
  community: { gap: space(3), paddingVertical: space(3) }, heading: { color: colors.text, fontSize: 20, fontWeight: "900", fontFamily: displayFont }, body: { color: colors.textDim, fontSize: 13, lineHeight: 20 },
});
