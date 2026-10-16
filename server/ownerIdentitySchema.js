// Upgrade existing databases as well as fresh schemas. A savepoint makes the
// replacement atomic, including when called inside the startup migration lock.
export function ensureOwnerIdentitySchema(database) {
  database.exec("SAVEPOINT owner_identity_schema");
  try {
    database.exec(`
      DROP TRIGGER IF EXISTS owner_identity_no_update;
      CREATE TRIGGER owner_identity_no_update
      BEFORE UPDATE ON app_meta
      WHEN OLD.key='security.bootstrap_admin_identity.v1'
        AND json_extract(OLD.value,'$.version')=2
        AND (NEW.key IS NOT OLD.key OR NEW.value IS NOT OLD.value)
      BEGIN
        SELECT RAISE(ABORT, 'the Owner identity is locked');
      END;

      DROP TRIGGER IF EXISTS owner_account_security_boundary;
      CREATE TRIGGER owner_account_security_boundary
      BEFORE UPDATE ON users
      WHEN OLD.id=(SELECT json_extract(value,'$.userId') FROM app_meta
        WHERE key='security.bootstrap_admin_identity.v1' AND json_extract(value,'$.version')=2)
        AND (
          NEW.id IS NOT OLD.id
          OR lower(NEW.email)<>(SELECT lower(json_extract(value,'$.email')) FROM app_meta
            WHERE key='security.bootstrap_admin_identity.v1')
          OR NEW.role<>'admin'
          OR COALESCE(NEW.is_banned,0)<>0
          OR NEW.suspended_until IS NOT NULL
          OR COALESCE(NEW.email_verified_at,0)<=0
        )
      BEGIN
        SELECT RAISE(ABORT, 'the Owner account security boundary is locked');
      END;
    `);
    database.exec("RELEASE owner_identity_schema");
  } catch (error) {
    try { database.exec("ROLLBACK TO owner_identity_schema; RELEASE owner_identity_schema"); }
    catch (rollbackError) { throw new AggregateError([error, rollbackError], "Owner guard migration and rollback failed"); }
    throw error;
  }
}
