import { useLayoutEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { colors } from "../../theme";
import Icon from "../../components/Icon";
import useNativeTabPreview from "../../hooks/useNativeTabPreview";

// Keep the three native sections mounted so map selection, paging and media
// state survive switching. Hidden sections do not participate in layout or VO.
export function ProfileSection({ section, active, children, onLayout }) {
  const hidden = section !== active;
  return <View testID={`profile-section-${section}`} onLayout={onLayout} style={hidden ? styles.nativeSectionHidden : undefined}
    accessibilityElementsHidden={hidden} importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}>
    {children}
  </View>;
}

export function ProfileIdentityRow({ children }) {
  return <View pointerEvents="box-none" style={styles.nativeIdentityTop}>{children}</View>;
}

export function ProfileOwnerActions({ actions, scope, largeText = false }) {
  const preview = useNativeTabPreview();
  const current = useRef({ actions, scope, preview });
  current.current = { actions, scope, preview };
  const active = useRef(null);
  const [presentation, setPresentation] = useState(null);
  // A native callback belongs to this committed presentation, not just the
  // account string. Layout cleanup fences unmount/Suspense before passive work;
  // reconnect issues fresh handlers instead of reviving captured old ones.
  useLayoutEffect(() => {
    if (preview) { active.current = null; setPresentation(null); return undefined; }
    const token = { scope };
    active.current = token;
    setPresentation(token);
    return () => { if (active.current === token) active.current = null; };
  }, [scope, preview]);
  return <View style={[styles.nativeOwnerActions, largeText && styles.nativeOwnerActionsLarge]}>
    {actions.filter((action) => ["inbox", "activity"].includes(action.key) && typeof action.onPress === "function").map((action) => (
      <Pressable key={action.key} testID={`profile-owner-${action.key}`} style={styles.nativeOwnerAction}
        accessibilityRole="button" accessibilityLabel={`${action.label}${action.badge > 0 ? `, ${action.badge} unread` : ""}`}
        onPress={() => {
          if (!current.current.preview && presentation && active.current === presentation && presentation.scope === scope && current.current.scope === scope) current.current.actions.find((item) => item.key === action.key)?.onPress?.();
        }}>
        <View><Icon name={action.icon} size={18} color={colors.text} />
          {action.badge > 0 ? <View style={styles.nativeOwnerBadge}><Text style={styles.nativeOwnerBadgeText}>{action.badge > 99 ? "99+" : action.badge}</Text></View> : null}
        </View>
        <Text style={styles.nativeOwnerLabel}>{action.label}</Text>
      </Pressable>
    ))}
  </View>;
}

export function ProfileSectionTabs({ active, largeText, onSelect }) {
  return <View style={[styles.nativeSections, largeText && styles.nativeSectionsLarge]} accessibilityRole="tablist" accessibilityLabel="Profile sections">
    {[["posts", "Posts"], ["shows", "Shows"], ["gallery", "Gallery"]].map(([key, label]) => (
      <Pressable key={key} testID={`profile-tab-${key}`} style={[styles.nativeSectionTab, key === active && styles.nativeSectionTabSelected]}
        accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: key === active }} onPress={() => onSelect(key)}>
        <Text style={[styles.nativeSectionLabel, key === active && styles.nativeSectionLabelSelected]}>{label}</Text>
      </Pressable>
    ))}
  </View>;
}

const styles = StyleSheet.create({
  nativeIdentityWithBanner: { marginTop: -32, paddingTop: 0 },
  nativeIdentityTop: { width: "100%", flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 12 },
  nativeManageButton: { minHeight: 44, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 12, backgroundColor: colors.surfaceAlt, paddingHorizontal: 14, paddingVertical: 10 },
  nativeOwnerActions: { flexDirection: "row", gap: 2, marginRight: 6 },
  nativeOwnerActionsLarge: { flexWrap: "wrap", marginHorizontal: 20, marginBottom: 12, gap: 16 },
  nativeOwnerAction: { maxWidth: "100%", minWidth: 48, minHeight: 52, alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 4 },
  nativeOwnerLabel: { flexShrink: 1, textAlign: "center", color: colors.textDim, fontSize: 11, fontWeight: "600" },
  nativeOwnerBadge: { position: "absolute", top: -8, right: -14, minWidth: 18, minHeight: 18, borderRadius: 9, backgroundColor: colors.magenta, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  nativeOwnerBadgeText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
  nativeSections: { flexDirection: "row", gap: 4, marginHorizontal: 20, marginTop: 20, padding: 4, borderRadius: 14, backgroundColor: colors.surfaceAlt },
  nativeSectionsLarge: { flexWrap: "wrap" },
  nativeSectionTab: { flex: 1, minWidth: 80, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10 },
  nativeSectionTabSelected: { backgroundColor: colors.surface },
  nativeSectionLabel: { color: colors.textDim, fontSize: 15, fontWeight: "600", flexShrink: 1 },
  nativeSectionLabelSelected: { color: colors.amber },
  nativeSectionHidden: { display: "none" },
});
export const hierarchyStyles = styles;
