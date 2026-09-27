// This month's Claude spending per feature for Moderation, split the way the
// ledgers record it: confirmed by Anthropic's usage figures, held for a call in
// flight, or unconfirmed (sent, reply lost; counted at its worst case until
// someone checks the Anthropic console). The total is what the shared ceiling
// in claudeSpendCeiling.js counts.
import { anthropicMonthlyCeilingMicroUsd, utcMonthStartDay } from "./claudeSpendCeiling.js";

const missingTable = (error) => /no such (table|column)/iu.test(String(error?.message));

function sum(database, sql, ...params) {
  try {
    return Number(database.prepare(sql).get(...params)?.n) || 0;
  } catch (error) {
    if (missingTable(error)) return 0;
    throw error;
  }
}

const usd = (micro) => Math.round(micro) / 1_000_000;

function feature(database, { table, dayColumn, amount, scale }, fromDay) {
  const byStatus = (status) => sum(database, `SELECT COALESCE(SUM(${amount}),0)*${scale} AS n FROM ${table} WHERE ${dayColumn}>=? AND status=?`, fromDay, status);
  return { confirmed: byStatus("settled"), held: byStatus("reserved"), unconfirmed: byStatus("uncertain") };
}

export function collectClaudeSpendStatus(database, { env = process.env, at = Date.now() } = {}) {
  const fromDay = utcMonthStartDay(at);
  const news = feature(database, { table: "news_desk_receipts", dayColumn: "day", amount: "charged_usd", scale: 1_000_000 }, fromDay);
  // Totals the news desk kept before per-call receipts existed.
  news.confirmed += sum(database, "SELECT COALESCE(SUM(usd),0)*1000000 AS n FROM news_desk_spend WHERE day>=?", fromDay);
  const research = feature(database, { table: "catalog_research_spend", dayColumn: "utc_day", amount: "charged_micro_usd", scale: 1 }, fromDay);
  const shape = (micro) => ({ confirmedUsd: usd(micro.confirmed), heldUsd: usd(micro.held), unconfirmedUsd: usd(micro.unconfirmed),
    totalUsd: usd(micro.confirmed + micro.held + micro.unconfirmed) });
  const totalMicro = [news, research].reduce((total, item) => total + item.confirmed + item.held + item.unconfirmed, 0);
  const ceilingMicro = anthropicMonthlyCeilingMicroUsd(env);
  return {
    month: fromDay.slice(0, 7),
    ceilingUsd: usd(ceilingMicro),
    totalUsd: usd(totalMicro),
    leftUsd: usd(Math.max(0, ceilingMicro - totalMicro)),
    news: shape(news),
    research: shape(research),
  };
}
