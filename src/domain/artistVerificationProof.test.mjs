import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import { artistChallengeState, artistReviewReady, instagramHandle, instagramStoryUrl } from './artistVerificationProof.mjs';

const now = 1_800_000_000_000;
const challenge = { id: 'av_fixture', method: 'instagram_story', artistName: 'New Band', instagramHandle: 'new.band', code: 'MSHPIT-FIXTURE', expiresAt: now + 1000, status: 'active' };
test('Instagram proof links must be exact HTTPS Stories for the bound account', () => {
  assert.equal(instagramHandle('@New.Band'), 'new.band');
  assert.equal(instagramStoryUrl('https://instagram.com/stories/New.Band/123456/?utm_source=test', '@new.band'), 'https://www.instagram.com/stories/new.band/123456/');
  for (const handle of ['.artist', 'artist.', 'some..artist']) assert.equal(instagramHandle(handle), '');
  for (const value of ['https://instagram.com/new.band/', 'https://instagram.com/stories/other/123/', 'http://instagram.com/stories/new.band/123/', 'https://instagram.com.evil.test/stories/new.band/123/', 'https://attacker@instagram.com/stories/new.band/123/', 'javascript:alert(1)']) assert.equal(instagramStoryUrl(value, 'new.band'), '');
});
test('challenge is name and handle bound and expires closed', () => {
  assert.equal(artistChallengeState(challenge, { artistName: 'New Band', handle: '@new.band', now }), 'active');
  assert.equal(artistChallengeState(challenge, { artistName: 'Other', handle: 'new.band', now }), 'mismatch');
  assert.equal(artistChallengeState(challenge, { artistName: 'New Band', handle: 'other', now }), 'mismatch');
  assert.equal(artistChallengeState(challenge, { artistName: 'New Band', handle: 'new.band', now: now + 1000 }), 'expired');
});
test('moderation requires direct official identity checks, observed live code and a reason', () => {
  const request = { proof: { method: 'instagram_story', challenge }, identityReview: { held: true } };
  const evidence = { method: 'instagram_story', reason: 'Inspected the established official artist account.', officialAccountConfirmed: true, ownershipConfirmed: true, identityReviewConfirmed: true, liveCodeObserved: true, observedCode: challenge.code, observedAt: now - 1 };
  assert.equal(artistReviewReady(request, evidence, now), true);
  for (const field of ['officialAccountConfirmed', 'ownershipConfirmed', 'identityReviewConfirmed', 'liveCodeObserved']) assert.equal(artistReviewReady(request, { ...evidence, [field]: false }, now), false);
  assert.equal(artistReviewReady(request, { ...evidence, observedCode: 'wrong' }, now), false);
  assert.equal(artistReviewReady(request, { ...evidence, observedAt: now + 1 }, now), false);
  assert.equal(artistReviewReady(request, evidence, now + 1000), false);
  assert.equal(artistReviewReady({}, { ...evidence, method: 'manual', reviewedUrl: 'https://artist.example/official' }, now), true);
  assert.equal(artistReviewReady({}, { ...evidence, method: 'manual', reviewedUrl: '' }, now), false);
});
test('verification forms are parseable, explicit and do not depend on legacy store from shared UI', () => {
  for (const path of ['../components/ArtistVerificationFields.jsx', '../components/ArtistIdentityStatus.jsx', '../components/moderation/ArtistIdentityReviewCard.jsx', '../screens/RequestArtistScreen.jsx', '../screens/AdminScreen.jsx']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotThrow(() => parse(source, { sourceType: 'module', plugins: ['jsx'] }));
    if (path.includes('/components/')) assert.doesNotMatch(source, /import.*from ["']\.\.\/.*store["']/);
  }
  const setup = readFileSync(new URL('../screens/RequestArtistScreen.jsx', import.meta.url), 'utf8');
  assert.match(setup, /operation\.current = controller/);
  assert.match(setup, /account\.value\.verificationChallenge\.expiresAt/);
  assert.match(setup, /createArtistVerificationChallenge/);
  const review = readFileSync(new URL('../components/moderation/ArtistIdentityReviewCard.jsx', import.meta.url), 'utf8');
  assert.match(review, /observedAt/);
  assert.match(review, /Release identity hold only/);
  assert.match(review, /officialAccountConfirmed && ownershipConfirmed && !!officialEvidenceUrl\(reviewedUrl\)/);
});
