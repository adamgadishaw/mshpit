import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, focusRing } from "../theme";
import { contentPreview, DEFAULT_CONTENT_PREVIEW_LIMIT } from "../domain/contentPreview.mjs";

// The body and control are siblings so callers can safely render linked text
// (including MentionText) without nesting an interactive control inside it.
export default function ExpandableText({
  text,
  style,
  limit = DEFAULT_CONTENT_PREVIEW_LIMIT,
  compact = true,
  renderText,
  containerStyle,
  toggleStyle,
  toggleTextStyle,
  moreLabel = "See more",
  lessLabel = "See less",
  moreAccessibilityLabel = "Show full text",
  lessAccessibilityLabel = "Show less text",
}) {
  const original = text == null ? "" : String(text);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [compact, limit, original]);

  const preview = useMemo(
    () => contentPreview(original, { limit, expanded: !compact || expanded }),
    [compact, expanded, limit, original],
  );
  const expandable = compact && preview.expandable;
  const bodyProps = { text: preview.text, accessibilityLabel: original };
  const body = typeof renderText === "function"
    ? renderText(bodyProps)
    : <Text style={style} accessibilityLabel={bodyProps.accessibilityLabel}>{bodyProps.text}</Text>;

  return (
    <View style={containerStyle}>
      {body}
      {expandable ? (
        <Pressable
          style={({ pressed, focused }) => [
            styles.toggle,
            toggleStyle,
            pressed && styles.togglePressed,
            focused && focusRing,
          ]}
          onPress={() => setExpanded((value) => !value)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={expanded ? lessAccessibilityLabel : moreAccessibilityLabel}
          hitSlop={4}
        >
          <Text style={[styles.toggleText, toggleTextStyle]}>{expanded ? lessLabel : moreLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    borderRadius: 8,
    paddingHorizontal: 2,
  },
  togglePressed: { opacity: 0.7 },
  toggleText: { color: colors.amber, fontSize: 12.5, fontWeight: "900" },
});
