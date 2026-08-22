import { drainCampaign, resumableCampaigns } from "./emailQueue.js";
import { runBackgroundJob } from "./backgroundJobCoordinator.js";

export const EMAIL_CAMPAIGN_RECOVERY_INTERVAL_MS = 60 * 1000;
export const EMAIL_CAMPAIGN_RECOVERY_BATCH_SIZE = 25;
export const EMAIL_CAMPAIGN_RECOVERY_CAMPAIGNS_PER_TICK = 4;

const MIN_INTERVAL_MS = 5 * 1000;
const MAX_INTERVAL_MS = 15 * 60 * 1000;
const MAX_BATCH_SIZE = 50;
const MAX_CAMPAIGNS_PER_TICK = 10;

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) return fallback;
  return Math.min(Math.floor(parsed), maximum);
}

function safeErrorLabel(error) {
  const name = String(error?.name || "Error").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40) || "Error";
  const code = String(error?.code || "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40);
  return `${name}${code ? `/${code}` : ""}`;
}

/**
 * Owns bounded, periodic continuation of campaigns that are already sending.
 * Paused campaigns are deliberately absent from resumableCampaigns(), so an
 * operator pause or provider-error pause remains authoritative.
 */
export function createEmailCampaignScheduler({
  listCampaigns = resumableCampaigns,
  drain = drainCampaign,
  intervalMs = EMAIL_CAMPAIGN_RECOVERY_INTERVAL_MS,
  batchSize = EMAIL_CAMPAIGN_RECOVERY_BATCH_SIZE,
  campaignsPerTick = EMAIL_CAMPAIGN_RECOVERY_CAMPAIGNS_PER_TICK,
  runJob = runBackgroundJob,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  logger = console,
} = {}) {
  const safeIntervalMs = boundedInteger(
    intervalMs,
    EMAIL_CAMPAIGN_RECOVERY_INTERVAL_MS,
    MIN_INTERVAL_MS,
    MAX_INTERVAL_MS,
  );
  const safeBatchSize = boundedInteger(
    batchSize,
    EMAIL_CAMPAIGN_RECOVERY_BATCH_SIZE,
    1,
    MAX_BATCH_SIZE,
  );
  const safeCampaignsPerTick = boundedInteger(
    campaignsPerTick,
    EMAIL_CAMPAIGN_RECOVERY_CAMPAIGNS_PER_TICK,
    1,
    MAX_CAMPAIGNS_PER_TICK,
  );

  let started = false;
  let timer = null;
  let activeTick = null;

  const report = (stage, error, campaignId = "") => {
    try {
      const scope = campaignId ? ` for campaign ${campaignId}` : "";
      logger?.error?.(`[mail] campaign recovery ${stage} failed safely${scope}: ${safeErrorLabel(error)}`);
    } catch { return; }
  };

  const runTick = async () => {
    const summary = {
      campaigns: 0,
      attempted: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      errors: 0,
      stoppedBy: null,
    };
    let campaignIds;
    try {
      campaignIds = listCampaigns(safeCampaignsPerTick);
    } catch (error) {
      summary.errors += 1;
      report("discovery", error);
      return summary;
    }

    const uniqueIds = [...new Set((Array.isArray(campaignIds) ? campaignIds : [])
      .map((entry) => typeof entry === "string" ? entry : entry?.id)
      .filter((id) => typeof id === "string" && id.length > 0))]
      .slice(0, safeCampaignsPerTick);

    for (const campaignId of uniqueIds) {
      summary.campaigns += 1;
      try {
        const result = await drain(campaignId, { max: safeBatchSize });
        summary.attempted += Number(result?.attempted) || 0;
        summary.sent += Number(result?.sent) || 0;
        summary.failed += Number(result?.failed) || 0;
        summary.skipped += Number(result?.skipped) || 0;
        if (result?.stoppedBy === "daily-limit") {
          // The provider allowance is process-wide. No later campaign can make
          // progress this tick, and the next periodic tick will re-evaluate it.
          summary.stoppedBy = "daily-limit";
          break;
        }
      } catch (error) {
        summary.errors += 1;
        report("drain", error, campaignId);
      }
    }
    return summary;
  };

  const tick = () => {
    if (activeTick) return activeTick;
    // Email sends are provider-heavy database work. Enter the same process-wide
    // maintenance coordinator as backups and enrichment, while emailQueue's
    // own drainTail continues to serialize manual and automatic campaign drains.
    const operation = Promise.resolve().then(() => runJob(runTick)).catch((error) => {
      report("tick", error);
      return {
        campaigns: 0,
        attempted: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        errors: 1,
        stoppedBy: null,
      };
    });
    const settled = operation.finally(() => {
      if (activeTick === settled) activeTick = null;
    });
    activeTick = settled;
    return settled;
  };

  const scheduleNext = () => {
    if (!started || timer !== null) return;
    try {
      timer = setTimer(async () => {
        timer = null;
        await tick();
        scheduleNext();
      }, safeIntervalMs);
      timer?.unref?.();
    } catch (error) {
      report("schedule", error);
    }
  };

  const controller = {
    tick,
    start() {
      if (started) return controller;
      started = true;
      void tick().finally(scheduleNext);
      return controller;
    },
    stop() {
      started = false;
      if (timer !== null) {
        try { clearTimer(timer); }
        catch (error) { report("timer cleanup", error); }
        timer = null;
      }
      return activeTick || Promise.resolve();
    },
  };

  return controller;
}

export function startEmailCampaignScheduler(options = {}) {
  return createEmailCampaignScheduler(options).start();
}
