import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useEffect, useRef, useState } from "react";
import { colors, font, radius, space } from "../../theme";
import Button from "../../components/Button";
import Icon from "../../components/Icon";
import NewsDeskEditor, { canUseNewsroom } from "./NewsDeskEditor";

export default function NewsroomScreen({ accountId, role, active = true, onClose, closeGuardRef }) {
  const composition = useRef({ dirty: false, busy: false, uploading: false, cancelUpload: null });
  const request = useRef(null);
  const [prompt, setPrompt] = useState(null);
  const [protectedForm, setProtectedForm] = useState(false);
  const askClose = (callbacks) => {
    const current = composition.current;
    if (!current.dirty && !current.busy) { callbacks.proceed(); return; }
    if (request.current) { callbacks.cancel?.(); return; }
    request.current = callbacks;
    setPrompt(current.uploading ? "upload" : current.busy ? "save" : "draft");
  };
  const askCloseRef = useRef(askClose);
  askCloseRef.current = askClose;
  useEffect(() => {
    if (!closeGuardRef) return undefined;
    const guard = (callbacks) => askCloseRef.current(callbacks);
    closeGuardRef.current = guard;
    return () => {
      if (closeGuardRef.current === guard) closeGuardRef.current = null;
      request.current?.cancel?.();
      request.current = null;
    };
  }, [closeGuardRef]);
  useEffect(() => {
    if (Platform.OS !== "web" || !protectedForm) return undefined;
    const protect = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [protectedForm]);
  const stay = (cancelUpload = false) => {
    if (cancelUpload) composition.current.cancelUpload?.();
    const pending = request.current;
    request.current = null;
    setPrompt(null);
    pending?.cancel?.();
  };
  const leave = () => {
    composition.current.cancelUpload?.();
    const pending = request.current;
    request.current = null;
    setPrompt(null);
    pending?.proceed?.();
  };
  return <View style={styles.screen}>
    <View style={styles.header}>
      <Pressable onPress={() => closeGuardRef ? onClose?.() : askClose({ proceed: () => onClose?.() })} style={styles.back} accessibilityRole="button" accessibilityLabel="Back"><Icon name="chevron-left" size={20} color={colors.text} /></Pressable>
      <Text style={styles.title} numberOfLines={1}>Newsroom</Text>
      <View style={styles.back} />
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {canUseNewsroom(role) ? <NewsDeskEditor accountId={accountId} role={role} active={active}
        onCompositionStateChange={(state) => { composition.current = state; setProtectedForm(state.dirty || state.busy); }} />
        : <Text style={styles.denied}>The newsroom is for the news team. Ask an admin for editor access.</Text>}
    </ScrollView>
    <Modal visible={!!prompt} transparent animationType="fade" onRequestClose={() => stay()}>
      <View style={styles.scrim}>
        <View style={styles.dialog} accessibilityViewIsModal accessibilityRole={Platform.OS === "web" ? "dialog" : undefined} accessibilityLabel="Leave Newsroom?">
          <Text style={styles.dialogTitle}>Leave Newsroom?</Text>
          <Text style={styles.dialogCopy}>{prompt === "upload"
            ? "The photo is still uploading. Leaving cancels the upload. Your article text stays saved on this device."
            : prompt === "save" ? "Your article is still saving. Its response may be uncertain; return to retry the same article safely."
              : "Your article stays saved on this device for this account. Return to Newsroom to continue."}</Text>
          <View style={styles.actions}>
            <Button small title="Keep editing" variant="secondary" onPress={() => stay()} />
            {prompt === "upload" ? <Button small title="Cancel upload" variant="secondary" onPress={() => stay(true)} /> : null}
            <Button small title="Leave" onPress={leave} />
          </View>
        </View>
      </View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", gap: space(2), paddingHorizontal: space(3), paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  back: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, color: colors.text, fontFamily: font, fontSize: 16, fontWeight: "900", textAlign: "center" },
  content: { padding: space(4), paddingBottom: space(10), maxWidth: 820, width: "100%", alignSelf: "center" },
  denied: { color: colors.textDim, fontFamily: font, fontSize: 14, textAlign: "center", marginTop: space(6) },
  scrim: { flex: 1, justifyContent: "center", alignItems: "center", padding: space(4), backgroundColor: "rgba(0,0,0,0.7)" },
  dialog: { width: "100%", maxWidth: 480, padding: space(4), gap: space(3), borderRadius: radius.md, backgroundColor: colors.surface },
  dialogTitle: { color: colors.text, fontFamily: font, fontWeight: "900", fontSize: 18 },
  dialogCopy: { color: colors.textDim, fontFamily: font, fontSize: 14, lineHeight: 21 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
});
