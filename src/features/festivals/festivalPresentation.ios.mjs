// iOS presentation only. Never create provider editions or infer announcement facts.
const dateKey = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value ? value : null;
// Match the existing API's UTC eligibility boundary, including for travelers.
export function festivalToday(now = new Date()) {
  return new Date(now).toISOString().slice(0, 10);
}

const end = (edition) => dateKey(edition?.endDate) || dateKey(edition?.startDate);
export function currentFestivalEditions(editions, today = festivalToday()) {
  return (Array.isArray(editions) ? editions : []).filter(item => item?.id && dateKey(item.startDate) && end(item) >= today)
    .slice().sort((a, b) => a.startDate.localeCompare(b.startDate) || String(a.id).localeCompare(String(b.id)));
}
export function pastFestivalEditions(page, today = festivalToday()) {
  const seen = new Set();
  return [...(page?.past || []), ...(page?.upcoming || [])].filter(item => {
    if (!item?.id || seen.has(item.id) || !dateKey(item.startDate) || !end(item) || end(item) >= today) return false;
    seen.add(item.id); return true;
  }).sort((a, b) => b.startDate.localeCompare(a.startDate));
}
export function distinctFestivalAnnouncement(page, today = festivalToday()) {
  const row = page?.announcement;
  if (!row || !dateKey(row.startDate) || !end(row) || end(row) < today) return null;
  return currentFestivalEditions(page?.upcoming, today).some(item => item.startDate === row.startDate && end(item) === end(row)) ? null : row;
}
export function creditedFestivalImage(edition) {
  const credit = typeof edition?.imageAttribution === "string" ? edition.imageAttribution.trim() : "";
  if (!credit || typeof edition?.imageUrl !== "string") return null;
  try {
    const url = new URL(edition.imageUrl);
    return url.protocol === "https:" && !url.username && !url.password ? { uri: edition.imageUrl, credit } : null;
  } catch { return null; } // architecture: allow-ambiguous-result -- malformed optional artwork is ineligible presentation, not a failed command
}
export function confirmedFestivalPlan(plan, edition) {
  return !!plan && plan.editionId === edition.id && Array.isArray(plan.days) && plan.days.length > 0
    && plan.days.every(day => edition.days.includes(day)) && Array.isArray(plan.mustSee)
    && plan.mustSee.every(name => typeof name === "string" && edition.lineup.some(act => act.name === name));
}
