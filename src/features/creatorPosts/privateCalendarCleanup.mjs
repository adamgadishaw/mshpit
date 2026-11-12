// A server-confirmed cleanup capability is not a managed creator identity.
// This request can only cancel the selected immutable event/revision.
export function privateCalendarWithdrawal(event, clientMutationId) {
  if (!event?.withdrawal?.entityKey || !event.id || !Number.isSafeInteger(event.revision)
    || event.revision < 1 || !['scheduled','blocked'].includes(event.publicationState)
    || event.status === 'cancelled') throw new Error('Refresh your private calendar before withdrawing this show.');
  return { clientMutationId, kind: 'status', review: '', creatorUpdate: {
    version: 1, entityType: 'artist', entityKey: event.withdrawal.entityKey, kind: 'show',
    title: 'Scheduled show withdrawn', date: event.date,
    location: [event.venue,event.place].filter(Boolean).join(', ').slice(0,200), url: event.ticketUrl || '',
    calendar: { action: 'cancel', eventId: event.id, expectedRevision: event.revision,
      venue: event.venue, place: event.place, releaseAt: 0 },
  } };
}

export function confirmedPrivateWithdrawal(result, body) {
  const receipt=result?.calendarReceipt, calendar=body.creatorUpdate.calendar;
  return !result?.post && !result?.id && receipt?.state === 'cancelled'
    && receipt.mutationId === body.clientMutationId && receipt.eventId === calendar.eventId
    && receipt.revision === calendar.expectedRevision + 1;
}
