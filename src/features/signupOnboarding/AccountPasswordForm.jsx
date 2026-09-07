import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import Button from "../../components/Button";
import SheetHeader from "../../components/SheetHeader";
import { colors, radius, space } from "../../theme";
import { isPassword } from "../../domain/validation.mjs";
import { changeAccountPassword } from "./accountSecurityService";

export default function AccountPasswordForm({ onClose, session, deleteAccount, cancelSetup = false }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const active = useRef(null), mounted = useRef(true), owner = useRef(session?.id);
  owner.current = session?.id;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; active.current?.abort(); }; }, []);
  const submit = async () => {
    if (active.current || !session?.id) return;
    if (!currentPassword) { setMessage("Enter this account’s current password."); return; }
    if (!cancelSetup && (!isPassword(password) || password !== confirmation)) {
      setMessage(password !== confirmation ? "The new passwords don’t match." : "Use 8–100 characters with letters and numbers."); return;
    }
    const accountId = session.id, controller = new AbortController();
    active.current = controller; setBusy(true); setMessage("");
    try {
      const result = cancelSetup ? await deleteAccount(currentPassword, { onboardingOnly: true })
        : await changeAccountPassword(accountId, currentPassword, password, { signal: controller.signal });
      if (!mounted.current || owner.current !== accountId) return;
      if (!result?.ok || (!cancelSetup && result.accountId !== accountId)) throw result?.error || new Error("The change could not be confirmed.");
      setCurrentPassword(""); setPassword(""); setConfirmation(""); setDone(true);
      if (cancelSetup) onClose?.();
      else setMessage("Password changed for this account. Other devices are signed out; the other account’s password has not changed.");
    } catch (error) {
      if (mounted.current && owner.current === accountId) setMessage(typeof error === "string" ? error : error?.message || "Could not confirm the change. Please try again.");
    } finally { if (mounted.current) { active.current = null; setBusy(false); } }
  };
  const field = (label, value, change, autoComplete) => <View style={{ gap: space(2) }}>
    <Text style={{ color: colors.text, fontWeight: "700" }}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={change} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete={autoComplete}
      maxLength={100} editable={!busy} style={{ minHeight: 48, padding: space(3), borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.surface, color: colors.text, fontSize: 16 }} />
  </View>;
  return <View style={{ flex: 1, backgroundColor: colors.bg }}>
    <SheetHeader title={cancelSetup ? "Cancel signup" : "Change password"} onClose={onClose} leadDisabled={busy} />
    <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space(4), gap: space(4), width: "100%", maxWidth: 640, alignSelf: "center" }}>
      <Text selectable style={{ color: colors.textDim, lineHeight: 22 }}>{cancelSetup
        ? "This deletes your unfinished account, its profile, and queues uploaded photos for deletion. This cannot be undone. Another account using the same email is not affected. Closing the browser without cancelling leaves setup available with no expiry."
        : `Change the password for @${session?.handle || "your account"}. This signs out other devices for this account only.`}</Text>
      {!done && <>{field("Current password", currentPassword, setCurrentPassword, "current-password")}
        {!cancelSetup && <>{field("New password", password, setPassword, "new-password")}{field("Confirm new password", confirmation, setConfirmation, "new-password")}</>}
        <Button title={busy ? "Please wait…" : cancelSetup ? "Delete unfinished account" : "Change password"} onPress={submit} disabled={busy} loading={busy} />
      </>}
      {!!message && <Text selectable accessibilityRole="alert" style={{ color: done ? colors.good : colors.danger, lineHeight: 22 }}>{message}</Text>}
      <Button title={done ? "Back to Settings" : cancelSetup ? "Keep setting up" : "Cancel"} onPress={onClose} variant="secondary" disabled={busy} />
    </ScrollView>
  </View>;
}
