/**
 * Shared sparkline utilities used by the earnings page and the dashboard home
 * stat cards.
 */

/**
 * Groups entries by date, sorts ascending, returns the summed amounts for the
 * last 7 unique dates found. Returns an empty array when there are no entries.
 */
export function computeSparklineData(entries: { date: string; amount: number }[]): number[] {
  const byDate = new Map<string, number>();
  for (const e of entries) {
    byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.amount);
  }
  const sortedDates = [...byDate.keys()].sort();
  const last7 = sortedDates.slice(-7);
  return last7.map((d) => byDate.get(d)!);
}

/**
 * Inline 40×16 SVG sparkline. Normalises values into the 1–15 Y-range (with
 * 1 px of padding top and bottom) and skips rendering when fewer than 2 points
 * are available.
 */
export function Sparkline({ data, stroke }: { data: number[]; stroke: string }) {
  if (data.length < 2) return null;

  const W = 40, H = 16, PAD = 1;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1; // avoid division by zero when all values equal

  const xs = data.map((_, i) => PAD + (i / (data.length - 1)) * (W - 2 * PAD));
  const ys = data.map((v) => H - PAD - ((v - min) / range) * (H - 2 * PAD));
  const points = xs.map((x, i) => `${x.toFixed(2)},${ys[i].toFixed(2)}`).join(' ');

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-2 animate-sparkline-fade"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
