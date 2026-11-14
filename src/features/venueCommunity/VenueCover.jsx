import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { colors, displayFont } from '../../theme';
import { artistInitials } from '../../domain/artistInitials.mjs';
import { styles } from './VenueCommunityControls';

export default function VenueCover({ photo, name, loading }) {
  const [failedUri, setFailedUri] = useState(null);
  return <View>
    <View style={{ width: '100%', aspectRatio: 1, backgroundColor: colors.surfaceAlt, justifyContent: 'center', alignItems: 'center' }}
      accessibilityLabel={photo ? `Concert photo at ${name}, by ${photo.credit || 'a community member'}` : `${name}: no public concert photo yet`}>
      <Text style={{ fontFamily: displayFont, color: colors.textFaint, fontSize: 38, fontWeight: '800' }}>{artistInitials(name)}</Text>
      {photo?.uri && failedUri !== photo.uri && <Image source={{ uri: photo.uri }} contentFit="cover" cachePolicy="memory" recyclingKey={photo.uri}
        style={StyleSheet.absoluteFill} accessible={false} onError={() => setFailedUri(photo.uri)} />}
    </View>
    <Text style={[styles.body, { paddingHorizontal: 12, paddingTop: 6, fontSize: 11 }]}>
      {photo ? `Concert photo · ${photo.credit || 'Community member'}` : loading ? 'Loading concert photos…' : 'No public concert photo yet'}
    </Text>
  </View>;
}
