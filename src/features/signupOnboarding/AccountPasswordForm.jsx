import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import Button from "../../components/Button";
import SheetHeader from "../../components/SheetHeader";
import CredentialForm, { CredentialInput, CredentialLabel } from "../../components/credential-form";
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
  const passwordInput = useRef(null), confirmationInput = useRef(null);
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
  const field = (label, name, value, change, autoComplete, inputRef, nextRef) => <View style={{ gap: space(2) }}>
    <CredentialLabel htmlFor={name} style={{ color: colors.text, fontWeight: "700" }}>{label}</CredentialLabel>
    <CredentialInput ref={inputRef} name={name} accessibilityLabel={label} value={value} onChangeText={change} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete={autoComplete}
      returnKeyType={nextRef ? "next" : "done"} onSubmitEditing={nextRef ? () => nextRef.current?.focus() : undefined}
      maxLength={100} editable={!busy} style={{ minHeight: 48, padding: space(3), borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.surface, color: colors.text, fontSize: 16 }} />
  </View>;
  return <View style={{ flex: 1, backgroundColor: colors.bg }}>
    <SheetHeader title={cancelSetup ? "Cancel signup" : "Change password"} onClose={onClose} leadDisabled={busy} />
    <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space(4), gap: space(4), width: "100%", maxWidth: 640, alignSelf: "center" }}>
      <Text selectable style={{ color: colors.textDim, lineHeight: 22 }}>{cancelSetup
        ? "This deletes your unfinished account, its profile, and queues uploaded photos for deletion. This cannot be undone. Another account using the same email is not affected. Closing the browser without cancelling keeps your progress, subject to the account inactivity policy."
        : `Change the password for @${session?.handle || "your account"}. This signs out other devices for this account only.`}</Text>
      {!done && <CredentialForm busy={busy} id={cancelSetup ? "pit-cancel-signup" : "pit-change-password"} username={session?.email} onSubmit={submit} disabled={busy} style={{ gap: space(4) }}>
        {field("Current password", "current-password", currentPassword, setCurrentPassword, "current-password", undefined, cancelSetup ? undefined : passwordInput)}
        {!cancelSetup && <>{field("New password", "new-password", password, setPassword, "new-password", passwordInput, confirmationInput)}{field("Confirm new password", "confirm-password", confirmation, setConfirmation, "new-password", confirmationInput)}</>}
        <Button submit title={busy ? "Please wait…" : cancelSetup ? "Delete unfinished account" : "Change password"} onPress={submit} disabled={busy} loading={busy} />
      </CredentialForm>}
      {!!message && <Text selectable accessibilityRole="alert" style={{ color: done ? colors.good : colors.danger, lineHeight: 22 }}>{message}</Text>}
      <Button title={done ? "Back to Settings" : cancelSetup ? "Keep setting up" : "Cancel"} onPress={onClose} variant="secondary" disabled={busy} />
    </ScrollView>
  </View>;
}
