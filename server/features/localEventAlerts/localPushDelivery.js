import { randomUUID } from "node:crypto";
import { withImmediateWrite } from "../../databaseTransaction.js";

const LEASE_MS = 60_000;
const RECEIPT_DELAY_MS = 15 * 60_000;
const RECEIPT_MAX_MS = 24 * 60 * 60_000;
const bounded = (limit) => Number.isInteger(limit) ? Math.max(1, Math.min(limit, 100)) : 20;

// Explicit capability and injected transport: importing/constructing this
// module cannot send a push. Never enable this on a test or staging database
// with real device registrations. send/receipt must enforce request timeouts.
export function createLocalPushDelivery({ db, alerts, transport, enabled = false, now = Date.now }) {
  let running = null, stopping = false;
  const installationFor = (row, at) => db.prepare(`SELECT i.* FROM local_push_installations i JOIN sessions s
    ON s.token_hash=i.session_hash AND s.user_id=i.account_id AND s.expires_at>?
    WHERE i.installation_id=? AND i.generation=? AND i.enabled=1 AND i.permission='granted'`).get(at, row.installation_id, row.generation);
  const authorized = (row, at) => {
    const device = installationFor(row, at);
    return device && alerts.readAlertTarget(device.account_id, row.alert_id, { forPush: true }) ? device : null;
  };
  const finish = (row, state, errorCode = null, ticketId = null, nextAt = now()) => db.prepare(`UPDATE local_push_outbox
    SET state=?,error_code=?,ticket_id=?,next_at=?,lease_key=NULL,lease_until=NULL
    WHERE id=? AND state='sending' AND lease_key=?`).run(state, errorCode, ticketId, nextAt, row.id, row.lease_key);

  async function perform(limit) {
    const at = now();
    // Crash after dispatch is uncertain, not a licence to send the same alert
    // again. Exactly-once remote delivery cannot be promised by Expo's API.
    db.prepare("UPDATE local_push_outbox SET state='unknown',error_code='INTERRUPTED',lease_key=NULL WHERE state='sending' AND lease_until<=?").run(at);
    const candidates = db.prepare("SELECT id FROM local_push_outbox WHERE state='ready' AND next_at<=? ORDER BY next_at,id LIMIT ?").all(at, bounded(limit));
    const counts = { accepted: 0, cancelled: 0, retrying: 0, failed: 0, unknown: 0 };
    for (const candidate of candidates) {
      if (stopping) break;
      const claimed = withImmediateWrite(db, () => {
        const row = db.prepare("SELECT * FROM local_push_outbox WHERE id=? AND state='ready' AND next_at<=?").get(candidate.id, now());
        if (!row) return null;
        const device = authorized(row, now());
        if (!device) { db.prepare("UPDATE local_push_outbox SET state='cancelled' WHERE id=?").run(row.id); counts.cancelled++; return null; }
        const lease = randomUUID();
        db.prepare("UPDATE local_push_outbox SET state='sending',lease_key=?,lease_until=?,attempts=attempts+1,sent_at=? WHERE id=?")
          .run(lease, now() + LEASE_MS, now(), row.id);
        return { ...row, lease_key: lease, attempts: row.attempts + 1, device };
      });
      if (!claimed) continue;
      let result;
      try {
        result = await transport.send({ to: claimed.device.token, title: "mshpit", body: "You have a new local show update.",
          data: { kind: "local_event_alert", alertId: claimed.alert_id, installationId: claimed.installation_id, generation: claimed.generation },
          channelId: "local-shows", ttl: 3600 });
      } catch (error) {
        // No token, account ID, exception text or provider payload in logs.
        void error;
        result = { status: "unknown" };
      }
      withImmediateWrite(db, () => {
        if (!authorized(claimed, now())) { finish(claimed, "cancelled"); counts.cancelled++; return; }
        if (result?.status === "accepted" && typeof result.ticketId === "string" && result.ticketId.length > 0 && result.ticketId.length <= 200) {
          finish(claimed, "accepted", null, result.ticketId, now() + RECEIPT_DELAY_MS); counts.accepted++;
        } else if (result?.status === "rejected" && result.code === "RateLimited" && claimed.attempts < 4) {
          finish(claimed, "ready", "RATE_LIMITED", null, now() + 60_000 * 2 ** claimed.attempts); counts.retrying++;
        } else if (result?.status === "rejected") {
          finish(claimed, "failed", result.code === "DeviceNotRegistered" ? "DEVICE_NOT_REGISTERED" : "PROVIDER_REJECTED"); counts.failed++;
          if (result.code === "DeviceNotRegistered") db.prepare("UPDATE local_push_installations SET enabled=0 WHERE installation_id=? AND generation=?")
            .run(claimed.installation_id, claimed.generation);
        } else { finish(claimed, "unknown", "DELIVERY_UNCERTAIN"); counts.unknown++; }
      });
    }
    return counts;
  }

  async function receipts(limit) {
    const rows = db.prepare("SELECT * FROM local_push_outbox WHERE state='accepted' AND next_at<=? ORDER BY next_at,id LIMIT ?").all(now(), bounded(limit));
    let checked = 0;
    for (const row of rows) {
      if (stopping) break;
      if (!authorized(row, now())) { db.prepare("UPDATE local_push_outbox SET state='cancelled' WHERE id=? AND state='accepted'").run(row.id); continue; }
      if (now() - row.sent_at >= RECEIPT_MAX_MS) { db.prepare("UPDATE local_push_outbox SET state='unknown',error_code='RECEIPT_EXPIRED' WHERE id=? AND state='accepted'").run(row.id); continue; }
      let result;
      try { result = await transport.receipt(row.ticket_id); }
      catch (error) { void error; result = { status: "pending" }; }
      withImmediateWrite(db, () => {
        if (!authorized(row, now())) { db.prepare("UPDATE local_push_outbox SET state='cancelled' WHERE id=? AND state='accepted'").run(row.id); return; }
        const state = result?.status === "delivered" ? "delivered" : result?.status === "rejected" ? "failed" : "accepted";
        db.prepare("UPDATE local_push_outbox SET state=?,next_at=?,error_code=? WHERE id=? AND state='accepted'")
          .run(state, now() + RECEIPT_DELAY_MS, state === "failed" ? "RECEIPT_REJECTED" : null, row.id);
        if (result?.code === "DeviceNotRegistered") db.prepare("UPDATE local_push_installations SET enabled=0 WHERE installation_id=? AND generation=?")
          .run(row.installation_id, row.generation);
      });
      checked++;
    }
    return { checked };
  }

  function run({ limit = 20 } = {}) {
    if (!enabled || stopping) return Promise.resolve({ disabled: true });
    if (running) return running;
    running = (async () => ({ send: await perform(limit), receipts: await receipts(limit) }))().finally(() => { running = null; });
    return running;
  }
  async function stop() { stopping = true; await running; }
  return { run, stop };
}
