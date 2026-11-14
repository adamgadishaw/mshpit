import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, font, space } from "../../theme";
import Icon from "../../components/Icon";
import FestivalsPanel from "./FestivalsPanel";

export default function FestivalsHubScreen({ onClose, onOpenFestival }) {
  const refreshRef = useRef(null);
  const operationRef = useRef(null);
  const liveRef = useRef(true);
  const [refreshing, setRefreshing] = useState(false);
  const registerRefresh = useCallback(refresh => { refreshRef.current = refresh; }, []);
  useEffect(() => { liveRef.current = true; return () => { liveRef.current = false; refreshRef.current = null; operationRef.current?.abort(); operationRef.current = null; }; }, []);
  const refresh = async () => {
    if (!liveRef.current || !refreshRef.current || operationRef.current) return;
    const controller = new AbortController(); operationRef.current = controller; setRefreshing(true);
    try { await refreshRef.current({ signal: controller.signal }); }
    catch { /* architecture: allow-empty-catch -- the panel owns the visible read error and retry */ }
    finally { if (operationRef.current === controller) { operationRef.current = null; setRefreshing(false); } }
  };
  return <View style={styles.screen}>
    <View style={styles.header}>
      <Pressable onPress={onClose} style={styles.back} accessibilityRole="button" accessibilityLabel="Back"><Icon name="chevron-left" size={20} color={colors.text} /></Pressable>
      <Text style={styles.title}>Festivals</Text><View style={styles.back} />
    </View>
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.amber} />}>
      <FestivalsPanel region="Worldwide" onOpenFestival={onOpenFestival} registerRefresh={registerRefresh} />
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg }, header: { flexDirection: "row", alignItems: "center", paddingHorizontal: space(3), paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, title: { flex: 1, color: colors.text, fontFamily: font, fontSize: 17, fontWeight: "800", textAlign: "center" },
  content: { padding: space(4), paddingBottom: space(10), maxWidth: 760, width: "100%", alignSelf: "center" },
});
