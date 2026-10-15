import { Alert } from "react-native";
// Same explicit confirmation and existing owner-delete callback as the post menu.
export function confirmOwnPostDelete(run) {
  Alert.alert("Delete post?", "This can't be undone.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: run },
  ]);
}
