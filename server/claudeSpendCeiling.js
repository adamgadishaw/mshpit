// Every paid Claude feature (catalog research, the news desk) has its own
// daily and monthly caps, and on top of those they share one monthly ceiling:
// ANTHROPIC_MONTHLY_USD, $20 by default. Together they can never spend more
// than that in admitted reservations in a calendar month (UTC). Actual bills
// still need the provider's own cap: a response can cost more than its estimate.

export const DEFAULT_ANTHROPIC_MONTHLY_USD = 20;

// Each feature's spend ledger, summed from the first day of the month. A
// feature whose table does not exist yet simply has spent nothing.
const LEDGERS = Object.freeze([
  "SELECT COALESCE(SUM(charged_micro_usd),0) AS micro FROM catalog_research_spend WHERE utc_day>=?",
  "SELECT COALESCE(SUM(usd),0)*1000000 AS micro FROM news_desk_spend WHERE day>=?",
  // Reserved and unconfirmed news calls count at their reserved price.
  "SELECT COALESCE(SUM(charged_usd),0)*1000000 AS micro FROM news_desk_receipts WHERE day>=?",
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

// All paid callers reserve synchronously under the same SQLite transaction.
// Never await inside reserve(): the network starts only after this returns.
let admissionSequence = 0;
export function admitClaudeSpend(database, {
  env = process.env, at = Date.now(), reserveMicroUsd, dailyCapMicroUsd,
  monthlyCapMicroUsd, readDailySpendMicroUsd, readMonthlySpendMicroUsd, reserve,
}) {
  const amount = (value) => {
    if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new TypeError("Invalid Claude budget amount.");
    return Math.ceil(value);
  };
  const held = amount(reserveMicroUsd);
  const dailyCap = amount(dailyCapMicroUsd);
  const monthlyCap = amount(monthlyCapMicroUsd);
  if (!held) throw new TypeError("A paid request requires a positive reservation.");
  const point = `claude_admit_${++admissionSequence}`;
  database.exec(`SAVEPOINT ${point}`);
  try {
    let reason = null;
    if (amount(readDailySpendMicroUsd()) + held > dailyCap) reason = "daily_budget";
    else if (amount(readMonthlySpendMicroUsd()) + held > monthlyCap) reason = "monthly_budget";
    else if (claudeMonthSpendMicroUsd(database, at) + held > anthropicMonthlyCeilingMicroUsd(env)) reason = "claude_monthly_ceiling";
    const value = reason ? undefined : reserve();
    if (value && typeof value.then === "function") throw new TypeError("Claude reservation must be synchronous.");
    database.exec(`RELEASE ${point}`);
    return reason ? { ok: false, reason } : { ok: true, value };
  } catch (error) {
    database.exec(`ROLLBACK TO ${point}; RELEASE ${point}`);
    throw error;
  }
}

// These explicit HTTP rejections did not admit model work. Lost replies,
// timeouts and server errors remain uncertain and keep their reservation.
export function claudeRequestDefinitelyRejected(error) {
  return [400, 401, 403, 404, 422, 429].includes(Number(error?.status));
}
