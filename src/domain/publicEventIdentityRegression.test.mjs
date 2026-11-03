import assert from 'node:assert/strict';
import test from 'node:test';
import { publicNavigationLinks, publicDirectoryItems } from './publicNavigationLinks.mjs';
import { liveEventTitle } from './liveDiscovery.mjs';
import { prepareShowNavigation } from './showNavigation.mjs';

const event = { id: 'tm_product', artist: 'Metallica', eventKind: 'concert', venue: 'Club Underground', providerVenueId: 'KovZ917AYLe', source: 'ticketmaster', performanceEvent: true };
test('event breadcrumbs require a confirmed explicit canonical artist slug', () => {
  for (const fields of [{}, { artistIdentityPending: true, artistPublicSlug: 'metallica' }, { artistPublicSlug: '../metallica' }, { artistPublicSlug: 'Metallica!' }, { artistPublicSlug: 'events' }]) {
    const links = publicNavigationLinks({ openLog: { ...event, artist: 'Outta Pocket, Companion of Fools, Deprave, Malice', ...fields } });
    assert.equal(links.some(link => link.href?.startsWith('/artist/')), false);
    assert.ok(links.some(link => link.href === '/venue/ticketmaster-kovz917ayle'));
    assert.ok(links.some(link => link.href === '/event/tm_product'));
  }
  const links = publicNavigationLinks({ openLog: { ...event, artist: 'AC/DC', artistPublicSlug: 'ac-dc-2' } });
  assert.ok(links.some(link => link.href === '/artist/ac-dc-2' && link.label === 'AC/DC'));
});
test('product titles survive directory and artist schedule navigation without becoming performer identities', () => {
  for (const eventName of ['Metallica - Suite Reservation', 'Metallica VIP Upgrade', 'Metallica Parking Pass', 'Metallica 2-Day Ticket (10/29/26 & 10/31/26) Cannot Split By Day']) {
    const row = { ...event, eventName };
    assert.equal(liveEventTitle(row), eventName);
    assert.equal(publicDirectoryItems('events', [row])[0].title, eventName);
    const destination = prepareShowNavigation(row).destination;
    assert.equal(liveEventTitle(destination), eventName);
    assert.equal(destination.artist, 'Metallica');
  }
  assert.equal(liveEventTitle({ ...event, eventName: 'Metallica Live' }), 'Metallica');
  assert.equal(liveEventTitle({ ...event, eventName: 'Music Weekend', eventKind: 'multi_day' }), 'Music Weekend');
});

test('same-event authoritative snapshots retain product titles independently of artist identity', async () => {
  const { normalizePublicEventSnapshot, publicEventSnapshotScope, readablePublicEventSnapshot } = await import('./publicEventSnapshot.mjs');
  const entity = { ...event, kind: 'event', publicEventSnapshot: true, path: '/event/tm_product', name: 'Metallica - Suite Reservation', eventName: 'Metallica - Suite Reservation', date: '2036-06-14' };
  const snapshot = normalizePublicEventSnapshot(entity, event.id);
  assert.equal(snapshot.eventName, entity.eventName);
  assert.equal(snapshot.artist, 'Metallica');
  const resource = { scope: publicEventSnapshotScope(event.id, null), data: snapshot, updatedAt: 1 };
  assert.equal(readablePublicEventSnapshot(resource, { eventId: 'other-event' }), null);
  assert.equal(readablePublicEventSnapshot(resource, { eventId: event.id }).eventName, entity.eventName);
});

test('pending, unresolved and confirmed event frames never retain a fabricated artist URL', () => {
  const frames = [
    { ...event, performanceEvent: undefined, kind: 'event', artistPublicSlug: 'stale-name', artistIdentityPending: true },
    { ...event, artistIdentityPending: false },
    { ...event, artistPublicSlug: 'metallica', artistIdentityPending: false },
  ];
  assert.deepEqual(frames.map(openLog => publicNavigationLinks({ openLog }).filter(link => link.href?.startsWith('/artist/')).map(link => link.href)), [[], [], ['/artist/metallica']]);
});

