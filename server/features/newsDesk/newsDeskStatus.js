// What the news desk did last and why it is quiet, for Moderation. The
// scheduler saves one small record after each pass (and one after a failure);
// reading the status never changes anything.
import { backgroundJobEnabled } from "../../backgroundJobs.js";
import { utcMonthStartDay } from "../../claudeSpendCeiling.js";
import { EDITORIAL, localClock } from "./newsEditorial.js";
import { NEWS_PUBLISHER_IDENTITY_KEY } from "./newsPublisherIdentity.js";
import { newsDeskBudget } from "./newsDeskService.js";

export const NEWS_DESK_LAST_PASS_KEY = "news-desk:v1:last-pass";
export const NEWS_DESK_LAST_ERROR_KEY = "news-desk:v1:last-error";
const HOUR = 60 * 60 * 1000;
const REPORT_WINDOW_MS = 48 * HOUR;

// One word for why the last pass did or did not publish. The panel turns it
// into a sentence; the codes stay stable for tests and logs.
export function newsDeskPassReason(result = {}) {
  if (result.publisherReason) return "publisher_paused";
  if (result.published > 0) return "published";
  if (result.slot === "day_full") return "day_full";
  if (result.slot === "next_slot") return "waiting_for_slot";
  if (result.slot === "too_soon") return "too_soon";
  if (result.skippedForBudget > 0) return "budget";
  if (result.declined > 0) return "declined";
  if (result.waiting > 0) return "waiting_for_slot";
  return "no_qualifying_story";
}

const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : null);
const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);

function save(database, key, value) {
  try {
    database.prepare("INSERT INTO app_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(key, JSON.stringify(value));
    return true;
  } catch {
    // A status record must never fail the pass it describes.
    return false;
  }
}

export function recordNewsDeskPass(database, { at, reason, reportsAdded = 0, result = {}, publisherReason = null } = {}) {
  return save(database, NEWS_DESK_LAST_PASS_KEY, {
    at,
    reason: text(reason, 40) || newsDeskPassReason(result),
    reportsAdded: count(reportsAdded),
    confirmed: count(result.confirmed),
    published: count(result.published),
    declined: count(result.declined),
    budgetStops: count(result.skippedForBudget),
    slot: text(result.slot, 40),
    headline: text(result.picked?.[0]?.headline, 160),
    publisherReason: text(publisherReason || result.publisherReason, 60),
  });
}

// `detail` must already be safe to show staff (anthropicErrorSummary masks keys).
export function recordNewsDeskFailure(database, { at, label, detail = "" } = {}) {
  return save(database, NEWS_DESK_LAST_ERROR_KEY, { at, label: text(label, 120) || "error", detail: text(detail, 300) || "" });
}

function readRecord(database, key) {
  try {
    const value = JSON.parse(database.prepare("SELECT value FROM app_meta WHERE key=?").get(key)?.value || "null");
    return value && typeof value === "object" && Number.isSafeInteger(value.at) ? value : null;
  } catch {
    // An unreadable record shows as "not recorded" rather than breaking the panel.
    return null;
  }
}

// The next slot start in Toronto time as "14:00", or "tomorrow 08:00".
export function nextNewsSlot(at, editorial = EDITORIAL) {
  const { hour } = localClock(at, editorial.timeZone);
  const label = (start) => `${String(Math.floor(start)).padStart(2, "0")}:${String(Math.round((start % 1) * 60)).padStart(2, "0")}`;
  const open = editorial.slotHours.find((start) => hour >= start && hour < start + editorial.slotLengthHours);
  if (open !== undefined) return { label: `${label(open)} (open now)`, timeZone: editorial.timeZone };
  const next = editorial.slotHours.find((start) => start > hour);
  return { label: next === undefined ? `tomorrow ${label(editorial.slotHours[0])}` : label(next), timeZone: editorial.timeZone };
}

function scalar(database, sql, ...params) {
  try {
    return Number(database.prepare(sql).get(...params)?.n) || 0;
  } catch (error) {
    // Before the desk first runs its tables may not exist yet: that is zero.
    if (/no such (table|column)/iu.test(String(error?.message))) return 0;
    throw error;
  }
}

// Confirmed, held (a call in flight) and unconfirmed (sent, reply lost; counted
// at its worst case) dollars since a UTC day. Totals from before receipts
// existed count as confirmed.
function ledger(database, fromDay) {
  const byStatus = (status) => scalar(database, "SELECT COALESCE(SUM(charged_usd),0) AS n FROM news_desk_receipts WHERE day>=? AND status=?", fromDay, status);
  const legacy = scalar(database, "SELECT COALESCE(SUM(usd),0) AS n FROM news_desk_spend WHERE day>=?", fromDay);
  const round = (value) => Math.round(value * 10_000) / 10_000;
  return { confirmedUsd: round(byStatus("settled") + legacy), heldUsd: round(byStatus("reserved")), unconfirmedUsd: round(byStatus("uncertain")) };
}

export function collectNewsDeskStatus(database, { env = process.env, at = Date.now() } = {}) {
  const today = new Date(at).toISOString().slice(0, 10);
  const localToday = localClock(at).day;
  const recent = (sql) => scalar(database, sql, at - 7 * 24 * HOUR);
  const published = (() => {
    try {
      return database.prepare("SELECT created_at FROM news_stories WHERE status='published' AND created_at>=?").all(at - 36 * HOUR)
        .filter((row) => localClock(Number(row.created_at)).day === localToday).length;
    } catch (error) {
      if (/no such (table|column)/iu.test(String(error?.message))) return 0;
      throw error;
    }
  })();
  return {
    configured: !!String(env.ANTHROPIC_API_KEY || "").trim(),
    enabled: backgroundJobEnabled(env, "NEWS_DESK_ENABLED"),
    budget: newsDeskBudget(env),
    spend: { today: ledger(database, today), month: ledger(database, utcMonthStartDay(at)) },
    publisherBound: scalar(database, "SELECT COUNT(*) AS n FROM app_meta WHERE key=?", NEWS_PUBLISHER_IDENTITY_KEY) > 0,
    publishedToday: published,
    slotsPerDay: EDITORIAL.slotHours.length,
    nextSlot: nextNewsSlot(at),
    published7d: recent("SELECT COUNT(*) AS n FROM news_stories WHERE status='published' AND created_at>=?"),
    declined7d: recent("SELECT COUNT(*) AS n FROM news_stories WHERE status='declined' AND created_at>=?"),
    openReports: scalar(database, "SELECT COUNT(*) AS n FROM news_reports WHERE story_id IS NULL AND published_at>=?", at - REPORT_WINDOW_MS),
    lastPass: readRecord(database, NEWS_DESK_LAST_PASS_KEY),
    lastError: readRecord(database, NEWS_DESK_LAST_ERROR_KEY),
  };
}
