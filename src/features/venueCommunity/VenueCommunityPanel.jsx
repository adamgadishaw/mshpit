import { useEffect, useState } from 'react';
import TapStars from '../../components/TapStars';
import { View, Text, TextInput, Pressable } from 'react-native';
import { colors } from '../../theme';
import useVenueCommunity from './useVenueCommunity';
import { styles, VenueAction, VenueResourceState } from './VenueCommunityControls';
import VenueCreatorSection from './VenueCreatorSection';
import VenueClaimHistory from './VenueClaimHistory';

export default function VenueCommunityPanel({ path, venueName, session, canClaim, privacyRevision = 0, onRequireAuth, onReport, onOpenProfile, onOpenVenue, onOpenPost, onCompose, renderUpdates, onRatingChange }) {
  const [after, setAfter] = useState(null);
  const model = useVenueCommunity(`/api/venue-community?path=${encodeURIComponent(path)}&revision=${privacyRevision}${after ? `&after=${encodeURIComponent(after)}` : ''}`, session?.id);
  const data = model.resource.data;
  useEffect(() => { if (data) onRatingChange?.(data.stats || { ratingCount: data.rating.count, averageRating: data.rating.average }); }, [data, onRatingChange]);
  const [editing, setEditing] = useState(false), [rating, setRating] = useState(0), [text, setText] = useState('');
  const [claimOpen, setClaimOpen] = useState(false), [website, setWebsite] = useState(''), [note, setNote] = useState('');
  const [saved, setSaved] = useState(''), [conversionAccepted, setConversionAccepted] = useState(false), [historyOpen, setHistoryOpen] = useState(false);
  const canRequest = !session || ['fan', 'venue'].includes(session.role);
  const edit = () => {
    if (!session) return onRequireAuth?.();
    setRating(data?.myReview?.rating || 0); setText(data?.myReview?.text || ''); setEditing(true); setSaved('');
  };
  const submit = async (route, method, body, done) => {
    setSaved(''); const result = await model.write(route, method, body); if (result?.ok) done();
  };
  return <View style={styles.panel}>
    <Text accessibilityRole="header" style={styles.title}>Venue community</Text>
    <VenueResourceState model={model} />
    {data && <>
      <Text style={styles.badge}>{data.ownership === 'verified' ? 'Verified venue operator' : 'Community-run page'}</Text>
      <Text style={styles.body}>{data.ownership === 'verified' ? 'Managed by the venue. Ratings are from fans.' : 'Photos and ratings from concertgoers.'}</Text>
      {!!data.creatorEntity && <VenueCreatorSection key={`${session?.id || 'guest'}:${path}:${privacyRevision}`} entity={data.creatorEntity}
        session={session} isOperator={data.isOperator} onCompose={onCompose} onOpenPost={onOpenPost} onRequireAuth={onRequireAuth} renderUpdates={renderUpdates} />}
      <Text style={styles.score}>{data.rating.count ? `${Number(data.rating.average).toFixed(1)} / 5 \u00b7 ${data.rating.count} ${data.rating.count === 1 ? 'rating' : 'ratings'}` : 'No venue ratings yet'}</Text>
      <Text style={styles.body}>Sound, sightlines, staff and accessibility. Update your rating anytime.</Text>
      {!editing && <VenueAction label={data.myReview ? 'Edit your venue rating' : 'Rate this venue'} onPress={edit} />}
      {editing && <View style={styles.form}>
        <TapStars value={rating} onChange={value => { if (!model.busy) setRating(value); }} size={36} gap={8} accessibilityLabel="Your venue rating" />
        <TextInput accessibilityLabel="Your venue review" placeholder="What should other concertgoers know? (optional)" placeholderTextColor={colors.textFaint} value={text} onChangeText={setText} editable={!model.busy} multiline maxLength={2000} style={styles.input} />
        <VenueAction label={model.busy ? 'Saving...' : 'Save venue rating'} disabled={!rating || model.busy} onPress={() => submit('/api/venue-community/rating', 'PUT', { path, rating, text }, () => { setEditing(false); setSaved('Your venue rating is saved.'); })} />
        {!!data.myReview && <VenueAction label="Remove your rating" disabled={model.busy} onPress={() => submit('/api/venue-community/rating', 'DELETE', { path }, () => { setEditing(false); setSaved('Your rating was removed.'); })} />}
        <VenueAction label="Cancel rating edit" disabled={model.busy} onPress={() => setEditing(false)} />
      </View>}
      {!!saved && <Text accessibilityLiveRegion="polite" style={styles.body}>{saved}</Text>}
      {data.reviews.map(review => <View key={review.id} style={styles.review}>
        <VenueAction label={review.name} onPress={() => onOpenProfile?.(review.userId)} />
        <Text style={styles.body}>{review.rating} / 5</Text><Text style={styles.body} selectable>{review.text || 'Rated this venue'}</Text>
        {session && review.userId !== session.id && <VenueAction label={`Report review by ${review.name}`} onPress={() => onReport?.({ targetType: 'venue_review', targetId: review.id, ownerId: review.userId, targetName: 'venue review', title: `${venueName} review`, summary: review.text })} />}
      </View>)}
      {!!data.nextCursor && <VenueAction label="Next venue reviews" disabled={model.busy} onPress={() => setAfter(data.nextCursor)} />}
      {!!after && <VenueAction label="First venue reviews" disabled={model.busy} onPress={() => setAfter(null)} />}
      {data.isOperator && <Text style={styles.body}>You are the verified operator for this venue.</Text>}
      {data.claim?.status === 'pending' ? <>
        <Text style={styles.body}>Your claim is pending staff review. It does not grant page ownership or posting access.</Text>
        {data.claim.conversion_consent !== 'venue-account-v1' && <VenueAction label="Confirm account change for this request" onPress={() => { setWebsite(data.claim.website || ''); setNote(data.claim.note || ''); setClaimOpen(true); }} />}
        <VenueAction label="Withdraw venue claim" disabled={model.busy} onPress={() => submit(`/api/venue-community/claims/${encodeURIComponent(data.claim.id)}`, 'DELETE', {}, () => setSaved('Your claim was withdrawn.'))} />
      </> : data.ownership === 'community' && <>
        {data.claim && <Text style={styles.body}>Your previous claim: {data.claim.status}.</Text>}
        {!canClaim ? <Text style={styles.body}>Operator claims open once this venue has a confirmed catalogue identity.</Text> : !canRequest ? <Text style={styles.body}>Use a separate account dedicated to this venue. Artist, event and staff accounts keep their existing identities.</Text> : <VenueAction label="Claim this venue" onPress={() => session ? setClaimOpen(value => !value) : onRequireAuth?.()} />}
      </>}
      {claimOpen && canRequest && <View style={styles.form}>
        <Text style={styles.body}>Use an account dedicated to this venue with a confirmed email. Staff must check official evidence and your authority. Approval changes this account to a venue account and signs it out. Pending requests do not change your account.</Text>
        <Text style={styles.body}>Do not include passwords or private identity documents.</Text>
        <TextInput accessibilityLabel="Official venue website" placeholder="https://venue.example" placeholderTextColor={colors.textFaint} autoCapitalize="none" keyboardType="url" value={website} onChangeText={setWebsite} maxLength={500} editable={!model.busy} style={styles.input} />
        <TextInput accessibilityLabel="Your role at the venue" placeholder="Your role and how we can verify it" placeholderTextColor={colors.textFaint} value={note} onChangeText={setNote} multiline maxLength={2000} editable={!model.busy} style={styles.input} />
        <VenueAction label={conversionAccepted ? 'Venue account change acknowledged' : 'I agree to the venue account change if approved'} disabled={model.busy} onPress={() => setConversionAccepted(value => !value)} />
        <VenueAction label={model.busy ? 'Submitting...' : 'Submit claim for review'} disabled={model.busy || !conversionAccepted || !website.trim() || note.trim().length < 20} onPress={() => submit('/api/venue-community/claims', 'POST', { path, website, note, accountConversionAcknowledged: conversionAccepted }, () => { setClaimOpen(false); setConversionAccepted(false); setSaved('Claim submitted for review.'); })} />
        <VenueAction label="Cancel claim" disabled={model.busy} onPress={() => setClaimOpen(false)} />
      </View>}
      {!!session && <><VenueAction label={historyOpen ? 'Hide your venue requests' : 'Your venue requests'} onPress={() => setHistoryOpen(value => !value)} />
        {historyOpen && <VenueClaimHistory accountId={session.id} onOpenVenue={onOpenVenue} onChanged={model.load} />}</>}
    </>}
  </View>;
}
