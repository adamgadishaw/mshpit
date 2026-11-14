import { useState } from 'react';
import { View, Text } from 'react-native';
import useVenueCommunity from './useVenueCommunity';
import { VenueAction, VenueResourceState, styles } from './VenueCommunityControls';

export default function VenueClaimHistory({ accountId, onOpenVenue, onChanged }) {
  const [after, setAfter] = useState(null);
  const model = useVenueCommunity(`/api/me/venue-claims?status=all${after ? `&after=${encodeURIComponent(after)}` : ''}`, accountId);
  return <View style={styles.form}>
    <Text style={styles.title}>Your venue requests</Text><VenueResourceState model={model} />
    {model.resource.data?.claims.length === 0 && <Text style={styles.body}>No requests on this page.</Text>}
    {model.resource.data?.claims.map(claim => <View key={claim.id} style={styles.review}>
      <VenueAction label={claim.venue_name} onPress={() => onOpenVenue?.({ name: claim.venue_name, path: claim.venue_path })} />
      <Text style={styles.body}>{claim.status === 'cancelled' ? 'Withdrawn' : claim.status}</Text>
      {claim.status === 'pending' && <VenueAction label={`Withdraw request for ${claim.venue_name}`} disabled={model.busy}
        onPress={async () => { const result = await model.write(`/api/venue-community/claims/${encodeURIComponent(claim.id)}`, 'DELETE', {}); if (result?.ok) void onChanged?.(); }} />}
    </View>)}
    {!!model.resource.data?.nextCursor && <VenueAction label="Next venue requests" disabled={model.busy} onPress={() => setAfter(model.resource.data.nextCursor)} />}
    {!!after && <VenueAction label="First venue requests" disabled={model.busy} onPress={() => setAfter(null)} />}
  </View>;
}
