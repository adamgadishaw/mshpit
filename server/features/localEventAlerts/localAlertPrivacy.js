import { withImmediateWrite } from "../../databaseTransaction.js";

export function exportLocalAlerts(db, accountId) {
  return {
    preferences: db.prepare("SELECT dates_inbox,sales_inbox,dates_push,sales_push FROM local_alert_preferences WHERE account_id=?").get(accountId) || null,
    alerts: db.prepare(`SELECT id,event_id,kind,due_at,created_at,state,notification_id FROM local_event_alerts WHERE account_id=? ORDER BY created_at,id`).all(accountId),
    // Token, session hash, installation secret and raw home location are never
    // included in portable account exports or exposed through a GET route.
    devices: db.prepare("SELECT platform,enabled,permission,updated_at FROM local_push_installations WHERE account_id=? ORDER BY updated_at").all(accountId),
    pushDeliveries: db.prepare(`SELECT p.alert_id,i.platform,p.state,p.attempts,p.next_at,p.sent_at,p.error_code
      FROM local_push_outbox p JOIN local_event_alerts a ON a.id=p.alert_id
      JOIN local_push_installations i ON i.installation_id=p.installation_id
      WHERE a.account_id=? AND i.account_id=a.account_id AND i.generation=p.generation
      ORDER BY a.created_at,p.id`).all(accountId),
  };
}

export function eraseLocalAlerts(db, accountId) {
  return withImmediateWrite(db, () => {
    db.prepare("DELETE FROM local_push_installations WHERE account_id=?").run(accountId);
    db.prepare("DELETE FROM local_event_alerts WHERE account_id=?").run(accountId);
    db.prepare("DELETE FROM local_alert_preferences WHERE account_id=?").run(accountId);
    db.prepare("DELETE FROM local_alert_account_scans WHERE account_id=?").run(accountId);
  });
}

// Run only from the existing bounded maintenance scheduler. Keep the compact
// per-event/account deduplication receipt while its calendar record exists;
// dropping those rows on a timer could announce the same show a second time.
export function pruneLocalPushOutbox(db, { at = Date.now(), limit = 500 } = {}) {
  const count = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 1000)) : 500;
  return db.prepare(`DELETE FROM local_push_outbox WHERE id IN (
    SELECT id FROM local_push_outbox WHERE state IN ('delivered','failed','unknown','cancelled') AND next_at<? ORDER BY next_at,id LIMIT ?
  )`).run(at - 30 * 86400000, count).changes;
}
