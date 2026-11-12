import { View } from 'react-native';
import useVenueCommunity from './useVenueCommunity';
import { VenueAction, VenueResourceState, styles } from './VenueCommunityControls';

export default function VenueCreatorSection({ entity, session, isOperator, onCompose, onOpenPost, onRequireAuth, renderUpdates }) {
  const route = `/api/creators/venue/${encodeURIComponent(entity.entityKey)}/follow`;
  const follow = useVenueCommunity(session ? route : null, session?.id);
  const preference = follow.resource.data;
  const canCompose = isOperator && session?.role === 'venue' && !!onCompose;
  return <View style={styles.form}>
    {!canCompose && <>
      {!!session && <VenueResourceState model={follow} />}
      <VenueAction label={preference?.following ? 'Unfollow venue updates' : 'Follow venue updates'}
        disabled={follow.busy || (!!session && !preference)}
        onPress={() => session ? follow.write(route, 'PUT', { following: !preference.following }) : onRequireAuth?.()} />
    </>}
    {renderUpdates?.({ entityType: 'venue', entityKey: entity.entityKey, accountId: session?.id,
      following: preference?.following, onOpenPost, onCompose: canCompose ? () => onCompose(entity) : undefined })}
  </View>;
}
