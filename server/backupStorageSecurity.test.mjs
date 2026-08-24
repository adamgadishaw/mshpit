import test from "node:test";
import assert from "node:assert/strict";
import {
  privateBackupStorageConfig,
  verifyPrivateBackupBucket,
} from "./backupStorageSecurity.js";

const ENV = {
  BACKUP_S3_ENDPOINT: "https://account.example.test/storage",
  BACKUP_S3_BUCKET: "pit-private-backups",
  BACKUP_S3_ACCESS_KEY_ID: "id",
  BACKUP_S3_SECRET_ACCESS_KEY: "secret",
  MEDIA_BUCKET: "pit-public-media",
  MEDIA_SOURCE_BUCKET: "pit-private-sources",
  MEDIA_ACCESS_KEY_ID: "media-id",
};

test("backup storage requires HTTPS, safe names, separate buckets, and no endpoint credentials", () => {
  assert.ok(privateBackupStorageConfig(ENV));
  assert.equal(privateBackupStorageConfig({ ...ENV, BACKUP_S3_ENDPOINT: "http://account.example.test" }), null);
  assert.equal(privateBackupStorageConfig({ ...ENV, BACKUP_S3_ENDPOINT: "https://user:pass@account.example.test" }), null);
  assert.equal(privateBackupStorageConfig({ ...ENV, BACKUP_S3_ENDPOINT: "https://account.example.test?token=secret" }), null);
  assert.equal(privateBackupStorageConfig({ ...ENV, BACKUP_S3_BUCKET: ENV.MEDIA_BUCKET }), null);
  assert.equal(privateBackupStorageConfig({ ...ENV, BACKUP_S3_BUCKET: ENV.MEDIA_SOURCE_BUCKET }), null);
  assert.equal(privateBackupStorageConfig({ ...ENV, BACKUP_S3_ACCESS_KEY_ID: ENV.MEDIA_ACCESS_KEY_ID }), null);
  assert.equal(privateBackupStorageConfig({ ...ENV, BACKUP_S3_BUCKET: "../escape" }), null);
});

test("backup privacy probe accepts only explicit anonymous authorization failures", async () => {
  const denied = async () => ({ status: 403, body: { cancel: async () => {} } });
  assert.deepEqual(await verifyPrivateBackupBucket({ env: ENV, fetchImpl: denied }), { private: true });

  let call = 0;
  const publiclyListable = async () => ({ status: ++call === 1 ? 200 : 403, body: { cancel: async () => {} } });
  await assert.rejects(
    verifyPrivateBackupBucket({ env: ENV, fetchImpl: publiclyListable }),
    /privacy probe failed closed/,
  );

  const publicMissingObject = async () => ({ status: 404, body: { cancel: async () => {} } });
  await assert.rejects(
    verifyPrivateBackupBucket({ env: ENV, fetchImpl: publicMissingObject }),
    /privacy probe failed closed/,
  );
});
