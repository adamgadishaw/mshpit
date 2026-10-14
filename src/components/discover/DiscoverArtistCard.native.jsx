import { memo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { colors, font, radius } from '../../theme';
import { proxied, isHttp } from '../../lib/img';
import { artistInitials } from '../../domain/artistInitials.mjs';
import { discoverGenreLabel } from '../../domain/discoverView.mjs';
import { artistPath } from '../../domain/urls.mjs';
import { PublicPressableLink } from '../PublicWebLinks';
import Icon from '../Icon';
export const DiscoverArtistCard = memo(function DiscoverArtistCard({ row, detail = null, onOpen }) {
  const [failed, setFailed] = useState(false);
  const uri = !failed && row.photo ? (isHttp(row.photo) ? proxied(row.photo, 112) : row.photo) : null;
  const line = detail ?? [discoverGenreLabel(row.genre), row.topTrack?.title].filter(Boolean).join(' · ');
  return <PublicPressableLink href={artistPath(row)} onNavigate={() => onOpen?.(row)}
    accessibilityLabel={'Open ' + row.name + (line ? ', ' + line : '')}
    style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}>
    <View style={styles.art}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" recyclingKey={uri} accessible={false} onError={() => setFailed(true)} />
        : <Text style={styles.initials} accessible={false}>{artistInitials(row.name)}</Text>}
    </View>
    <View style={styles.copy}>
      <Text style={styles.name} numberOfLines={1}>{row.name}</Text>
      {line ? <Text style={styles.detail} numberOfLines={1}>{line}</Text> : null}
    </View>
    <Icon name="chevron-right" size={17} color={colors.textFaint} />
  </PublicPressableLink>;
});
export function DiscoverArtistGrid({ rows, detailFor = null, onOpen }) {
  return <View>{rows.map(row => <DiscoverArtistCard key={row.key || row.publicSlug || row.name} row={row} detail={detailFor?.(row)} onOpen={onOpen} />)}</View>;
}
const styles = StyleSheet.create({
  row: { minHeight: 80, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.lineSoft },
  art: { width: 52, height: 52, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  initials: { color: colors.textDim, fontFamily: font, fontSize: 17, fontWeight: '600' },
  copy: { flex: 1, minWidth: 0, gap: 4 }, name: { color: colors.text, fontFamily: font, fontSize: 16, fontWeight: '600' },
  detail: { color: colors.textDim, fontFamily: font, fontSize: 13 },
});

