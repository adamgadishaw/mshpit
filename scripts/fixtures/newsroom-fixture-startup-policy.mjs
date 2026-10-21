// Scratch fixture policy only. Explicit opt-outs preserve the real production
// cookie/request behavior without pretending that this loopback host is Render.
import assert from 'node:assert/strict';

export const DISABLED_STARTUP_FLAGS = Object.freeze([
  'TOURDATE_REFRESH_ENABLED',
  'TOURDATE_DEMAND_REFRESH_ENABLED',
  'ARTIST_GENRE_REFRESH_ENABLED',
  'ARTIST_PHOTO_SEED_ENABLED',
  'ARTIST_PHOTO_PURGE_REQUESTED',
  'ARTIST_DEATH_WATCH_SCHEDULER_ENABLED',
  'CACHE_WARM_ENABLED',
  'ARTIST_KNOWLEDGE_ENABLED',
  'VENUE_PHOTO_ENRICHMENT_ENABLED',
  'BACKUP_ENABLED',
  'MEDIA_CLEANUP_ENABLED',
  'MEDIA_LEGACY_RECOVERY_ENABLED',
  'EMAIL_CAMPAIGN_RECOVERY_ENABLED',
  'CATALOG_RESEARCH_ENABLED',
  'PROVIDER_PROFILES_ENABLED',
  'ARTIST_NEWS_ENABLED',
  'NEWS_DESK_ENABLED',
  'FESTIVAL_SCAN_ENABLED',
  'ARTIST_PHOTO_DEEZER_ENABLED',
  'SEARCH_GROWTH_ENABLED',
  'SITE_HEALTH_DIGEST_ENABLED',
  'ERROR_ALERTS_ENABLED',
]);
export const FIXTURE_STARTUP_ENV = Object.freeze(Object.fromEntries(DISABLED_STARTUP_FLAGS.map(key => [key, 'false'])));

// The child is built from a small OS allowlist and explicit synthetic config.
// Refuse extra keys rather than maintaining a partial blacklist of provider,
// email, private backup, Search Console, or video-verifier credentials.
export const ORDINARY_WINDOWS_ENV_KEYS = Object.freeze([
  'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA',
  'USERPROFILE', 'USERNAME', 'USERDOMAIN', 'HOMEDRIVE', 'HOMEPATH', 'SYSTEMDRIVE', 'LOGONSERVER',
  'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432',
  'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)', 'COMMONPROGRAMW6432',
  'COMSPEC', 'PATHEXT', 'OS', 'COMPUTERNAME', 'SESSIONNAME',
]);
const ALLOWED_KEYS = new Set([
  ...ORDINARY_WINDOWS_ENV_KEYS,
  'NODE_CHANNEL_FD', 'NODE_CHANNEL_SERIALIZATION_MODE',
  'NODE_ENV', 'PIT_ENV', 'PUBLIC_ORIGIN', 'PORT', 'PIT_DATA_DIR',
  'PIT_SUPPORTED_TEMP_BASE', 'PIT_ALLOW_EMPTY_DB_BOOTSTRAP',
  'PIT_SUPPORTED_HTTPS_FIXTURE', 'PIT_SUPPORTED_DEADLINE', 'PIT_SUPPORTED_PASSWORD',
  'NEWSROOM_BROWSER_SESSIONS_ENABLED', 'ADMIN_EMAIL', 'ADMIN_PASSWORD',
  'NEWS_DESK_ACCOUNT_ID', 'PIT_MEDIA_API_ENABLED',
  'MEDIA_ENDPOINT', 'MEDIA_PUBLIC_BASE_URL', 'MEDIA_BUCKET', 'MEDIA_SOURCE_BUCKET',
  'MEDIA_REGION', 'MEDIA_ACCESS_KEY_ID', 'MEDIA_SECRET_ACCESS_KEY',
  ...DISABLED_STARTUP_FLAGS,
]);

export function assertFixtureStartupPolicy(env) {
  assert.equal(env.NODE_ENV, 'production');
  assert.equal(env.PIT_ENV, 'staging');
  assert.equal(env.PIT_SUPPORTED_HTTPS_FIXTURE, '1');
  assert.equal(env.RENDER, undefined, 'Fixture must preserve non-Render client-IP trust behavior');
  for (const key of DISABLED_STARTUP_FLAGS) assert.equal(env[key], 'false', 'Optional fixture startup job must be explicitly disabled: ' + key);
  for (const key of Object.keys(env)) assert.ok(ALLOWED_KEYS.has(key.toUpperCase()), 'Unexpected fixture environment key: ' + key);
  return true;
}

export function fixtureStartupEnvironment(env) {
  const result = { ...env, ...FIXTURE_STARTUP_ENV };
  assertFixtureStartupPolicy(result);
  return result;
}

// This environment policy does not replace timers. The separate pinned timer
// adapter suppresses only the three unrelated ungated scheduler registrations.
export const RETAINED_STARTUP_WORK = Object.freeze([
  { name: 'memory monitor', source: 'server/index.js:1048; server/memoryAdmission.js:244,269', scope: 'immediate/60s local process sampling' },
  { name: 'retention maintenance', source: 'server/index.js:808,1071', scope: 'startup and hourly bounded local SQL retention' },
  { name: 'storage/session maintenance', source: 'server/index.js:1064; server/storageMaintenanceScheduler.js:6', scope: 'immediate/60s synchronous local provider cache, expiry and storage observations' },
  { name: 'privacy replay', source: 'server/index.js:1058', scope: 'fresh DB has no restore gate; journal key/private backup config absent' },
  { name: 'account lifecycle', source: 'server/index.js:1102; server/features/accountLifecycle/accountLifecycleScheduler.js:23', scope: '10s/hourly local sweep of fresh synthetic users; mail credentials absent' },
  { name: 'sitemap', source: 'server/index.js:1049,1016,1041,1129,1132; server/seo.js:890', scope: 'local read-only SQLite builder child, disposable-directory snapshot,15min/retry timers' },
  { name: 'private media privacy monitor', source: 'server/index.js:1136; server/mediaIsolationMonitor.js:1', scope: 'real probe policy with existing private RAM storage adapter;5min/recovery timers remain' },
  { name: 'rate-limit pruning', source: 'server/auth.js:353', scope: '60s in-memory rate-limit bucket pruning' },
]);
export const SUPPRESSED_STARTUP_WORK = Object.freeze([
  { name: 'privacy journal shipper', source: 'server/index.js:1063; server/privacyJournal.js:357', scope: 'only pinned startPrivacyJournalShipper periodic registrations60s/5min suppressed by newsroom-fixture-timer-isolation.mjs' },
  { name: 'search growth scheduler', source: 'server/index.js:1088; server/features/searchGrowth/searchGrowthService.js:255', scope: 'only pinned startSearchGrowthScheduler periodic registrations180s/hourly suppressed; request timeout remains native' },
  { name: 'venue photo scheduler', source: 'server/index.js:1097; server/venuePhotoEnrichment.js:200,220', scope: 'VENUE_PHOTO_ENRICHMENT_ENABLED=false disables worker pass only; pinned startVenuePhotoScheduler periodic registrations180s/900s additionally suppressed' },
]);
