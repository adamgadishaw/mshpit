// Dedicated local test data only; the preload removes credentials and blocks outbound traffic.
process.env.MSHPIT_LOCAL_PERSISTENT_TEST_DATA = '1';
await import('./mobile-smoke-preload.mjs');
await import('../server/index.js');
