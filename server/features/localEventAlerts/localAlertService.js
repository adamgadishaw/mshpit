import { createHash, randomUUID } from "node:crypto";
import { withImmediateWrite } from "../../databaseTransaction.js";
import { accountIsPublic } from "../../accountVisibility.js";
import { ApiError } from "../../errors.js";
import { alertEventIsCurrent, resolveAlertHomeCity, resolveAlertEventCity, ticketmasterPublicSale,
  DEFAULT_LOCAL_ALERT_PREFERENCES, SALE_FRESHNESS_MS, SALE_DELIVERY_WINDOW_MS, DATE_DELIVERY_WINDOW_MS } from "./localAlertPolicy.js";

const fingerprint = (event, sale) => createHash("sha256").update(JSON.stringify([
  event.id, event.artist_key, event.artist, event.date, event.event_end_date, event.venue,
  event.venue_city, event.venue_region, event.venue_country_code, event.place,
  event.owner_id, event.creator_revision, event.event_status, event.ticket_url,
  sale?.provider_event_id, sale?.starts_at, sale?.ends_at,
])).digest("hex");
const bound = (value, fallback, maximum) => Number.isInteger(value) ? Math.max(1, Math.min(value, maximum)) : fallback;

// Dependencies deliberately reuse the canonical public event and artist follow
// policies. They must be synchronous, freshly evaluated reads, not snapshots.
// readPublicEvent(id, at): repository.readEvent({id,at})?.event || null
// canNotifyArtist(accountId,event,at): canonical favourite/fan-club identity,
// per-artist preference, author visibility, blocks and mutes (fail closed).
// findRelatedNotice: exact creator-publication/event association, never a
// heuristic match on artist name or a nearby timestamp.
export function createLocalAlertService({ db, readPublicEvent, canNotifyArtist, findRelatedNotice = () => null, now = Date.now }) {
  if (typeof readPublicEvent !== "function" || typeof canNotifyArtist !== "function") throw new TypeError("Canonical alert policies are required");
  const preferences = (accountId) => {
    const row = db.prepare("SELECT * FROM local_alert_preferences WHERE account_id=?").get(accountId);
    return row ? { datesInbox: !!row.dates_inbox, salesInbox: !!row.sales_inbox, datesPush: !!row.dates_push, salesPush: !!row.sales_push }
      : { ...DEFAULT_LOCAL_ALERT_PREFERENCES };
  };
  const currentEvent = (eventId, at) => {
    const event = readPublicEvent(eventId, at);
    if (!alertEventIsCurrent(event, at) || !event.artist_key) return null;
    const city = resolveAlertEventCity(event);
    const sale = db.prepare("SELECT * FROM local_event_sales WHERE event_id=?").get(eventId);
    const validSale = event.source === "ticketmaster" && !event.owner_id && sale?.provider_event_id === event.provider_event_id ? sale : null;
    return { event, city, sale: validSale, fingerprint: fingerprint(event, validSale) };
  };
  const eligible = (accountId, current, at, kind = "sale") => {
    const account = db.prepare("SELECT * FROM users WHERE id=?").get(accountId);
    if (!accountIsPublic(account, at) || !current) return false;
    if (canNotifyArtist(accountId, current.event, at) !== true) return false;
    // Tour announcements remain artist-wide. Home city narrows ticket-sale
    // alerts only; a missing city must never mute an artist's tour announcement.
    if (kind === "date") return true;
    const home = resolveAlertHomeCity(account.home_city);
    return !!home && !!current.city && home.path === current.city.path;
  };
  const cancelAlert = (row) => {
    if (row.owns_notice && row.notification_id) db.prepare("DELETE FROM notifications WHERE id=? AND user_id=?").run(row.notification_id, row.account_id);
    db.prepare("UPDATE local_event_alerts SET state='cancelled',notification_id=NULL,owns_notice=0 WHERE id=?").run(row.id);
    db.prepare("UPDATE local_push_outbox SET state='cancelled',lease_key=NULL WHERE alert_id=? AND state IN ('ready','sending','accepted')").run(row.id);
  };
  const stillValid = (alert, current, at) => !!current && current.fingerprint === alert.fingerprint
    && (current.city?.path || "") === alert.city_path && eligible(alert.account_id, current, at, alert.kind)
    && (alert.kind !== "sale" || (current.sale?.starts_at === Number(alert.trigger_key)
      && current.sale.starts_at <= at && (current.sale.ends_at == null || current.sale.ends_at > at)));
  const freshSale = (current, at) => current?.sale && current.sale.observed_at <= at && at - current.sale.observed_at <= SALE_FRESHNESS_MS;

  function reconcileEvent(eventId, { baseline = false } = {}) {
    return withImmediateWrite(db, () => {
      const at = now(), current = currentEvent(eventId, at);
      const previous = db.prepare("SELECT * FROM local_event_observations WHERE event_id=?").get(eventId);
      for (const alert of db.prepare("SELECT * FROM local_event_alerts WHERE event_id=? AND state<>'cancelled'").all(eventId)) {
        if (!current || alert.fingerprint !== current.fingerprint) cancelAlert(alert);
      }
      if (!current) {
        if (previous) db.prepare("UPDATE local_event_observations SET scan_complete=1 WHERE event_id=?").run(eventId);
        return { visible: false };
      }
      if (!previous) db.prepare(`INSERT INTO local_event_observations(event_id,fingerprint,first_seen_at,announce_until)
        VALUES (?,?,?,?)`).run(eventId, current.fingerprint, at, baseline ? 0 : at + DATE_DELIVERY_WINDOW_MS);
      else if (previous.fingerprint !== current.fingerprint) db.prepare(`UPDATE local_event_observations
        SET fingerprint=?,announce_until=0,scan_cursor='',scan_complete=0 WHERE event_id=?`).run(current.fingerprint, eventId);
      return { visible: true, changed: !previous || previous.fingerprint !== current.fingerprint };
    });
  }

  // Trusted Ticketmaster importer only: no route accepts sale evidence from a
  // client. Call inside the importer transaction after its canonical row write.
  function recordTicketmasterSale(eventId, providerEvent, observedAt = now()) {
    if (!Number.isSafeInteger(observedAt) || observedAt > now()) throw new TypeError("Invalid sale observation time");
    return withImmediateWrite(db, () => {
      const row = db.prepare("SELECT * FROM tour_dates WHERE id=?").get(eventId);
      if (!row || row.owner_id || row.source !== "ticketmaster" || row.provider_event_id !== String(providerEvent?.id || "")) {
        throw new ApiError(409, "The ticket source no longer matches this show.", "CONFLICT");
      }
      const sale = ticketmasterPublicSale(providerEvent);
      const old = db.prepare("SELECT observed_at FROM local_event_sales WHERE event_id=?").get(eventId);
      if (old && old.observed_at >= observedAt) return { updated: false };
      db.prepare(`INSERT INTO local_event_sales(event_id,provider_event_id,starts_at,ends_at,observed_at) VALUES (?,?,?,?,?)
        ON CONFLICT(event_id) DO UPDATE SET provider_event_id=excluded.provider_event_id,starts_at=excluded.starts_at,
          ends_at=excluded.ends_at,observed_at=excluded.observed_at`).run(eventId, row.provider_event_id, sale?.startsAt ?? null, sale?.endsAt ?? null, observedAt);
      if (db.prepare("SELECT 1 FROM local_event_observations WHERE event_id=?").get(eventId)) reconcileEvent(eventId);
      return { updated: true, known: !!sale };
    });
  }

  function planEventPage(eventId, { limit = 100 } = {}) {
    return withImmediateWrite(db, () => {
      const at = now(), current = currentEvent(eventId, at);
      const observation = db.prepare("SELECT * FROM local_event_observations WHERE event_id=?").get(eventId);
      if (!current || !observation || observation.scan_complete || current.fingerprint !== observation.fingerprint) return { planned: 0, more: false };
      const rows = db.prepare("SELECT id FROM users WHERE id>? ORDER BY id LIMIT ?").all(observation.scan_cursor, bound(limit, 100, 500));
      const insert = db.prepare(`INSERT OR IGNORE INTO local_event_alerts
        (id,account_id,event_id,kind,trigger_key,fingerprint,city_path,due_at,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
      let planned = 0;
      for (const { id: accountId } of rows) {
        if (!eligible(accountId, current, at, "date")) continue;
        const pref = preferences(accountId);
        if (observation.announce_until > at && (pref.datesInbox || pref.datesPush)) {
          planned += Number(insert.run(randomUUID(), accountId, eventId, "date", "first", current.fingerprint, current.city?.path || "",
            at, observation.announce_until, at).changes);
        }
        const sale = current.sale;
        if ((pref.salesInbox || pref.salesPush) && eligible(accountId, current, at) && freshSale(current, at) && sale.starts_at != null
          && sale.starts_at + SALE_DELIVERY_WINDOW_MS > at && (sale.ends_at == null || sale.ends_at > at)) {
          planned += Number(insert.run(randomUUID(), accountId, eventId, "sale", String(sale.starts_at), current.fingerprint, current.city.path,
            sale.starts_at, Math.min(sale.starts_at + SALE_DELIVERY_WINDOW_MS, sale.ends_at ?? Infinity), at).changes);
        }
      }
      const more = rows.length === bound(limit, 100, 500);
      db.prepare("UPDATE local_event_observations SET scan_cursor=?,scan_complete=? WHERE event_id=? AND fingerprint=?")
        .run(rows.at(-1)?.id || observation.scan_cursor, Number(!more), eventId, current.fingerprint);
      return { planned, more };
    });
  }

  function deliverDue({ limit = 100 } = {}) {
    return withImmediateWrite(db, () => {
      const at = now();
      const rows = db.prepare("SELECT * FROM local_event_alerts WHERE state='queued' AND due_at<=? ORDER BY due_at,id LIMIT ?")
        .all(at, bound(limit, 100, 500));
      let delivered = 0, cancelled = 0, awaitingEvidence = 0;
      for (const alert of rows) {
        const current = currentEvent(alert.event_id, at), pref = preferences(alert.account_id);
        const inbox = alert.kind === "date" ? pref.datesInbox : pref.salesInbox;
        const push = alert.kind === "date" ? pref.datesPush : pref.salesPush;
        if (alert.expires_at <= at || !stillValid(alert, current, at) || (!inbox && !push)) { cancelAlert(alert); cancelled++; continue; }
        if (alert.kind === "sale" && !freshSale(current, at)) { awaitingEvidence++; continue; }
        let notificationId = null, ownsNotice = false;
        if (inbox) {
          const related = alert.kind === "date" ? findRelatedNotice(alert.account_id, current.event, at) : null;
          const existing = related && db.prepare("SELECT id FROM notifications WHERE id=? AND user_id=? AND type IN ('creator_update','artist_update')").get(related, alert.account_id);
          notificationId = existing?.id || `local_${alert.id}`;
          if (!existing) {
            db.prepare(`INSERT INTO notifications(id,user_id,actor_id,type,artist,text,created_at) VALUES (?,?,NULL,?,?,?,?)`)
              .run(notificationId, alert.account_id, alert.kind === "date" ? "artist_tour_date" : "local_ticket_sale", current.event.artist,
                alert.kind === "date" ? "New show date listed." : `Tickets are on sale in ${current.city.city}.`, at);
            ownsNotice = true;
          }
        }
        db.prepare("UPDATE local_event_alerts SET state='delivered',notification_id=?,owns_notice=? WHERE id=?")
          .run(notificationId, Number(ownsNotice), alert.id);
        if (push) db.prepare(`INSERT OR IGNORE INTO local_push_outbox(id,alert_id,installation_id,generation,next_at)
          SELECT lower(hex(randomblob(16))),?,i.installation_id,i.generation,? FROM local_push_installations i
          JOIN sessions s ON s.token_hash=i.session_hash AND s.user_id=i.account_id AND s.expires_at>?
          WHERE i.account_id=? AND i.enabled=1 AND i.permission='granted'`).run(alert.id, at, at, alert.account_id);
        delivered++;
      }
      return { delivered, cancelled, awaitingEvidence };
    });
  }

  function setPreferences(accountId, input, assertCurrentSession) {
    if (!input || Object.keys(input).length !== 4 || Object.keys(DEFAULT_LOCAL_ALERT_PREFERENCES).some(key => typeof input[key] !== "boolean")) {
      throw new ApiError(400, "Choose each notification setting.", "VALIDATION_FAILED");
    }
    return withImmediateWrite(db, () => {
      if (assertCurrentSession().id !== accountId) throw new ApiError(401, "Log in again.", "AUTH_REQUIRED");
      db.prepare(`INSERT INTO local_alert_preferences(account_id,dates_inbox,sales_inbox,dates_push,sales_push) VALUES (?,?,?,?,?)
        ON CONFLICT(account_id) DO UPDATE SET dates_inbox=excluded.dates_inbox,sales_inbox=excluded.sales_inbox,
          dates_push=excluded.dates_push,sales_push=excluded.sales_push`).run(accountId, +input.datesInbox, +input.salesInbox, +input.datesPush, +input.salesPush);
      db.prepare(`UPDATE local_push_outbox SET state='cancelled',lease_key=NULL WHERE state IN ('ready','sending','accepted')
        AND alert_id IN (SELECT id FROM local_event_alerts WHERE account_id=? AND ((kind='date' AND ?=0) OR (kind='sale' AND ?=0)))`)
        .run(accountId, +input.datesPush, +input.salesPush);
      requestAccountScan(accountId);
      return preferences(accountId);
    });
  }

  // Call in the same transaction as a home-city/favourite/fan-club/preference
  // change. New followers can receive upcoming sales without replaying old
  // date announcements. The cursor survives restart and is bounded per tick.
  function requestAccountScan(accountId) {
    db.prepare(`INSERT INTO local_alert_account_scans(account_id,requested_at) VALUES (?,?)
      ON CONFLICT(account_id) DO UPDATE SET event_cursor='',requested_at=excluded.requested_at`).run(accountId, now());
  }
  function planAccountSalesPage(accountId, { limit = 100 } = {}) {
    return withImmediateWrite(db, () => {
      const scan = db.prepare("SELECT * FROM local_alert_account_scans WHERE account_id=?").get(accountId);
      if (!scan) return { planned: 0, more: false };
      const at = now(), size = bound(limit, 100, 500), pref = preferences(accountId);
      const rows = db.prepare("SELECT event_id FROM local_event_sales WHERE event_id>? AND starts_at>? ORDER BY event_id LIMIT ?")
        .all(scan.event_cursor, at - SALE_DELIVERY_WINDOW_MS, size);
      let planned = 0;
      for (const { event_id: eventId } of rows) {
        const current = currentEvent(eventId, at), sale = current?.sale;
        if (!(pref.salesInbox || pref.salesPush) || !eligible(accountId, current, at) || !freshSale(current, at)
          || sale?.starts_at == null || (sale.ends_at != null && sale.ends_at <= at)) continue;
        planned += Number(db.prepare(`INSERT OR IGNORE INTO local_event_alerts
          (id,account_id,event_id,kind,trigger_key,fingerprint,city_path,due_at,expires_at,created_at) VALUES (?,?,?,'sale',?,?,?,?,?,?)`)
          .run(randomUUID(), accountId, eventId, String(sale.starts_at), current.fingerprint, current.city.path,
            sale.starts_at, Math.min(sale.starts_at + SALE_DELIVERY_WINDOW_MS, sale.ends_at ?? Infinity), at).changes);
      }
      const more = rows.length === size;
      if (more) db.prepare("UPDATE local_alert_account_scans SET event_cursor=? WHERE account_id=?").run(rows.at(-1).event_id, accountId);
      else db.prepare("DELETE FROM local_alert_account_scans WHERE account_id=?").run(accountId);
      return { planned, more };
    });
  }

  // Used immediately before send and on tap/read, not only during fan-out.
  function readAlertTarget(accountId, alertId, { forPush = false } = {}) {
    const at = now(), alert = db.prepare("SELECT * FROM local_event_alerts WHERE id=? AND account_id=? AND state='delivered'").get(alertId, accountId);
    if (!alert) return null;
    const current = currentEvent(alert.event_id, at);
    if (!stillValid(alert, current, at)) return null;
    if (forPush) {
      const pref = preferences(accountId);
      if (!(alert.kind === "date" ? pref.datesPush : pref.salesPush) || alert.expires_at <= at || (alert.kind === "sale" && !freshSale(current, at))) return null;
    }
    return { alertId: alert.id, eventId: alert.event_id, artist: current.event.artist, kind: alert.kind, path: `/event/${encodeURIComponent(alert.event_id)}` };
  }

  return { preferences, setPreferences, reconcileEvent, recordTicketmasterSale, planEventPage, requestAccountScan, planAccountSalesPage, deliverDue, readAlertTarget };
}
