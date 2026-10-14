import { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, font, radius } from '../../theme';
import Icon from '../Icon';
import { filterDiscoverRows } from '../../domain/discoverView.mjs';
import { DiscoverArtistGrid } from './DiscoverArtistCard';
function DiscoverChart({ rows, source, query, onQuery, onOpenArtist }) {
  const [expanded, setExpanded] = useState(false);
  const filtered = useMemo(() => filterDiscoverRows(rows, query), [rows, query]);
  const visible = query || expanded ? filtered : filtered.slice(0, 8);
  return <View>
    <Text style={styles.title} accessibilityRole="header">{source === 'plays' ? 'What members are playing' : 'Popular artists'}</Text>
    <View style={styles.search}>
      <Icon name="search" size={18} color={colors.textDim} />
      <TextInput style={styles.input} value={query} onChangeText={onQuery} placeholder="Search artists" placeholderTextColor={colors.textFaint}
        accessibilityLabel="Search this artist list" returnKeyType="search" autoCapitalize="none" autoCorrect={false} />
      {!!query && <Pressable onPress={() => onQuery('')} style={styles.clear} accessibilityRole="button" accessibilityLabel="Clear artist search"><Icon name="x" size={18} color={colors.textDim} /></Pressable>}
    </View>
    {visible.length ? <DiscoverArtistGrid rows={visible} onOpen={onOpenArtist} /> : <View style={styles.empty} accessibilityLiveRegion="polite">
      <Text style={styles.emptyText}>{query ? 'No matches for “' + query.trim() + '”' : 'No artists are listed here yet.'}</Text>
      {!!query && <Pressable style={styles.more} onPress={() => onQuery('')} accessibilityRole="button"><Text style={styles.moreText}>Clear search</Text></Pressable>}
    </View>}
    {!query && filtered.length > 8 && <Pressable style={styles.more} onPress={() => setExpanded(value => !value)} accessibilityRole="button" accessibilityState={{ expanded }}>
      <Text style={styles.moreText}>{expanded ? 'Show fewer' : 'See all ' + filtered.length + ' artists'}</Text>
    </Pressable>}
  </View>;
}
export default memo(DiscoverChart);
const styles = StyleSheet.create({
  title: { color: colors.text, fontFamily: font, fontSize: 18, fontWeight: '700', marginBottom: 14 },
  search: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, paddingLeft: 12, marginBottom: 6 },
  input: { flex: 1, minWidth: 0, color: colors.text, fontFamily: font, fontSize: 15, paddingVertical: 10 },
  clear: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  more: { minHeight: 48, justifyContent: 'center', alignItems: 'center' }, moreText: { color: colors.amber, fontFamily: font, fontSize: 14, fontWeight: '600' },
  empty: { minHeight: 120, alignItems: 'center', justifyContent: 'center', paddingVertical: 20 }, emptyText: { color: colors.textDim, fontFamily: font, fontSize: 14 },
});

