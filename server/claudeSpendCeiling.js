// Every paid Claude feature (catalog research, the news desk) has its own
// daily and monthly caps, and on top of those they share one monthly ceiling:
// ANTHROPIC_MONTHLY_USD, $10 by default. Together they can never spend more
// than that in a calendar month (UTC), whatever each feature's own settings say.

export const DEFAULT_ANTHROPIC_MONTHLY_USD = 10;

// Each feature's spend ledger, summed from the first day of the month. A
// feature whose table does not exist yet simply has spent nothing.
const LEDGERS = Object.freeze([
  "SELECT COALESCE(SUM(charged_micro_usd),0) AS micro FROM catalog_research_spend WHERE utc_day>=?",
  "SELECT COALESCE(SUM(usd),0)*1000000 AS micro FROM news_desk_spend WHERE day>=?",
]);

export const utcMonthStartDay = (at) => `${new Date(at).toISOString().slice(0, 7)}-01`;

export function anthropicMonthlyCeilingMicroUsd(env = process.env) {
  const raw = String(env.ANTHROPIC_MONTHLY_USD ?? "").trim();
  const usd = raw ? Number(raw) : DEFAULT_ANTHROPIC_MONTHLY_USD;
  return Math.round((Number.isFinite(usd) && usd >= 0 ? Math.min(usd, 1000) : DEFAULT_ANTHROPIC_MONTHLY_USD) * 1_000_000);
}

export function claudeMonthSpendMicroUsd(database, at = Date.now()) {
  const fromDay = utcMonthStartDay(at);
  let total = 0;
  for (const sql of LEDGERS) {
    try {
      total += Math.max(0, Number(database.prepare(sql).get(fromDay)?.micro) || 0);
    } catch (error) {
      if (!/no such table/iu.test(String(error?.message))) throw error;
    }
  }
  return Math.ceil(total);
}

// What is left of the shared ceiling this month, in micro-dollars.
export function claudeCeilingLeftMicroUsd(database, { env = process.env, at = Date.now() } = {}) {
  return Math.max(0, anthropicMonthlyCeilingMicroUsd(env) - claudeMonthSpendMicroUsd(database, at));
}
