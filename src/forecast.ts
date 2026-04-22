/**
 * Month-end spend forecast from current run rate. Linear projection.
 * Good enough for a "am I on pace?" nudge, not for actuarial accuracy.
 */

export interface ForecastInput {
  /** Month-to-date total in cents. */
  totalCents: number;
  /** Monthly cap in USD (optional; forecast can run without one). */
  capUsd?: number;
  /** Override "now" for testing. Defaults to new Date(). */
  now?: Date;
}

export interface ForecastResult {
  /** Day of month, 1-indexed (UTC). */
  dayOfMonth: number;
  /** Total days in the current month (UTC). */
  daysInMonth: number;
  /** Current spend in USD. */
  totalUsd: number;
  /** Average daily spend so far, in USD. */
  dailyAvgUsd: number;
  /** Projected end-of-month spend in USD. */
  projectedEomUsd: number;
  /** Ratio of projected spend to cap (undefined if no cap). */
  projectedPctOfCap?: number;
  /** How many USD over the cap the projection is; 0 if under. */
  overCapUsd?: number;
  /** Simple human-readable status. */
  status: "under" | "on-pace" | "over";
}

export function forecast({
  totalCents,
  capUsd,
  now = new Date(),
}: ForecastInput): ForecastResult {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

  const totalUsd = totalCents / 100;
  const dailyAvgUsd = dayOfMonth > 0 ? totalUsd / dayOfMonth : 0;
  const projectedEomUsd = dailyAvgUsd * daysInMonth;

  let projectedPctOfCap: number | undefined;
  let overCapUsd: number | undefined;
  let status: ForecastResult["status"] = "under";

  if (capUsd !== undefined && capUsd > 0) {
    projectedPctOfCap = projectedEomUsd / capUsd;
    overCapUsd = Math.max(0, projectedEomUsd - capUsd);
    if (projectedPctOfCap >= 1.0) status = "over";
    else if (projectedPctOfCap >= 0.9) status = "on-pace";
    else status = "under";
  }

  return {
    dayOfMonth,
    daysInMonth,
    totalUsd,
    dailyAvgUsd,
    projectedEomUsd,
    projectedPctOfCap,
    overCapUsd,
    status,
  };
}
