import { Suspense } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../theme";

export default function ReviewDialog({ pages, review, onClose, fallback }) {
  return <Modal transparent visible animationType="none" presentationStyle="overFullScreen" onRequestClose={onClose} statusBarTranslucent>
    <SafeAreaView edges={["top", "bottom", "left", "right"]} style={[styles.backdrop, !review && styles.fullscreen]}>
      {review ? <Pressable testID="review-backdrop" accessibilityRole="button" accessibilityLabel="Dismiss review" onPress={onClose} style={StyleSheet.absoluteFill} /> : null}
      <View testID="review-dialog" accessibilityViewIsModal onAccessibilityEscape={onClose} style={[styles.sheet, !review && styles.fullscreenSheet]}>
        {/* PhotoViewer owns a portal: CSS hiding its parent cannot hide that
            portal. Unmount it for auth/report children; navigation remembers
            its selected media index before those actions. */}
        {pages.map((page, index) => index !== pages.length - 1 && page.key === "photos:" ? null : <View key={`${page.depth}:${page.key}`} style={[styles.fill, index !== pages.length - 1 && styles.hidden]}>
          <Suspense fallback={fallback}>{page.content}</Suspense>
        </View>)}
      </View>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
  hidden: { display: "none" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.68)", alignItems: "center", justifyContent: "center", padding: 12 },
  sheet: { width: "100%", maxWidth: 760, height: "94%", maxHeight: 1000, overflow: "hidden", borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg },
  fullscreen: { padding: 0, backgroundColor: colors.bg },
  fullscreenSheet: { maxWidth: "100%", height: "100%", maxHeight: "100%", borderRadius: 0, borderWidth: 0 },
});
