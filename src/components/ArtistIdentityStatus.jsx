import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius } from "../theme";
import { artistSetupFailure } from "../domain/artistAccountSetup.mjs";

export default function ArtistIdentityStatus({ accountId, loadArtistAccount, onRequestVerification }) {
  return <IdentityStatus key={accountId || "guest"} loadArtistAccount={loadArtistAccount} onRequestVerification={onRequestVerification} />;
}

function IdentityStatus({ loadArtistAccount, onRequestVerification }) {
  const loader = useRef(loadArtistAccount); loader.current = loadArtistAccount;
  const [state, setState] = useState({ value: null, error: "", loading: true });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: "" }));
    void loader.current({ signal: controller.signal }).then((value) => {
      if (controller.signal.aborted) return;
      if (!value?.ok) throw new Error(artistSetupFailure(value).message);
      setState({ value, error: "", loading: false });
    }).catch((error) => { if (!controller.signal.aborted) setState((current) => ({ ...current, error: artistSetupFailure(error).message, loading: false })); });
    return () => controller.abort();
  }, [retry]);
  const held = state.value?.identityReview?.held === true;
  const verified = state.value?.profile?.verified === true && !held;
  return <View style={styles.box}>
    <Text style={styles.title}>{held ? "Your artist page is on identity-review hold" : verified ? "Your artist identity is verified" : state.value ? "Unverified artist page · free tools" : "Checking artist identity status…"}</Text>
    <Text style={styles.text}>{held ? "This saved page is held from public discovery while a possible identity conflict is reviewed. You can edit the draft. Submit official proof; a moderator must release the hold. This is different from an ordinary unverified page." : verified ? "The artist check records an owner-reviewed identity, not payment or popularity." : "No check means identity has not been confirmed. Official Instagram Story proof or other evidence is reviewed by the Mshpit owner. A matching name alone is not proof."}</Text>
    {!!state.error && <Text style={styles.error} accessibilityRole="alert">{state.error}</Text>}
    {!!state.error && <Pressable accessibilityRole="button" disabled={state.loading} onPress={() => setRetry(value => value + 1)} style={styles.action}><Text style={styles.actionText}>Retry identity status</Text></Pressable>}
    {onRequestVerification && <Pressable accessibilityRole="button" onPress={onRequestVerification} style={styles.action}><Text style={styles.actionText}>Request or check verification</Text></Pressable>}
  </View>;
}

const styles = StyleSheet.create({ box: { padding: 18, gap: 10, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.surface, marginTop: 14 }, title: { color: colors.text, fontSize: 16, fontWeight: "800" }, text: { color: colors.textDim, fontSize: 13, lineHeight: 21 }, error: { color: colors.danger, fontSize: 13, lineHeight: 20 }, action: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }, actionText: { color: colors.amber, fontSize: 14, fontWeight: "800" } });
