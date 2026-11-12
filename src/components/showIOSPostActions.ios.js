import { ActionSheetIOS } from "react-native";

export default function showIOSPostActions(options, onSelect) {
  ActionSheetIOS.showActionSheetWithOptions(options, onSelect);
}
