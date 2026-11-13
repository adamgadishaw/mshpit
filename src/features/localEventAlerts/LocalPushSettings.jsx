import { Text } from "react-native";
export default function LocalPushSettings({ preferences, onSave, busy, Row, styles }) {
  return <>
    <Text style={styles.hint}>Phone and tablet notifications are managed in the mobile app. Activity alerts work separately.</Text>
    {(preferences.datesPush || preferences.salesPush) && <Row icon="bell" label="Turn off saved device alerts" disabled={busy}
      sub="Stops future show alerts on your registered devices." onPress={() => onSave({ ...preferences, datesPush: false, salesPush: false })} />}
  </>;
}
