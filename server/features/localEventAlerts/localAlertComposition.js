import { createHash } from "node:crypto";
import { createPublicDocumentRepository } from "../seo/publicDocumentRepository.js";
import { createLocalAlertAudience } from "./localAlertAudience.js";
import { creatorCalendarNoticeFor } from "./localAlertAudience.js";
import { createLocalAlertService } from "./localAlertService.js";
import { createLocalPushDevices } from "./localPushDevices.js";
import { localAlertRoutes } from "./localAlertRoutes.js";
import { createLocalAlertRuntime } from "./localAlertRuntime.js";
import { startLocalAlertDelivery } from "./localPushRuntime.js";

export function createLocalAlertComposition({ db, requireUser, resolveArtistIdentity, now = Date.now }) {
  const repository = createPublicDocumentRepository(db);
  const alerts = createLocalAlertService({ db, now,
    readPublicEvent: (id, at) => repository.readEvent({ id, at, eventOnly: true })?.event || null,
    canNotifyArtist: createLocalAlertAudience({ db, resolveArtistIdentity }),
    findRelatedNotice: (accountId, event) => creatorCalendarNoticeFor(db, accountId, event),
  });
  // SQLite invokes the same synchronous read policy before pagination, count
  // and acknowledgement. It performs no writes and cannot accept client SQL.
  db.function("pit_local_alert_visible", (accountId, alertId) => Number(!!alerts.readAlertTarget(accountId, alertId)));
  const devices = createLocalPushDevices({ db, now });
  const runtime = createLocalAlertRuntime({ db, alerts, now });
  return { alerts, runtime,
    routes: localAlertRoutes({ requireUser, alerts, devices,
      sessionHashForRequest: ctx => typeof ctx.token === "string" ? createHash("sha256").update(ctx.token).digest("hex") : null }),
    start: options => startLocalAlertDelivery({ runtime, db, alerts, now, ...options }),
  };
}

export const LOCAL_ALERT_NOTICE_VISIBLE_SQL = `(n.type NOT IN ('artist_tour_date','local_ticket_sale') OR EXISTS (
  SELECT 1 FROM local_event_alerts alert WHERE alert.notification_id=n.id AND alert.owns_notice=1
    AND alert.account_id=n.user_id AND alert.state='delivered' AND pit_local_alert_visible(n.user_id,alert.id)=1))`;
