import { useState } from "react";
import { View, Text, StyleSheet, Image, Pressable } from "react-native";
import { colors, mono } from "../theme";
import Icon from "./Icon";

// Full-screen image gallery with arrows. Works for any photo set on the app -
// venue photos, fan photos, review photos. Tap a thumbnail to open here.
export default function PhotoViewer({ photos = [], index = 0, onClose }) {
  const [i, setI] = useState(index);
  if (!photos.length) return null;
  const p = photos[i] || photos[0];
  const uri = typeof p === "string" ? p : p?.uri;
  const by = typeof p === "object" && p ? p.by : null;
  const prev = () => setI((x) => (x - 1 + photos.length) % photos.length);
  const next = () => setI((x) => (x + 1) % photos.length);

  return (
    <View style={styles.wrap}>
      <View style={styles.top}>
        <Text style={styles.count}>{i + 1} / {photos.length}</Text>
        <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
          <Icon name="x" size={22} color="#fff" />
        </Pressable>
      </View>

      <View style={styles.stage}>
        <Image source={{ uri }} style={styles.img} resizeMode="contain" />
        {photos.length > 1 && (
          <>
            <Pressable style={[styles.arrow, { left: 10 }]} onPress={prev} hitSlop={10}>
              <Icon name="chevron-left" size={26} color="#fff" />
            </Pressable>
            <Pressable style={[styles.arrow, { right: 10 }]} onPress={next} hitSlop={10}>
              <Icon name="chevron-right" size={26} color="#fff" />
            </Pressable>
          </>
        )}
      </View>

      {!!by && <Text style={styles.by}>Photo by {by}</Text>}
      {photos.length > 1 && (
        <View style={styles.dots}>
          {photos.slice(0, 12).map((_, d) => (
            <View key={d} style={[styles.dot, d === i && styles.dotOn]} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(6,7,11,0.97)", zIndex: 100 },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  count: { color: "#fff", fontFamily: mono, fontSize: 13, opacity: 0.85 },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  stage: { flex: 1, alignItems: "center", justifyContent: "center" },
  img: { width: "100%", height: "100%" },
  arrow: { position: "absolute", top: "50%", marginTop: -24, width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  by: { color: "rgba(255,255,255,0.7)", fontSize: 13, textAlign: "center", paddingVertical: 10 },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6, paddingBottom: 28, paddingTop: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.35)" },
  dotOn: { backgroundColor: colors.amber, width: 16 },
});
