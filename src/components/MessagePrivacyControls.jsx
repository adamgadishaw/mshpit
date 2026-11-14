import { useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, focusRing, radius } from "../theme";
import Icon from "./Icon";

const CLOSED = Object.freeze({ expanded: false, confirmBlock: false, busy: "", message: "", error: false });
const RESULT_TEXT = {
  mute: "Account muted. You can still message each other.",
  unmute: "Account unmuted.",
  block: "Account blocked. You can unblock them here or in Settings.",
  unblock: "Account unblocked. Previous follows have not been restored.",
};
const FAILURE_TEXT = {
  mute: "This account could not be muted. Try again.",
  unmute: "This account could not be unmuted. Try again.",
  block: "This account could not be blocked. Try again.",
  unblock: "This account could not be unblocked. Try again.",
};

// The history owns this disclosure's layout; it never adds keyboard avoidance,
// a modal, or a second composer. The parent admission gate owns route validity.
export default function MessagePrivacyControls({ otherId, admitAction, controls }) {
  const {
    session, chatAuthEpoch, isBlocked, blockUser, unblockUser,
    isBlockMutationPending, isMuted, muteUser, unmuteUser,
  } = controls;
  const scope = JSON.stringify([session?.id || null, chatAuthEpoch, otherId || null]);
  const ownerRef = useRef(null);
  if (!ownerRef.current || ownerRef.current.scope !== scope || ownerRef.current.invalidated) {
    ownerRef.current = { scope, presentation: { active: false, retired: false }, pending: null, value: CLOSED };
  }
  const owner = ownerRef.current;
  const presentation = owner.presentation;
  const [state, setState] = useState(null);
  const value = state?.owner === owner ? state.value : CLOSED;
  owner.value = value;
  // Read current Store selectors after a captured button survives a rerender.
  owner.store = { isBlocked, blockUser, unblockUser, isBlockMutationPending, isMuted, muteUser, unmuteUser };

  useLayoutEffect(() => {
    // StrictMode/Suspense reconnect must not revive old callbacks or completions.
    if (owner.presentation.retired) {
      owner.presentation = { active: true, retired: false };
      owner.pending = null;
      owner.value = CLOSED;
      setState({ owner, value: CLOSED });
    } else owner.presentation.active = true;
    const mounted = owner.presentation;
    return () => { mounted.active = false; mounted.retired = true; };
  }, [owner]);

  const current = () => !!session?.id && !!otherId && session.id !== otherId
    && ownerRef.current === owner && !owner.invalidated && owner.presentation === presentation && presentation.active
    && typeof admitAction === "function" && admitAction();
  const update = (changes) => {
    owner.value = { ...owner.value, ...changes };
    setState({ owner, value: owner.value });
  };
  const beginBlock = () => {
    if (!current() || owner.pending || owner.store.isBlockMutationPending(otherId) || owner.store.isBlocked(otherId)) return;
    update({ confirmBlock: true, message: "", error: false });
  };
  const cancelBlock = () => {
    if (current() && !owner.pending) update({ confirmBlock: false });
  };
  const run = async (action) => {
    if (!current() || owner.pending || owner.store.isBlockMutationPending(otherId)) return;
    const blocked = owner.store.isBlocked(otherId), muted = owner.store.isMuted(otherId);
    if ((action === "block" && (blocked || !owner.value.confirmBlock))
      || (action === "unblock" && !blocked) || (action === "mute" && muted) || (action === "unmute" && !muted)) return;
    const commands = { mute: owner.store.muteUser, unmute: owner.store.unmuteUser, block: owner.store.blockUser, unblock: owner.store.unblockUser };
    // Claim before the first await or render so rapid taps issue one command.
    const flight = {};
    owner.pending = flight;
    update({ busy: action, confirmBlock: false, message: "", error: false });
    let result;
    try { result = await commands[action](otherId); } catch { result = { ok: false }; }
    if (owner.pending !== flight) return;
    owner.pending = null;
    if (!current()) {
      // If a retained route later returns, start a fresh disclosure instead of
      // showing a pending spinner or a result belonging to its old presentation.
      owner.invalidated = true;
      return;
    }
    update({ busy: "", message: result?.stale ? "" : result?.ok ? RESULT_TEXT[action] : FAILURE_TEXT[action], error: !result?.ok && !result?.stale });
  };

  if (!session?.id || !otherId || session.id === otherId) return null;
  const blocked = isBlocked(otherId), muted = isMuted(otherId);
  const busy = !!value.busy || isBlockMutationPending(otherId);
  const toggle = () => {
    if (current()) update({ expanded: !owner.value.expanded, confirmBlock: false });
  };

  return (
    <View style={styles.wrap} testID="message-privacy-controls">
      <Pressable style={({ focused }) => [styles.disclosure, focused && focusRing]} onPress={toggle}
        accessibilityRole="button" accessibilityLabel="Privacy and controls" accessibilityState={{ expanded: value.expanded }}>
        <Text style={styles.disclosureText}>Privacy and controls</Text>
        <Icon name={value.expanded ? "chevron-down" : "chevron-right"} size={17} color={colors.textDim} />
      </Pressable>
      {value.expanded ? (
        <View style={styles.content}>
          <Text style={styles.description}>Messages are stored on Pit’s servers and are not end-to-end encrypted. Pit can access message content to operate the service and review reports.</Text>
          <View style={styles.control}>
            <Text style={styles.description}>Muting this account hides their posts, suggestions, and social activity notifications across Pit. You can still message each other.</Text>
            <Pressable style={({ focused }) => [styles.button, busy && styles.disabled, focused && focusRing]} onPress={() => run(muted ? "unmute" : "mute")}
              disabled={busy} accessibilityRole="button" accessibilityLabel={muted ? "Unmute account" : "Mute account"} accessibilityState={{ disabled: busy, busy: value.busy === "mute" || value.busy === "unmute" }}>
              <Text style={styles.buttonText}>{value.busy === "mute" ? "Muting…" : value.busy === "unmute" ? "Unmuting…" : muted ? "Unmute account" : "Mute account"}</Text>
            </Pressable>
          </View>
          <View style={styles.control}>
            <Text style={styles.description}>{blocked && !busy ? "This account is blocked. Unblocking will not restore your previous follows." : "Block this account to stop direct messages and remove your follows of each other."}</Text>
            {value.confirmBlock ? (
              <View style={styles.confirmation}>
                <Text style={styles.description}>You won’t be able to message each other, and your follows of each other will be removed. Blocking does not erase existing messages. You can unblock later.</Text>
                <View style={styles.actions}>
                  <Pressable style={({ focused }) => [styles.button, busy && styles.disabled, focused && focusRing]} onPress={cancelBlock} disabled={busy}
                    accessibilityRole="button" accessibilityLabel="Cancel blocking account" accessibilityState={{ disabled: busy }}>
                    <Text style={styles.buttonText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={({ focused }) => [styles.button, styles.destructive, busy && styles.disabled, focused && focusRing]} onPress={() => run("block")} disabled={busy}
                    accessibilityRole="button" accessibilityLabel="Confirm block account" accessibilityState={{ disabled: busy }}>
                    <Text style={styles.destructiveText}>Block account</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable style={({ focused }) => [styles.button, !blocked && styles.destructive, busy && styles.disabled, focused && focusRing]}
                onPress={blocked ? () => run("unblock") : beginBlock} disabled={busy}
                accessibilityRole="button" accessibilityLabel={blocked ? "Unblock account" : "Block account"} accessibilityState={{ disabled: busy, busy: value.busy === "block" || value.busy === "unblock" }}>
                <Text style={blocked ? styles.buttonText : styles.destructiveText}>{value.busy === "block" ? "Blocking…" : value.busy === "unblock" ? "Unblocking…" : blocked ? "Unblock account" : "Block account"}</Text>
              </Pressable>
            )}
          </View>
          {value.busy ? <View style={styles.status} accessibilityLabel="Saving account control" accessibilityState={{ busy: true }}><ActivityIndicator size="small" color={colors.textDim} /><Text style={styles.description}>Saving…</Text></View> : null}
          {value.message ? <Text style={[styles.description, value.error && styles.error]} accessibilityRole="alert" accessibilityLiveRegion="polite">{value.message}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "stretch", borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.md, backgroundColor: colors.bgElev },
  disclosure: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  disclosureText: { flex: 1, color: colors.textDim, fontSize: 13, fontWeight: "700" },
  content: { gap: 14, paddingHorizontal: 12, paddingBottom: 14 },
  description: { color: colors.textDim, fontSize: 13, lineHeight: 19 },
  control: { gap: 8, borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: 12 },
  button: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 9 },
  buttonText: { color: colors.text, fontSize: 14, fontWeight: "700" },
  destructive: { borderColor: colors.danger },
  destructiveText: { color: colors.danger, fontSize: 14, fontWeight: "700" },
  confirmation: { gap: 10 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  disabled: { opacity: 0.6 },
  status: { flexDirection: "row", alignItems: "center", gap: 8 },
  error: { color: colors.danger },
});
