import { useEffect, useReducer, useRef } from "react";
import { Text, View } from "react-native";
import { toAppError } from "../../lib/diagnostics";
import { localAlertClient } from "./localAlertService";
import { createLocalAlertSettingsController } from "./localAlertSettingsController.mjs";
import LocalPushSettings from "./LocalPushSettings";

export default function LocalAlertSettings({ accountId, authEpoch, Row, Toggle, styles, onManageProfile }) {
  const [, render] = useReducer(value => value + 1, 0);
  const ref = useRef(null);
  if (!ref.current) ref.current = createLocalAlertSettingsController({ api: localAlertClient, onChange: render,
    toAppError: error => toAppError(error, { code: "PIT-NET-001", message: "Show notification settings could not be saved. Try again.", retryable: true }) });
  const controller = ref.current;
  controller.setAccount(accountId, authEpoch);
  const state = controller.snapshot(), preferences = state.data?.preferences;
  const commands = controller.commands();
  const busy = state.status === "loading" || state.status === "refreshing";
  useEffect(() => { void controller.commands().load(); return () => controller.stop(); }, [controller, accountId, authEpoch]);
  return <>
    <Text style={styles.section}>SHOW NOTIFICATIONS</Text>
    <Text style={styles.hint}>Updates from artists you follow or add to your favourites.</Text>
    {!preferences && busy && <Text style={styles.hint}>Loading notification settings.</Text>}
    {state.error && <View accessibilityRole="alert"><Text style={styles.hint}>{state.error.userMessage || state.error.message}</Text>
      <Row icon="repeat" label="Try notification settings again" onPress={commands.load} disabled={busy} /></View>}
    {!!preferences && <>
      <Row icon="music" label="Tour dates in Activity" sub="New shows in any city" disabled={busy} accessibilityRole="switch" accessibilityState={{ checked: preferences.datesInbox }}
        right={<Toggle value={preferences.datesInbox} busy={busy} />} onPress={() => commands.save({ ...preferences, datesInbox: !preferences.datesInbox })} />
      <Row icon="calendar" label="Tickets on sale in Activity" sub="Shows in your home city" disabled={busy} accessibilityRole="switch" accessibilityState={{ checked: preferences.salesInbox }}
        right={<Toggle value={preferences.salesInbox} busy={busy} />} onPress={() => commands.save({ ...preferences, salesInbox: !preferences.salesInbox })} />
      <Row icon="pin" label={state.data.homeCity ? `Home city: ${state.data.homeCity.city}` : "Choose your home city"}
        sub="Change your profile location for local ticket alerts." onPress={onManageProfile} />
      {state.data.deliveryEnabled === false && <Text style={styles.hint}>Show alerts are not enabled on this server yet. Your preferences are saved.</Text>}
      <LocalPushSettings key={`${accountId}:${authEpoch}`} preferences={preferences} onSave={commands.save} busy={busy}
        Row={Row} Toggle={Toggle} styles={styles} pushDeliveryEnabled={state.data.pushDeliveryEnabled} />
    </>}
  </>;
}
