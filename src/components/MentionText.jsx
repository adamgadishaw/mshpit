import { Text } from "react-native";
import { colors } from "../theme";

// Renders user text with tappable @mentions. Pass onMention(handle) to navigate
// to that person's profile. Used in the lounge, comments, reviews, and DMs.
export default function MentionText({ text, style, onMention }) {
  const parts = String(text || "").split(/(@[a-zA-Z0-9_]+)/g);
  return (
    <Text style={style}>
      {parts.map((p, i) =>
        p.startsWith("@") ? (
          <Text key={i} style={{ color: colors.amber, fontWeight: "700" }} onPress={() => onMention?.(p.slice(1))}>
            {p}
          </Text>
        ) : (
          p
        )
      )}
    </Text>
  );
}
