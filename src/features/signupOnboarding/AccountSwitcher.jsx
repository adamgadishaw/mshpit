import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Avatar from "../../components/Avatar";
import Button from "../../components/Button";
import SheetHeader from "../../components/SheetHeader";
import CredentialForm, { CredentialInput, CredentialLabel } from "../../components/credential-form";
import { colors, displayFont, focusRing, radius, space } from "../../theme";
import { connectLinkedAccounts, loadLinkedAccounts } from "./accountSecurityService";

export default function AccountSwitcher({ session, switchAccount, onClose, onLogin, onAdd }) {
  const [resource, setResource] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  const request = useRef(null);
  const mounted = useRef(true);
  const owner = useRef(session?.id);
  owner.current = session?.id;
  const perform = async (action = "load", accountId) => {
    if (request.current || !session?.id) return;
    const sourceId = session.id, controller = new AbortController();
    request.current = controller; setBusy(true); setError("");
    try {
      const result = action === "switch" ? await switchAccount(accountId, { expectedAccountId: sourceId, signal: controller.signal })
        : action === "connect" ? await connectLinkedAccounts(sourceId, password, { signal: controller.signal })
          : await loadLinkedAccounts(sourceId, { signal: controller.signal });
      if (action === "switch" && result?.ok) { if (mounted.current && !controller.signal.aborted) onClose?.(); return; }
      if (!mounted.current || owner.current !== sourceId) return;
      if (action === "switch") throw result?.error || new Error("Could not confirm the account switch. Try again.");
      if (!Array.isArray(result?.accounts) || !result.accounts.some((row) => row.id === sourceId && row.isCurrent)) throw new Error("Could not load your accounts. Try again.");
      setResource(result); setPassword("");
      if (action === "connect") {
        setConnecting(false);
        if (!result.connected) setError("No second verified account matches this email and password. Confirm both accounts’ emails, or use a separate login if their passwords differ.");
      }
    } catch (failure) {
      if (mounted.current && owner.current === sourceId && !controller.signal.aborted) setError(typeof failure === "string" ? failure : failure?.message || "Could not load your accounts. Try again.");
    } finally {
      request.current = null;
      if (mounted.current && owner.current === sourceId) setBusy(false);
    }
  };
  const connect = async () => {
    if (!password) return;
    await perform("connect");
  };
  useEffect(() => {
    mounted.current = true;
    void perform();
    return () => { mounted.current = false; request.current?.abort(); };
    // The parent keys this screen to the active account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <View style={styles.page}>
    <SheetHeader title="Switch account" onClose={onClose} leadDisabled={busy} />
    <ScrollView keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <Text style={styles.heading} accessibilityRole="header">Your profiles</Text>
      <Text style={styles.detail}>Switch between verified accounts with the same email and password. Each keeps its own posts, messages and settings.</Text>
      {busy && !resource ? <ActivityIndicator accessibilityLabel="Loading accounts" color={colors.amber} /> : null}
      {(resource?.accounts || [session]).filter(Boolean).map((account) => {
        const current = account.id === session?.id;
        return <Pressable key={account.id} accessibilityRole="button" accessibilityLabel={`${account.name}, @${account.handle}${current ? ", current account" : ", switch account"}`} disabled={busy || current}
          style={({ focused, pressed }) => [styles.account, current && styles.current, focused && focusRing, pressed && { opacity: 0.8 }]}
          onPress={() => void perform("switch", account.id)}>
          <Avatar user={account} size={48} /><View style={styles.identity}><Text style={styles.name}>{account.name}</Text><Text style={styles.detail}>@{account.handle}</Text></View>
          <Text style={styles.status}>{current ? "Current" : "Switch"}</Text>
        </Pressable>;
      })}
      {!!error && <Text style={styles.error} accessibilityRole="alert" selectable>{error}</Text>}
      {!resource && !busy && <Button title="Try again" onPress={() => void perform()} variant="secondary" />}
      {!!resource?.canConnect && !connecting && <>
        <Text style={styles.detail}>Already have a second account? On older sessions, confirm your password once to connect it on this device. After that, switching doesn’t ask again.</Text>
        <Button title="Connect an existing account" variant="secondary" disabled={busy} onPress={() => setConnecting(true)} />
      </>}
      {connecting && <CredentialForm busy={busy} id="pit-connect-accounts" username={session?.email} onSubmit={connect} disabled={busy} style={styles.form}>
        <CredentialLabel htmlFor="current-password" style={styles.name}>Current password</CredentialLabel>
        <CredentialInput name="current-password" accessibilityLabel="Password to connect accounts" secureTextEntry autoComplete="current-password" autoCapitalize="none" autoCorrect={false} maxLength={100} value={password} onChangeText={setPassword} editable={!busy} returnKeyType="done" style={styles.input} />
        <Button submit title={busy ? "Connecting…" : "Connect accounts"} loading={busy} disabled={busy || !password} onPress={connect} />
        <Button title="Cancel" variant="secondary" disabled={busy} onPress={() => { setConnecting(false); setPassword(""); }} />
      </CredentialForm>}
      {!session?.emailVerified && <Text style={styles.detail}>Confirm your email before connecting or switching accounts.</Text>}
      <Button title="Log in to a different account" variant="secondary" disabled={busy} onPress={onLogin} />
      {session?.emailVerified && (resource?.accounts?.length || 1) < 2 && <Button title="Create a second account" variant="secondary" disabled={busy} onPress={onAdd} />}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), gap: space(4), maxWidth: 640, width: "100%", alignSelf: "center" },
  heading: { color: colors.text, fontFamily: displayFont, fontSize: 28, fontWeight: "900" },
  detail: { color: colors.textDim, fontSize: 14, lineHeight: 21, flexShrink: 1 },
  account: { flexDirection: "row", alignItems: "center", gap: space(3), padding: space(4), borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  current: { borderColor: colors.amber },
  identity: { flex: 1, minWidth: 0, gap: 3 },
  name: { color: colors.text, fontSize: 16, fontWeight: "800" },
  status: { color: colors.amber, fontSize: 12, fontWeight: "800" },
  error: { color: colors.danger, lineHeight: 21 },
  form: { gap: space(3) },
  input: { minHeight: 48, padding: space(3), borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.surface, color: colors.text, fontSize: 16 },
});
