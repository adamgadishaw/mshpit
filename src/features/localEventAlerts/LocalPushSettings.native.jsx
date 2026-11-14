import { useState, useSyncExternalStore } from "react";
import { Linking, Text, View } from "react-native";
import { nativePush } from "./nativePushService";

export default function LocalPushSettings({ preferences, onSave, busy, Row, Toggle, styles, pushDeliveryEnabled }) {
  const state = useSyncExternalStore(nativePush.subscribe, nativePush.snapshot);
  const commands = nativePush.commands();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);
  const act = async work => {
    setWorking(true); setError(null);
    try { const result = await work(); if (result?.ok === false) setError(result.error.userMessage || result.error.message); }
    catch { setError("Device notifications could not be updated. Try again."); }
    finally { setWorking(false); }
  };
  const save = next => act(async () => { const result = await onSave(next); if (result.ok) return commands.refreshDevice(); return result; });
  const pending = busy || working || state.status === "loading";
  return <>
    <Row icon="music" label="Tour dates on this account’s devices" sub="New shows in any city" disabled={pending}
      accessibilityRole="switch" accessibilityState={{ checked: preferences.datesPush }} right={<Toggle value={preferences.datesPush} busy={pending} />}
      onPress={() => save({ ...preferences, datesPush: !preferences.datesPush })} />
    <Row icon="calendar" label="Ticket alerts on this account’s devices" sub="Shows in your home city" disabled={pending}
      accessibilityRole="switch" accessibilityState={{ checked: preferences.salesPush }} right={<Toggle value={preferences.salesPush} busy={pending} />}
      onPress={() => save({ ...preferences, salesPush: !preferences.salesPush })} />
    {!state.capable ? <Text style={styles.hint}>Device notifications need a configured native build. Your preferences are saved.</Text> : <>
      <Row icon="bell" label={state.data?.enabled ? "Turn off notifications on this device" : "Enable notifications on this device"}
        sub="Your device permission and account preferences both apply." disabled={pending || (!state.data?.enabled && !preferences.datesPush && !preferences.salesPush)}
        onPress={() => act(state.data?.enabled ? commands.disableDevice : commands.enableDevice)} />
      {state.data?.reason === "permission-denied" && <Row icon="settings" label="Open device notification settings" sub="Allow notifications, then return here to enable this device."
        onPress={() => act(() => Linking.openSettings())} />}
    </>}
    {pushDeliveryEnabled !== true && <Text style={styles.hint}>Device delivery is not enabled on this server yet.</Text>}
    {(error || state.error) && <View accessibilityRole="alert"><Text style={styles.hint}>{error || state.error.userMessage || state.error.message}</Text></View>}
  </>;
}
