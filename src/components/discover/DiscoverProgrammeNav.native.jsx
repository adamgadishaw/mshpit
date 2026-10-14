import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, font } from '../../theme';
import { DISCOVER_PROGRAMME_SECTIONS } from '../../domain/discoverProgramme.mjs';
export default function DiscoverProgrammeNav({ selected, onSelect }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.content} style={styles.scroll}>
    <View style={styles.tabs} accessibilityRole="tablist" accessibilityLabel="Discover sections">
      {DISCOVER_PROGRAMME_SECTIONS.map(section => <Pressable key={section.key}
        nativeID={'discover-tab-' + section.key} accessibilityRole="tab" accessibilityLabel={section.label}
        accessibilityState={{ selected: selected === section.key }} onPress={() => onSelect(section.key)}
        style={({ pressed }) => [styles.tab, pressed && { opacity: 0.6 }]}>
        <Text style={[styles.label, selected === section.key && styles.selected]}>{section.label}</Text>
        {selected === section.key && <View style={styles.indicator} pointerEvents="none" />}
      </Pressable>)}
    </View>
  </ScrollView>;
}
const styles = StyleSheet.create({
  scroll: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  content: { flexGrow: 1 }, tabs: { flexDirection: 'row', flexGrow: 1 },
  tab: { minWidth: 70, minHeight: 48, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  label: { color: colors.textDim, fontFamily: font, fontSize: 14, fontWeight: '500' },
  selected: { color: colors.text, fontWeight: '700' },
  indicator: { position: 'absolute', height: 3, bottom: 0, left: 12, right: 12, backgroundColor: colors.amberStrong },
});

