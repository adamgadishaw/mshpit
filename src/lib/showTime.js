// One place for "when is this show" math. Dates arrive in mixed shapes
// ("2026-08-14", "2026 · 08 · 14", odd separators); pull the number groups and
// use an explicit provider time when one exists. A date-only legacy record has
// no real start time, so 8pm local is only a display/countdown fallback and is
// never labelled as doors.
export function showDateMs(s) {
  const raw = String(s || "").trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const exact = Date.parse(raw);
    if (Number.isFinite(exact)) return exact;
  }
  const m = raw.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], 20, 0, 0);
  return isNaN(d.getTime()) ? null : d.getTime();
}

// T-minus, Clock-app style: days + hh:mm:ss once close.
export function fmtCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return days > 0 ? `${days}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

// A show still ahead of us (with a day of grace so "tonight" stays upcoming).
export function isUpcoming(dateStr, now = Date.now()) {
  const t = showDateMs(dateStr);
  return t != null && t - now > -86400000;
}
