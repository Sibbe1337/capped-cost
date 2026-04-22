/**
 * Month-end spend forecast. Keeps the default linear model but also supports
 * recent-history projections when daily data is available.
 */

export type ForecastStrategy = "linear" | "rolling-7d" | "weighted-recent";

export interface ForecastInput {
  /** Monthly cap in USD (optional; forecast can run without one). */
  capUsd?: number;
  /** Optional daily totals for the current month. Needed for non-linear strategies. */
  dailyCents?: Map<string, number> | Record<string, number>;
  /** Override "now" for testing. Defaults to new Date(). */
  now?: Date;
  /** Requested strategy. Defaults to "linear". */
  strategy?: ForecastStrategy;
  /** Month-to-date total in cents. */
  totalCents: number;
}

export interface ForecastResult {
  /** Simple human-readable status. */
  status: "under" | "on-pace" | "over";
  /** Requested strategy from the caller. */
  requestedStrategy: ForecastStrategy;
  /** Strategy actually used. Falls back to linear if daily history is missing. */
  strategy: ForecastStrategy;
  /** Day of month, 1-indexed (UTC). */
  dayOfMonth: number;
  /** Total days in the current month (UTC). */
  daysInMonth: number;
  /** Remaining days in the current month (UTC). */
  remainingDays: number;
  /** Current spend in USD. */
  totalUsd: number;
  /** Average daily spend used by the chosen strategy, in USD. */
  dailyAvgUsd: number;
  /** Projected end-of-month spend in USD. */
  projectedEomUsd: number;
  /** Ratio of projected spend to cap (undefined if no cap). */
  projectedPctOfCap?: number;
  /** How many USD over the cap the projection is; 0 if under. */
  overCapUsd?: number;
  /** Number of days used for the modeled rate. */
  observationWindowDays: number;
  /** Honest caveat for the chosen strategy. */
  confidenceNote: string;
}

function normalizeDailyCents(
  input: ForecastInput["dailyCents"]
): Map<string, number> | undefined {
  if (!input) return undefined;
  if (input instanceof Map) return new Map(input.entries());
  return new Map(Object.entries(input).map(([day, cents]) => [day, cents]));
}

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function observedDayValues(
  now: Date,
  dailyCents: Map<string, number> | undefined
): number[] {
  const values: number[] = [];
  for (let day = 1; day <= now.getUTCDate(); day += 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day));
    const key = utcDayKey(date);
    values.push(dailyCents?.get(key) || 0);
  }
  return values;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function weightedAverage(values: number[]): number {
  if (!values.length) return 0;
  const weighted = values.reduce(
    (acc, value, index) => {
      const weight = index + 1;
      return {
        numerator: acc.numerator + value * weight,
        denominator: acc.denominator + weight,
      };
    },
    { numerator: 0, denominator: 0 }
  );
  return weighted.denominator > 0 ? weighted.numerator / weighted.denominator : 0;
}

function strategyNote(strategy: ForecastStrategy, windowDays: number): string {
  if (strategy === "rolling-7d") {
    return `Uses the last ${windowDays} calendar day(s) to model the rest of the month. Better when spend changed recently, noisier with bursty workloads.`;
  }
  if (strategy === "weighted-recent") {
    return `Weights the most recent ${windowDays} calendar day(s) more heavily. Useful when your current run rate is drifting, but still only a directional estimate.`;
  }
  return "Simple linear projection from the month-to-date average. Easiest to explain, but it assumes the rest of the month looks like the days so far.";
}

export function forecast({
  capUsd,
  dailyCents: dailyInput,
  now = new Date(),
  strategy: requestedStrategy = "linear",
  totalCents,
}: ForecastInput): ForecastResult {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const remainingDays = daysInMonth - dayOfMonth;

  const totalUsd = totalCents / 100;
  const linearDailyAvgUsd = dayOfMonth > 0 ? totalUsd / dayOfMonth : 0;

  const dailyCents = normalizeDailyCents(dailyInput);
  const observedValues = observedDayValues(now, dailyCents);
  let strategy: ForecastStrategy = requestedStrategy;
  let observationWindowDays = dayOfMonth;
  let dailyAvgUsd = linearDailyAvgUsd;
  let projectedEomUsd = totalUsd + linearDailyAvgUsd * remainingDays;
  let confidenceNote = strategyNote("linear", observationWindowDays);

  if (requestedStrategy !== "linear") {
    if (!dailyCents || observedValues.length === 0) {
      strategy = "linear";
      confidenceNote =
        `Requested ${requestedStrategy}, but dailyCents was not provided. Fell back to the simple linear model.`;
    } else {
      observationWindowDays = Math.min(7, observedValues.length);
      const window = observedValues.slice(-observationWindowDays);
      const modeledDailyCents =
        requestedStrategy === "weighted-recent"
          ? weightedAverage(window)
          : average(window);
      dailyAvgUsd = modeledDailyCents / 100;
      projectedEomUsd = totalUsd + dailyAvgUsd * remainingDays;
      confidenceNote = strategyNote(requestedStrategy, observationWindowDays);
    }
  }

  let projectedPctOfCap: number | undefined;
  let overCapUsd: number | undefined;
  let status: ForecastResult["status"] = "under";

  if (capUsd !== undefined && capUsd > 0) {
    projectedPctOfCap = projectedEomUsd / capUsd;
    overCapUsd = Math.max(0, projectedEomUsd - capUsd);
    if (projectedPctOfCap >= 1.0) status = "over";
    else if (projectedPctOfCap >= 0.9) status = "on-pace";
  }

  return {
    confidenceNote,
    dayOfMonth,
    dailyAvgUsd,
    daysInMonth,
    observationWindowDays,
    overCapUsd,
    projectedEomUsd,
    projectedPctOfCap,
    remainingDays,
    requestedStrategy,
    status,
    strategy,
    totalUsd,
  };
}
