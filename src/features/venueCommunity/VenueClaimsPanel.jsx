import { useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { colors } from '../../theme';
import useVenueCommunity from './useVenueCommunity';
import { styles, VenueAction, VenueResourceState } from './VenueCommunityControls';

function Claim({ claim, model }) {
  const [note, setNote] = useState(''), [reference, setReference] = useState('');
  const [authority, setAuthority] = useState(false), [official, setOfficial] = useState(false), [conversion, setConversion] = useState(false), [revoke, setRevoke] = useState(false);
  const [method, setMethod] = useState('official_contact');
  const review = decision => model.write(`/api/admin/venue-claims/${encodeURIComponent(claim.id)}/review`, 'POST', {
    decision, note, reference, method, authorityConfirmed: authority, officialEvidenceConfirmed: official,
    conversionConfirmed: conversion, revocationConfirmed: revoke, expectedOwnerId: decision === 'revoked' ? claim.current_owner_id : null,
  });
  return <View style={styles.panel}>
    <Text style={styles.title}>{claim.venue_name}</Text><Text style={styles.body} selectable>{claim.venue_path}</Text>
    <Text style={styles.body} selectable>Applicant: {claim.name}{'\n'}Account: {claim.account_role || 'Not available'}{'\n'}Request: {claim.status}{claim.page_status ? ` / page ${claim.page_status}` : ''}{'\n'}Official website supplied: {claim.website}{'\n'}{claim.note}</Text>
    {!!claim.review_reference && <Text style={styles.body} selectable>Reviewed evidence: {claim.review_reference}</Text>}
    {!!claim.review_note && <Text style={styles.body} selectable>Review record: {claim.review_note}</Text>}
    {claim.status === 'pending' && <>
      <Text style={styles.body}>Independently contact the venue using a trusted official source. Applicant-provided links alone do not establish authority. Approval converts an eligible personal account to a venue account and signs it out.</Text>
      {claim.conversion_consent !== 'venue-account-v1' && <Text style={styles.body}>The applicant must confirm the account change before approval.</Text>}
      <VenueAction label={`Verification method: ${method === 'official_contact' ? 'Official contact' : 'Domain challenge'} (change)`} disabled={model.busy} onPress={() => setMethod(value => value === 'official_contact' ? 'domain_challenge' : 'official_contact')} />
      <TextInput accessibilityLabel="Independent official evidence link" placeholder="https://official-source.example" placeholderTextColor={colors.textFaint} value={reference} onChangeText={setReference} editable={!model.busy} autoCapitalize="none" maxLength={500} style={styles.input} />
      <VenueAction label={official ? 'Official evidence checked' : 'Confirm official evidence was checked'} disabled={model.busy} onPress={() => setOfficial(value => !value)} />
      <VenueAction label={authority ? 'Claimant authority checked' : 'Confirm claimant authority was checked'} disabled={model.busy} onPress={() => setAuthority(value => !value)} />
      <VenueAction label={conversion ? 'Venue account conversion confirmed' : 'Confirm venue account conversion'} disabled={model.busy} onPress={() => setConversion(value => !value)} />
    </>}
    {['pending', 'approved'].includes(claim.status) && <TextInput accessibilityLabel="Venue claim review reason" placeholder="Evidence checked and reason for decision" placeholderTextColor={colors.textFaint} value={note} onChangeText={setNote} editable={!model.busy} multiline maxLength={1000} style={styles.input} />}
    {claim.status === 'pending' && <>
      <VenueAction label="Approve verified venue operator" disabled={model.busy || !official || !authority || !conversion || !reference || note.trim().length < 20 || claim.conversion_consent !== 'venue-account-v1' || !!claim.current_owner_id} onPress={() => review('approved')} />
      <VenueAction label="Reject venue claim" disabled={model.busy || note.trim().length < 20} onPress={() => review('rejected')} />
    </>}
    {claim.status === 'approved' && <>
      <Text style={styles.body}>Remove access to this venue only. Other owned pages and moderation restrictions stay in place. The account will be signed out.</Text>
      <VenueAction label={revoke ? 'Venue access removal confirmed' : 'Confirm removal of this venue access'} disabled={model.busy} onPress={() => setRevoke(value => !value)} />
      <VenueAction label="Revoke venue operator access" disabled={model.busy || !revoke || note.trim().length < 20 || claim.current_owner_id !== claim.user_id} onPress={() => review('revoked')} />
    </>}
  </View>;
}

const filters = [['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['revoked', 'Revoked'], ['cancelled', 'Withdrawn'], ['all', 'All']];
export default function VenueClaimsPanel({ accountId }) {
  const [status, setStatus] = useState('pending'), [after, setAfter] = useState(null);
  const model = useVenueCommunity(`/api/admin/venue-claims?status=${status}${after ? `&after=${encodeURIComponent(after)}` : ''}`, accountId);
  return <View style={styles.form}>
    <Text style={styles.title}>Venue operator claims</Text>
    <View style={styles.row}>{filters.map(([value, label]) => <VenueAction key={value} label={label} accessibilityLabel={`Show ${label.toLowerCase()} venue claims`} disabled={model.busy || status === value} onPress={() => { setStatus(value); setAfter(null); }} />)}</View>
    <VenueResourceState model={model} />
    {model.resource.data?.claims.length === 0 && <Text style={styles.body}>No {status === 'all' ? '' : `${status} `}claims on this page.</Text>}
    {model.resource.data?.claims.map(claim => <Claim key={`${accountId}:${claim.id}:${claim.status}`} claim={claim} model={model} />)}
    {!!model.resource.data?.nextCursor && <VenueAction label="Next claims" disabled={model.busy} onPress={() => setAfter(model.resource.data.nextCursor)} />}
    {!!after && <VenueAction label="First claims" disabled={model.busy} onPress={() => setAfter(null)} />}
  </View>;
}