test('plural admission products retain titles in helper, directory and navigation', () => {
  for (const eventName of ['Metallica - Suite Reservations', 'Metallica - Hotel Packages', 'Metallica - Seat Upgrades']) {
    const row = { ...event, eventName };
    assert.equal(liveEventTitle(row), eventName);
    assert.equal(publicDirectoryItems('events', [row])[0].title, eventName);
    assert.equal(liveEventTitle(prepareShowNavigation(row).destination), eventName);
  }
});

test('compact event trails refresh only from matching account/event snapshots and explicit confirmations', async () => {
  const { normalizePublicEventSnapshot, publicEventSnapshotScope } = await import('./publicEventSnapshot.mjs');
  const openLog = { ...event, artistIdentityPending: true, artistPublicSlug: 'stale-name' };
  const data = normalizePublicEventSnapshot({ ...event, kind: 'event', path: '/event/tm_product', publicEventSnapshot: true,
    name: 'Metallica - Suite Reservations', eventName: 'Metallica - Suite Reservations', date: '2036-06-14', artistIdentityPending: false, artistPublicSlug: 'metallica' }, event.id);
  const resource = { scope: publicEventSnapshotScope(event.id, 'member-a'), status: 'ready', updatedAt: 1, data };
  const hrefs = (publicEventResource, accountId = 'member-a') => publicNavigationLinks({ openLog }, { publicEventResource, accountId }).filter(x => x.href?.startsWith('/artist/')).map(x => x.href);
  assert.deepEqual(hrefs(resource), ['/artist/metallica']);
  assert.deepEqual(hrefs(resource, 'member-b'), []);
  assert.deepEqual(hrefs({ ...resource, scope: publicEventSnapshotScope('other', 'member-a') }), []);
  assert.deepEqual(hrefs({ ...resource, status: 'refreshing' }), []);
  assert.deepEqual(hrefs({ ...resource, data: { ...data, artistIdentityPending: true, artistPublicSlug: 'metallica' } }), []);
  assert.deepEqual(hrefs({ ...resource, data: { ...data, artistPublicSlug: null } }), []);
});

test('away and return to the same event/account cannot reuse the earlier visit confirmation', async () => {
  const { publicEventTrailForVisit } = await import('./publicNavigationLinks.mjs');
  const { publicEventSnapshotScope } = await import('./publicEventSnapshot.mjs');
  const resource = { scope: publicEventSnapshotScope(event.id, 'member-a'), status: 'ready', updatedAt: 1,
    data: { ...event, artistPublicSlug: 'metallica', artistIdentityPending: false } };
  const oldVisit = { generation: 1, resource };
  const firstFrame = { openLog: { ...event, artistIdentityPending: true } };
  const returnedFrame = { openLog: { ...event, artist: 'Changed Billing', artistIdentityPending: true, artistPublicSlug: 'stale-name' } };
  const artistLinks = (frame, trail, generation) => publicNavigationLinks(frame, { accountId: 'member-a',
    publicEventResource: publicEventTrailForVisit(trail, generation) }).filter(x => x.href?.startsWith('/artist/')).map(x => x.href);
  assert.deepEqual(artistLinks(firstFrame, oldVisit, 1), ['/artist/metallica']);
  assert.deepEqual(artistLinks({}, oldVisit, 2), []);
  assert.deepEqual(artistLinks(returnedFrame, oldVisit, 3), []);
  assert.deepEqual(artistLinks(returnedFrame, { generation: 1, resource: { ...resource, updatedAt: 2 } }, 3), [], 'late old-visit results remain stale');
  assert.deepEqual(artistLinks(returnedFrame, { generation: 3, resource: { ...resource, status: 'loading', data: null } }, 3), []);
  assert.deepEqual(artistLinks(returnedFrame, { generation: 3, resource: { ...resource, data: { ...resource.data, artist: 'Changed Billing', artistIdentityPending: true, artistPublicSlug: null } } }, 3), []);
});
