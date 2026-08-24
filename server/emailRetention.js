const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_EMAIL_OPERATIONAL_RETENTION_DAYS = 90;
export const MIN_EMAIL_OPERATIONAL_RETENTION_DAYS = 30;
export const MAX_EMAIL_OPERATIONAL_RETENTION_DAYS = 365;

export function emailOperationalRetentionDays(env = process.env) {
  const configured = Number(env?.EMAIL_OPERATIONAL_RETENTION_DAYS);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_EMAIL_OPERATIONAL_RETENTION_DAYS;
  }
  return Math.min(
    MAX_EMAIL_OPERATIONAL_RETENTION_DAYS,
    Math.max(MIN_EMAIL_OPERATIONAL_RETENTION_DAYS, Math.floor(configured)),
  );
}

/**
 * Purge recipient addresses and delivery metadata after their operational
 * support window. Active/draft/paused campaign queues are deliberately kept so
 * maintenance can never make an unfinished campaign silently skip recipients.
 */
export function pruneEmailOperationalData(database, {
  env = process.env,
  at = Date.now(),
} = {}) {
  const days = emailOperationalRetentionDays(env);
  const cutoff = at - days * DAY_MS;
  const deleteLog = database.prepare("DELETE FROM email_log WHERE created_at < ?").run(cutoff);
  const deleteTerminalQueue = database.prepare(`
    DELETE FROM email_queue
    WHERE campaign_id IN (
      SELECT id FROM email_campaigns
      WHERE status IN ('sent','failed')
        AND COALESCE(finished_at,updated_at,created_at) < ?
    )
  `).run(cutoff);
  return {
    days,
    cutoff,
    emailLogRows: Number(deleteLog?.changes) || 0,
    terminalQueueRows: Number(deleteTerminalQueue?.changes) || 0,
  };
}
