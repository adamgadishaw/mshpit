import { ActivityIndicator, Text, View } from 'react-native';
import NearbyAfterparty from '../components/NearbyAfterparty';
import Button from '../components/Button';
import usePublicVenueSnapshot from '../features/venuePublic/usePublicVenueSnapshot';
import { colors } from '../theme';

// Mounted only after the existing show disclosure opens. Directions use the
// same server-resolved physical venue as its page, never a name-only cache hit.
export default function AfterShowSection({ log, venueIdentity, accountId, lifecycle }) {
  const model = usePublicVenueSnapshot({ name: log.venue, identity: venueIdentity, accountId });
  const snapshot = model.resource.data;
  if (['loading', 'refreshing', 'idle'].includes(model.resource.status)) return <ActivityIndicator accessibilityLabel="Loading venue location" color={colors.amber} />;
  if (model.resource.status === 'error') return <View style={{ gap: 8 }}>
    <Text accessibilityRole="alert" style={{ color: colors.textDim }}>Venue location could not load.</Text>
    <Button small title="Retry venue location" onPress={() => { void model.load(); }} />
  </View>;
  return <NearbyAfterparty log={snapshot ? { ...log, venue: snapshot.venue.name, city: snapshot.venue.place } : log}
    coord={snapshot?.venue.coord || null} lifecycle={lifecycle} showTitle={false} />;
}
